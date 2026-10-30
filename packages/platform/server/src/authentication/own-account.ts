import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import type { SignedInUser } from '../api/identity.js'
import type { Database } from '../database/database.js'
import { accountCorrections, authUsers } from '../schema.js'
import { type PendingAddress, requestAddress } from './address-confirmation.js'
import { type CorrectedAccount, normalise, writeAccount } from './administration.js'
import type { AddressMail } from './notices.js'
import { tenantsOf } from './passkeys.js'
import { claimReconfirmation } from './reconfirmation.js'

/**
 * Changes the name or the address of one's own account, under "Konto"
 * (opengewerk-haustechnik#128).
 *
 * The way for every account, and the only one for an account that works for
 * more than one tenant or runs the instance: nobody else corrects such an
 * account (`correctAccount`).
 *
 * An address is where a link to a new password goes, so whoever changes it
 * can let themselves in later. A session alone is therefore not enough, it
 * may be one left open on somebody else's desk: the change takes the
 * confirmation with the password and, where there is one, the code from the
 * app, as adding a passkey does (`reconfirmation.ts`), and spends it. It is
 * spent once the change is asked for, before the address is known to be free,
 * so a refused change needs the password again, which is the side to err on.
 *
 * What was changed into what goes into the log of every tenant the account
 * works in, through `account_corrections`, written as the person: one
 * transaction per tenant, as for a passkey. A record that cannot be written
 * takes the change of the account back; one already written in another
 * tenant stays and says too much rather than too little.
 *
 * A new address does not hold yet (N28 of the security audit,
 * opengewerk#754): it waits for the link in a mail to it, and the link sets
 * it and writes it into the logs (`address-confirmation.ts`). Without a mail
 * server of the instance it is refused, the name changes all the same.
 */
export async function changeOwnAccount(
  database: Database,
  user: SignedInUser,
  wanted: { readonly name?: unknown; readonly email?: unknown },
  mail: AddressMail | null,
): Promise<CorrectedAccount & { readonly pending: PendingAddress | null }> {
  if (wanted.name === undefined && wanted.email === undefined) {
    throw new BadRequestException('Weder name noch email ist angegeben.')
  }

  if (
    (wanted.name !== undefined && typeof wanted.name !== 'string') ||
    (wanted.email !== undefined && typeof wanted.email !== 'string')
  ) {
    throw new BadRequestException('Name und E-Mail-Adresse sind Text.')
  }

  const name = wanted.name?.trim()
  const email = wanted.email === undefined ? undefined : normalise(wanted.email)

  if (name === '') {
    throw new BadRequestException('Der Name fehlt.')
  }

  if (email !== undefined && !email.includes('@')) {
    throw new BadRequestException('Die E-Mail-Adresse sieht nicht wie eine aus.')
  }

  const [before] = await database.forInstance(
    (tx) =>
      tx
        .select({ name: authUsers.name, email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, user.userId))
        .limit(1),
    user.userId,
  )

  if (!before) {
    // A session whose account is gone; the guard lets none through.
    throw new NotFoundException()
  }

  // The address stays what it is here; a new one only waits for its link.
  const after = { name: name ?? before.name, email: before.email }
  const nameChanged = after.name !== before.name
  const emailChanged = email !== undefined && email !== before.email

  if (!nameChanged && !emailChanged) {
    // Nothing changed is no change: no confirmation spent, no entry in a log.
    return { ...after, pending: null }
  }

  if (!(await claimReconfirmation(database, user.sessionId))) {
    throw new ForbiddenException(
      'Eigene Angaben ändern sich erst nach der Bestätigung mit Passwort und Code.',
    )
  }

  const pending = emailChanged
    ? await requestAddress(
        database,
        mail,
        { userId: user.userId, name: after.name, email: before.email },
        email,
        user.userId,
      )
    : null

  if (!nameChanged) {
    return { ...after, pending }
  }

  await writeAccount(database, user.userId, user.userId, after, false)

  try {
    for (const tenantId of await tenantsOf(database, user.userId)) {
      await database.forTenant({ tenantId, userId: user.userId, reason: 'account.own' }, (tx) =>
        tx.insert(accountCorrections).values({
          tenantId,
          userId: user.userId,
          nameBefore: before.name,
          nameAfter: after.name,
          emailBefore: null,
          emailAfter: null,
        }),
      )
    }
  } catch (error) {
    await writeAccount(database, user.userId, user.userId, before, false)

    throw error
  }

  return { ...after, pending }
}
