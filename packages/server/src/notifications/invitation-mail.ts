import type { InvitationId } from '@opengewerk/domain'
import type {
  Database,
  InvitationMail,
  InvitationMailing,
  TenantTransaction,
} from '@opengewerk/platform-server'
import { desc, inArray } from 'drizzle-orm'

import { mailOutbox } from '../database/schema/index.js'
import { requireMailServer } from '../mail/server-settings.js'
import { notify } from './occasions.js'

/**
 * The message each of these invitations went out with, where one did.
 *
 * Read here and not in the staff list, so that the outbox is touched only by
 * the code that writes and sends messages; `mail/boundaries.test.ts` holds
 * that line. One invitation has one message, the cause makes sure of it.
 */
export async function invitationMails(
  tx: TenantTransaction,
  invitationIds: readonly InvitationId[],
): Promise<ReadonlyMap<string, InvitationMail>> {
  if (invitationIds.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({
      invitationId: mailOutbox.invitationId,
      status: mailOutbox.status,
      sentAt: mailOutbox.sentAt,
      lastError: mailOutbox.lastError,
    })
    .from(mailOutbox)
    .where(inArray(mailOutbox.invitationId, [...invitationIds]))
    .orderBy(desc(mailOutbox.createdAt))

  const found = new Map<string, InvitationMail>()

  for (const row of rows) {
    if (row.invitationId !== null && !found.has(row.invitationId)) {
      found.set(row.invitationId, {
        status: row.status,
        sentAt: row.sentAt,
        lastError: row.lastError,
      })
    }
  }

  return found
}

/**
 * How this application sends an invitation by mail, for the administration of
 * a business. That is the foundation's (ADR 0010) and knows neither a mail
 * server nor an outbox, only that there may be something that sends.
 *
 * An invitation is a cause like a due task: the message is written when the
 * invitation is made and goes out with the job, which makes the link as it
 * sends. The link starts with the address every link in a message starts
 * with, so there is a sender only where the instance has that address to
 * give. How a message stands is read either way.
 */
export function invitationMailing(
  database: Database,
  mail: { readonly origin: string } | null,
): InvitationMailing {
  return {
    sender: mail && {
      ready: (identity) => requireMailServer(database, identity),
      send: async (identity, invitationId) => {
        await notify(
          database,
          identity.tenantId,
          { kind: 'invitation', invitationId, requestedBy: identity.userId },
          { origin: mail.origin },
        )
      },
    },
    mailsOf: invitationMails,
  }
}
