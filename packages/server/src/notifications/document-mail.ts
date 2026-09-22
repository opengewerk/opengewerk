import type { DocumentId } from '@opengewerk/domain'
import { and, desc, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { mailOutbox } from '../database/schema/index.js'

/** One message about a document, as the screen of the document lists it. */
export interface DocumentMailRow {
  readonly id: string
  readonly to: string
  readonly attachment: 'pdf' | 'zugferd' | 'xrechnung' | null
  readonly status: 'pending' | 'sent' | 'failed'
  readonly attempts: number
  readonly lastError: string | null
  readonly sentAt: Date | null
  readonly createdAt: Date
  readonly requestedBy: string | null
}

/**
 * Every message about a document, newest first.
 *
 * Read here and not in the route, so that the outbox is touched in two places
 * only, where messages are written and where they are sent; the test in
 * `mail/boundaries.test.ts` holds that line.
 */
export async function messagesAbout(
  tx: TenantTransaction,
  documentId: DocumentId,
): Promise<readonly DocumentMailRow[]> {
  return tx
    .select({
      id: mailOutbox.id,
      to: mailOutbox.recipientAddress,
      attachment: mailOutbox.attachment,
      status: mailOutbox.status,
      attempts: mailOutbox.attempts,
      lastError: mailOutbox.lastError,
      sentAt: mailOutbox.sentAt,
      createdAt: mailOutbox.createdAt,
      requestedBy: mailOutbox.requestedBy,
    })
    .from(mailOutbox)
    .where(eq(mailOutbox.documentId, documentId))
    .orderBy(desc(mailOutbox.createdAt), desc(mailOutbox.id))
}

/**
 * Whether a message with this document to this address is still waiting.
 *
 * A second click on the button while the first message waits for a mail
 * server would send the customer the same invoice twice the moment it is
 * back. Once the first one went out or was given up on, sending again is a
 * decision somebody makes, because the customer lost it or the address was
 * wrong.
 */
export async function stillWaiting(
  tx: TenantTransaction,
  documentId: DocumentId,
  address: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: mailOutbox.id })
    .from(mailOutbox)
    .where(
      and(
        eq(mailOutbox.documentId, documentId),
        eq(mailOutbox.recipientAddress, address),
        eq(mailOutbox.status, 'pending'),
      ),
    )
    .limit(1)

  return row !== undefined
}
