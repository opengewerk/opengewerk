import type { TenantId } from '@opengewerk/domain'
import { and, asc, eq, isNull } from 'drizzle-orm'

import type { MailContext } from '../api/handed-in.js'
import type { Database } from '../database/database.js'
import { mailOutbox, memberships, tenants } from '../database/schema/index.js'
import { passkeyAddedMessage } from '../notifications/templates.js'
import { connectionOf } from './server-settings.js'

/** The account a passkey was added to, as better-auth hands it over. */
export interface PasskeyOwner {
  readonly id: string
  readonly email: string
  readonly name: string
}

/** Writes the notice about a new passkey, or nothing when no business sends mail. */
export type PasskeyNotice = (
  owner: PasskeyOwner,
  passkey: { readonly id: string; readonly name: string },
) => Promise<void>

/**
 * The mail to an account about a passkey added to it (#167).
 *
 * An account belongs to no business and every mail server to one, so the
 * notice goes through the business the account joined first, is not blocked
 * in and has a mail server set up, as the link to a new password does
 * (`password-reset.ts`). An account in no such business gets no mail.
 *
 * Unlike that link it goes through the outbox and not straight away: it
 * carries no secret, so a row in the outbox and in the audit log of that
 * business is no risk, and the outbox tries again for two days where a mail
 * server does not answer at once. A notice that a key was added is worth the
 * retry; somebody who did not add it should hear of it even so.
 */
export function passkeyNotices(database: Database, mail: MailContext): PasskeyNotice {
  return async (owner, passkey) => {
    const businesses = await database.forInstance(
      (tx) =>
        tx
          .select({ tenantId: memberships.tenantId, name: tenants.name })
          .from(memberships)
          .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
          .where(and(eq(memberships.userId, owner.id), isNull(memberships.blockedAt)))
          .orderBy(asc(memberships.createdAt)),
      owner.id,
    )

    for (const business of businesses) {
      const tenantId = business.tenantId as TenantId
      const connection = await connectionOf(database, tenantId, mail.key)

      if (connection?.state !== 'ready') {
        continue
      }

      const text = passkeyAddedMessage({
        name: owner.name,
        passkey: passkey.name,
        addedAt: new Date(),
        link: `${mail.origin}/konto`,
        business: business.name,
      })

      await database.forTenant({ tenantId, userId: owner.id, reason: 'passkey.add' }, (tx) =>
        tx
          .insert(mailOutbox)
          .values({
            tenantId,
            kind: 'passkey_added',
            cause: `passkey_added:${passkey.id}`,
            requestedBy: owner.id,
            senderName: business.name,
            replyTo: null,
            recipientAddress: owner.email,
            recipientName: owner.name || null,
            subject: text.subject,
            body: text.body,
          })
          .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] }),
      )

      return
    }
  }
}
