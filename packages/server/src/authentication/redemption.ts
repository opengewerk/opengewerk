import { BadRequestException, ConflictException, GoneException } from '@nestjs/common'
import type { RoleKey, TenantId } from '@opengewerk/domain'
import { eq, sql } from 'drizzle-orm'

import type { Database, StraddlingTransaction } from '../database/database.js'
import { authUsers, invitations } from '../database/schema/index.js'
import type { Authentication } from './authentication.js'
import { hashToken } from './invitation.js'
import { shortestPassword } from './password.js'
import { createAccount, grantMembership } from './staff.js'

/**
 * The other end of a one time link: somebody who has been handed a token and
 * nothing else.
 *
 * Everything here happens without a session, which is what makes it different
 * from the rest of the user administration and is the whole reason it is a
 * file of its own. The caller cannot be identified, has no business, and
 * therefore sees nothing at all under the ordinary policies. What stands in
 * for an identity is the token, and the one thing it proves is that whoever
 * holds it was given it by the office of one particular business.
 *
 * The lookup goes through `invitation_for`, which runs as the owner of the
 * tables. It has to: `tenant_isolation` on `invitations` compares a row
 * against a business that has not been chosen, so from out here the table is
 * empty on every instance. The token is what names the business, and something
 * has to be able to read it to find that out. Everything after the lookup
 * happens under the ordinary policies, inside the business the token named.
 */

/** What became of an invitation, and therefore what the screen should say. */
export type InvitationState = 'open' | 'redeemed' | 'revoked' | 'expired'

export interface InvitationOffer {
  readonly state: InvitationState
  readonly company: string
  readonly name: string
  readonly email: string
  readonly expiresAt: Date
  /**
   * Whether this address already has an account on the instance.
   *
   * It decides what the screen asks for. A new account needs a password; one
   * that exists keeps the one it has, and asking for a new one would either
   * silently do nothing or quietly change somebody's password from a link
   * their office made, which is worse.
   *
   * Handing this out to somebody holding a token is not a way of asking the
   * instance who has an account: the token names one address, the one the
   * office typed, and the office already knew it.
   */
  readonly knownAccount: boolean
}

/** What a redemption leaves behind. */
export interface Redeemed {
  readonly tenantId: TenantId
  readonly company: string
  readonly email: string
  /** False when the address already had an account, which keeps its password. */
  readonly created: boolean
}

/** The row `invitation_for` hands back. */
interface InvitationRow {
  readonly invitation_id: string
  readonly business: string
  readonly company: string
  readonly invited_email: string
  readonly invited_name: string
  readonly invited_roles: string[]
  readonly expires: string | Date
  readonly redeemed: string | Date | null
  readonly revoked: string | Date | null
}

/**
 * What a token is an invitation to, or nothing.
 *
 * Nothing means the token is not one of ours, and the route turns that into a
 * 404. The three unusable states come back as themselves instead, because
 * "this link was already used" and "this link never existed" call for
 * different sentences and only one of them is worth a second look from the
 * person holding it.
 */
export async function offerOf(database: Database, token: string): Promise<InvitationOffer | null> {
  const found = await lookUp(database, token)

  if (!found) {
    return null
  }

  const { row, knownAccount } = found

  return {
    state: stateOf(row),
    company: row.company,
    name: row.invited_name,
    email: row.invited_email,
    expiresAt: new Date(row.expires),
    knownAccount,
  }
}

/**
 * Turns a link into a way in.
 *
 * One transaction, from outside any business into the one the token named. The
 * account is created first because the `auth_` tables are in reach only out
 * there, then the step inside, then the invitation is marked used, then the
 * membership. That order is not cosmetic: marking it is the concurrency guard,
 * and it comes before the membership so that a second redemption of the same
 * link rolls back having written nothing.
 *
 * The guard is the `where` clause and not a lock. The update names the row and
 * asks that it still be unused, uncalled back and unexpired; PostgreSQL locks
 * that row for the update, the second transaction waits, and when it gets
 * there the condition no longer holds and it changes nothing. Counting what
 * changed is what turns that into a refusal.
 *
 * An address that already has an account keeps its password. The alternative
 * would be a link made by an office that sets a password on an account the
 * office has nothing to do with, and on a shared instance that account might
 * belong to the company next door.
 */
export async function redeemInvitation(
  authentication: Authentication,
  database: Database,
  token: string,
  password: string | undefined,
): Promise<Redeemed> {
  const found = await lookUp(database, token)

  if (!found) {
    throw new GoneException('Diesen Link gibt es nicht.')
  }

  const { row, knownAccount } = found
  const state = stateOf(row)

  if (state !== 'open') {
    throw new GoneException(unusable[state])
  }

  if (!knownAccount) {
    if (typeof password !== 'string' || password.length < shortestPassword) {
      throw new BadRequestException(
        `Das Passwort ist zu kurz. Mindestens ${String(shortestPassword)} Zeichen, denn dieses ` +
          'Konto wird einmal eingerichtet und jahrelang benutzt.',
      )
    }
  }

  const context = await authentication.$context
  const tenantId = row.business as TenantId
  const roles = row.invited_roles as RoleKey[]

  const created = await database.forInstanceAndTenant(
    'invitation.redeem',
    async ({ tx, enter }: StraddlingTransaction) => {
      const account = await createAccount(context, tx, {
        email: row.invited_email,
        name: row.invited_name,
        // Ignored when the account is already there, which is the case
        // `knownAccount` stands for. The empty string never reaches a hasher:
        // `createAccount` returns before it gets that far.
        password: password ?? '',
      })

      // Inside the business from here on, as the person who is joining it. So
      // both rows below land in this company's audit log with their name on
      // them, which is the honest answer to "how did this person get in".
      await enter(tenantId, account.userId)

      const used = await tx
        .update(invitations)
        .set({ redeemedAt: new Date(), updatedAt: new Date() })
        .where(
          sql`${invitations.id} = ${row.invitation_id}
            and ${invitations.redeemedAt} is null
            and ${invitations.revokedAt} is null
            and ${invitations.expiresAt} > now()`,
        )
        .returning({ id: invitations.id })

      if (used.length === 0) {
        // Somebody else got here first, in the moment between the lookup above
        // and this statement. Throwing rolls the account back with it.
        throw new ConflictException('Dieser Link wurde gerade eben schon benutzt.')
      }

      await grantMembership(tx, { tenantId, userId: account.userId, roles })

      return account.created
    },
  )

  return { tenantId, company: row.company, email: row.invited_email, created }
}

/** The sentence for each state a link can be in that is not usable. */
const unusable: Record<Exclude<InvitationState, 'open'>, string> = {
  redeemed: 'Dieser Link wurde schon benutzt. Bitte im Betrieb einen neuen anfordern.',
  revoked: 'Dieser Link wurde zurückgezogen. Bitte im Betrieb nachfragen.',
  expired: 'Dieser Link ist abgelaufen. Bitte im Betrieb einen neuen anfordern.',
}

/**
 * The invitation a token names, and whether its address is already an account.
 *
 * Both in one transaction outside any business, which is where each of them is
 * answerable: the first through the function that runs as the owner, the
 * second because the `auth_` tables are in reach exactly here.
 */
async function lookUp(
  database: Database,
  token: string,
): Promise<{ row: InvitationRow; knownAccount: boolean } | null> {
  const hash = hashToken(token)

  return database.forInstance(async (tx) => {
    const found = await tx.execute(sql`select * from invitation_for(${hash})`)
    const row = found.rows[0] as InvitationRow | undefined

    if (!row) {
      return null
    }

    const [account] = await tx
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, row.invited_email))
      .limit(1)

    return { row, knownAccount: account !== undefined }
  })
}

function stateOf(row: InvitationRow): InvitationState {
  if (row.redeemed) {
    return 'redeemed'
  }

  if (row.revoked) {
    return 'revoked'
  }

  return new Date(row.expires).getTime() <= Date.now() ? 'expired' : 'open'
}
