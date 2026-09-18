import { documentKinds, documentStatuses } from '@opengewerk/domain'
import {
  type AnyPgColumn,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { customers } from './customers.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'
import { sites } from './sites.js'

export const documentKind = pgEnum('document_kind', documentKinds)
export const documentStatus = pgEnum('document_status', documentStatuses)

/**
 * A document. The predecessor reference carries the chain of section 1.4:
 * quote, order confirmation, delivery note, invoice. Walking it is how the
 * quantity comparison works later, instead of guessing from dates.
 *
 * The number stays empty while the document is a draft. It is assigned when
 * the document is issued, server side and gap free, which is its own issue.
 * Nothing here enforces that yet; the model only leaves room for it.
 */
export const documents = pgTable(
  'documents',
  {
    id: primaryId<'document'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    jobId: reference<'job'>('job_id').references(() => jobs.id, { onDelete: 'restrict' }),
    siteId: reference<'site'>('site_id').references(() => sites.id, { onDelete: 'restrict' }),
    installationId: reference<'installation'>('installation_id').references(
      () => installations.id,
      { onDelete: 'restrict' },
    ),
    predecessorDocumentId: reference<'document'>('predecessor_document_id').references(
      (): AnyPgColumn => documents.id,
      { onDelete: 'restrict' },
    ),
    kind: documentKind('kind').notNull(),
    status: documentStatus('status').notNull().default('draft'),
    number: text('number'),
    documentDate: date('document_date').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    subject: text('subject'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('documents_customer_idx').on(table.tenantId, table.customerId),
    index('documents_job_idx').on(table.tenantId, table.jobId),
    index('documents_predecessor_idx').on(table.predecessorDocumentId),
  ],
)
