import {
  BadGatewayException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common'
import type { TenantId } from '@opengewerk/platform-domain'
import { and, eq, like, ne } from 'drizzle-orm'

import { isUniqueViolation } from '../api/database-errors.js'
import type { Database } from '../database/database.js'
import {
  accountCorrections,
  authAddressConfirmations,
  authUsers,
  authVerifications,
} from '../schema.js'
import { normalise, oneAccountPerAddress, openPasswordResets } from './administration.js'
import { hashToken, mintToken } from './invitation.js'
import type { AddressMail } from './notices.js'
import { tenantsOf } from './passkeys.js'

/**
 * An address holds only once a mail reached it (N28 of the security audit,
 * opengewerk#754).
 *
 * The address of an account is how a later grant finds it: an invitation to
 * an account that is there, the appointment to run the instance, the command
 * line. So a new address does not replace the old one when somebody types
 * it, under "Konto" or as a correction in a tenant. It waits in
 * `auth_address_confirmations`, a link goes to it, and only the link sets it,
 * with `email_verified`. Until then the old one holds. An address that is
 * there and was never confirmed, as one an invitation by link brought, is
 * confirmed the same way, with a link to itself.
 *
 * Without a mail server of the instance nothing can reach an address, so no
 * address changes then (Moritz, 30.10.2026).
 */

/** How long the link in the mail to an address works, in seconds. */
export const addressLifetime = 24 * 60 * 60

/** An address that waits for the link in the mail to it. */
export interface PendingAddress {
  readonly email: string
  readonly expiresAt: string
}

/** The refusal without a mail server of the instance. */
export const addressNeedsMail =
  'Eine neue E-Mail-Adresse gilt erst, wenn der Link in einer Mail an sie geöffnet ist, und auf ' +
  'dieser Instanz ist noch kein Mailserver eingerichtet. Der Name lässt sich trotzdem ändern.'

/** The refusal of a grant through an address nobody confirmed. */
export const addressUnconfirmed =
  'Die E-Mail-Adresse dieses Kontos ist noch nicht bestätigt. Unter „Konto“ geht dafür eine ' +
  'Mail an sie hinaus; danach geht es.'

const takenAddress = 'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.'
const goneLink = 'Dieser Link gilt nicht mehr. Unter „Konto“ geht eine neue Mail hinaus.'

/** The address that waits for an account, if one does and its link still works. */
export async function pendingAddressOf(
  database: Database,
  userId: string,
): Promise<PendingAddress | null> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .select({
          email: authAddressConfirmations.email,
          expiresAt: authAddressConfirmations.expiresAt,
        })
        .from(authAddressConfirmations)
        .where(eq(authAddressConfirmations.userId, userId))
        .limit(1),
    userId,
  )

  return row && row.expiresAt.getTime() > Date.now()
    ? { email: row.email, expiresAt: row.expiresAt.toISOString() }
    : null
}

/**
 * Sends the link for an address of an account and keeps it waiting: a new
 * one, or the one the account has when `email` is that one. A link sent
 * before for the account stops working. `requestedBy` is whoever asked, the
 * account itself or whoever corrected it in a tenant.
 */
export async function requestAddress(
  database: Database,
  mail: AddressMail | null,
  account: { readonly userId: string; readonly name: string; readonly email: string },
  wanted: string,
  requestedBy: string,
): Promise<PendingAddress> {
  const email = normalise(wanted)

  if (!email.includes('@')) {
    throw new ConflictException('Die E-Mail-Adresse sieht nicht wie eine aus.')
  }

  if (mail === null || !(await mail.ready())) {
    throw new ConflictException(addressNeedsMail)
  }

  const { token, hash } = mintToken()
  const expiresAt = new Date(Date.now() + addressLifetime * 1000)

  await database.forInstance(async (tx) => {
    const [taken] = await tx
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(and(eq(authUsers.email, email), ne(authUsers.id, account.userId)))
      .limit(1)

    if (taken) {
      throw new ConflictException(takenAddress)
    }

    await tx
      .delete(authAddressConfirmations)
      .where(eq(authAddressConfirmations.userId, account.userId))
    await tx.insert(authAddressConfirmations).values({
      userId: account.userId,
      email,
      tokenHash: hash,
      requestedBy,
      expiresAt,
    })
  }, requestedBy)

  try {
    await mail.confirmation(
      { name: account.name, email },
      { change: email !== normalise(account.email), token, expiresAt },
    )
  } catch (error) {
    // A link nobody received leaves nothing waiting.
    await discardAddress(database, account.userId, requestedBy)
    console.error('The mail with the link to an address was refused.', error)

    throw new BadGatewayException(
      'Die Mail an diese Adresse ließ sich nicht senden. Die bisherige Adresse gilt weiter.',
    )
  }

  return { email, expiresAt: expiresAt.toISOString() }
}

/** Takes the address that waits for an account away; its link stops working. */
export async function discardAddress(
  database: Database,
  userId: string,
  asUser: string,
): Promise<void> {
  await database.forInstance(
    (tx) => tx.delete(authAddressConfirmations).where(eq(authAddressConfirmations.userId, userId)),
    asUser,
  )
}

/** What the page of the link shows before anything is confirmed. */
export interface AddressOffer {
  readonly state: 'open' | 'gone'
  readonly name: string
  readonly email: string
}

export async function addressOfferOf(database: Database, token: string): Promise<AddressOffer> {
  const found = await waiting(database, token)

  return found === null || found.expiresAt.getTime() <= Date.now()
    ? { state: 'gone', name: '', email: '' }
    : { state: 'open', name: found.name, email: found.email }
}

/**
 * Opens the link: the address holds for the account from now on, confirmed.
 *
 * A new one replaces the old one, and a link to a new password still open
 * ends, since it went to the old one. The change goes into the log of every
 * tenant the account works in, as a correction, written as whoever asked for
 * it, and the old address is told.
 */
export async function confirmAddress(
  database: Database,
  mail: AddressMail | null,
  token: string,
): Promise<{ readonly email: string; readonly changed: boolean }> {
  const found = await waiting(database, token)

  if (found === null || found.expiresAt.getTime() <= Date.now()) {
    throw new GoneException(goneLink)
  }

  const asUser = found.requestedBy ?? found.userId
  const changed = found.email !== found.before

  try {
    await database.forInstance(async (tx) => {
      const taken = await tx
        .delete(authAddressConfirmations)
        .where(eq(authAddressConfirmations.tokenHash, hashToken(token)))
        .returning({ id: authAddressConfirmations.id })

      if (taken.length === 0) {
        // Opened twice at once: the other one got here first.
        throw new GoneException(goneLink)
      }

      await tx
        .update(authUsers)
        .set({ email: found.email, emailVerified: true, updatedAt: new Date() })
        .where(eq(authUsers.id, found.userId))

      if (changed) {
        await tx
          .delete(authVerifications)
          .where(
            and(
              eq(authVerifications.value, found.userId),
              like(authVerifications.identifier, openPasswordResets),
            ),
          )
      }
    }, asUser)
  } catch (error) {
    if (isUniqueViolation(error, oneAccountPerAddress)) {
      throw new ConflictException(takenAddress)
    }

    throw error
  }

  if (changed) {
    for (const tenantId of await tenantsOf(database, found.userId)) {
      await recordChange(database, tenantId, found, asUser)
    }

    void mail
      ?.changed({ name: found.name, email: found.before }, found.email)
      .catch((error: unknown) => {
        console.error('The notice to the old address of an account was refused.', error)
      })
  }

  return { email: found.email, changed }
}

async function recordChange(
  database: Database,
  tenantId: TenantId,
  found: { readonly userId: string; readonly email: string; readonly before: string },
  asUser: string,
): Promise<void> {
  await database.forTenant(
    {
      tenantId,
      userId: asUser,
      reason: asUser === found.userId ? 'account.own' : 'account.address',
    },
    (tx) =>
      tx.insert(accountCorrections).values({
        tenantId,
        userId: found.userId,
        nameBefore: null,
        nameAfter: null,
        emailBefore: found.before,
        emailAfter: found.email,
      }),
  )
}

/** The row a token names, with the account it is for. */
async function waiting(
  database: Database,
  token: string,
): Promise<{
  readonly userId: string
  readonly name: string
  readonly before: string
  readonly email: string
  readonly requestedBy: string | null
  readonly expiresAt: Date
} | null> {
  const [row] = await database.forInstance((tx) =>
    tx
      .select({
        userId: authAddressConfirmations.userId,
        name: authUsers.name,
        before: authUsers.email,
        email: authAddressConfirmations.email,
        requestedBy: authAddressConfirmations.requestedBy,
        expiresAt: authAddressConfirmations.expiresAt,
      })
      .from(authAddressConfirmations)
      .innerJoin(authUsers, eq(authUsers.id, authAddressConfirmations.userId))
      .where(eq(authAddressConfirmations.tokenHash, hashToken(token)))
      .limit(1),
  )

  return row ?? null
}

/** Whether the address of an account was confirmed, as every grant through it asks. */
export async function addressConfirmed(database: Database, userId: string): Promise<boolean> {
  const [row] = await database.forInstance((tx) =>
    tx
      .select({ verified: authUsers.emailVerified })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .limit(1),
  )

  if (!row) {
    throw new NotFoundException()
  }

  return row.verified
}
