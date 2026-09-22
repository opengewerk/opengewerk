import { and, eq } from 'drizzle-orm'

import { stillOpen } from '../authentication/administration.js'
import { mintToken } from '../authentication/invitation.js'
import type { Database } from '../database/database.js'
import { invitations } from '../database/schema/index.js'
import type { OutboxRow } from './outbox.js'
import { MailDeliveryError } from './transport.js'

/** Where the link of an invitation comes from. Handed to the job, like the attachments. */
export type InvitationLinkSource = (row: OutboxRow) => Promise<string>

/**
 * The link of an invitation, made at the moment its message goes out.
 *
 * A new token each time: its hash replaces the one the invitation carried,
 * and the token itself goes into the message and nowhere else. Should a
 * message go out and the job fail before it could say so, the next attempt
 * makes another token, and only the newest link works. The person then has
 * two mails and one working link, which is the price of never having a
 * working link in the database.
 *
 * An invitation that is no longer open, called back, used or run out, gives
 * no link, and the message is given up on with the reason.
 */
export function invitationLinks(database: Database, origin: string): InvitationLinkSource {
  return async (row) => {
    if (row.invitationId === null) {
      throw new MailDeliveryError('Der Nachricht fehlt die Einladung.', 'EINVITATION', null)
    }

    const invitationId = row.invitationId
    const { token, hash } = mintToken()

    const updated = await database.forTenant({ tenantId: row.tenantId, reason: 'mail' }, (tx) =>
      tx
        .update(invitations)
        .set({ tokenHash: hash, updatedAt: new Date() })
        .where(and(eq(invitations.id, invitationId), stillOpen()))
        .returning({ id: invitations.id }),
    )

    if (updated.length === 0) {
      throw new MailDeliveryError(
        'Die Einladung ist nicht mehr offen: zurückgezogen, schon benutzt oder abgelaufen.',
        'EINVITATION',
        null,
      )
    }

    return `${origin}/einladung/${token}`
  }
}
