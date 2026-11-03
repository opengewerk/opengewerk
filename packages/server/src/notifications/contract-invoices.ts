import type { TenantId } from '@opengewerk/domain'
import type { Database } from '@opengewerk/platform-server'
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'

import { attachmentFor } from '../api/document-mail.controller.js'
import { customers, documents, mailOutbox, maintenanceContracts } from '../database/schema/index.js'
import { frozenContent } from '../documents/content.js'
import type { Notification } from './notify.js'

/** How far back an invoice issued by itself is still sent: a week of a mail server gone. */
const issuedWithinDays = 7

/**
 * The recurring invoices of maintenance contracts that were issued by
 * themselves (#295) and have no message yet: each goes to the customer's
 * address as if the office had pressed "Per E-Mail senden", without a sender
 * from the business. The attachment is the one the office would get, the
 * e-invoice where the customer is a business that needs it.
 *
 * An invoice whose customer has no address, or whose e-invoice the law
 * requires and which still lacks something, is not sent; the office sees it
 * among the documents and sends it once it can.
 */
export async function contractInvoicesToSend(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Extract<Notification, { readonly kind: 'document' }>[]> {
  const since = new Date(now.getTime() - issuedWithinDays * 86_400_000)

  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const rows = await tx
      .select({ id: documents.id, email: customers.email, name: customers.name })
      .from(documents)
      .innerJoin(maintenanceContracts, eq(maintenanceContracts.id, documents.maintenanceContractId))
      .innerJoin(customers, eq(customers.id, documents.customerId))
      .where(
        and(
          eq(documents.kind, 'recurring_invoice'),
          eq(documents.status, 'issued'),
          isNull(documents.issuedBy),
          isNull(documents.deletedAt),
          eq(maintenanceContracts.issueByItself, true),
          isNotNull(customers.email),
          gte(documents.issuedAt, since),
          sql`not exists (
            select 1 from ${mailOutbox}
             where ${mailOutbox.tenantId} = ${documents.tenantId}
               and ${mailOutbox.cause} = 'document:' || ${documents.id}::text || ':contract'
          )`,
        ),
      )

    const wanted: Extract<Notification, { readonly kind: 'document' }>[] = []

    for (const row of rows) {
      const content = await frozenContent(tx, row.id)

      if (content === null || row.email === null) {
        continue
      }

      try {
        wanted.push({
          kind: 'document',
          documentId: row.id,
          request: 'contract',
          to: { address: row.email, name: row.name },
          attachment: await attachmentFor(tx, content),
          requestedBy: null,
        })
      } catch {
        // The e-invoice the law requires lacks something: not sent by itself.
      }
    }

    return wanted
  })
}
