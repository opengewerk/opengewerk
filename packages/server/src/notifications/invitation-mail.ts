import type { InvitationId } from '@opengewerk/domain'
import { desc, inArray } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { mailOutbox } from '../database/schema/index.js'

/** Where the message with an invitation stands. */
export interface InvitationMail {
  readonly status: 'pending' | 'sent' | 'failed'
  readonly sentAt: Date | null
  readonly lastError: string | null
}

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
