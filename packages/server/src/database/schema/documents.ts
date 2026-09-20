import { documentKinds, documentStatuses, taxTreatments } from '@opengewerk/domain'
import {
  type AnyPgColumn,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { sql } from 'drizzle-orm'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { customers } from './customers.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'
import { sites } from './sites.js'

export const documentKind = pgEnum('document_kind', documentKinds)
export const documentStatus = pgEnum('document_status', documentStatuses)
export const taxTreatment = pgEnum('tax_treatment', taxTreatments)

/**
 * A document. The predecessor reference carries the chain of section 1.4:
 * quote, order confirmation, delivery note, invoice. Walking it is how the
 * quantity comparison works later, instead of guessing from dates.
 *
 * The number stays empty while the document is a draft. It is assigned when
 * the document is issued, server side and gap free, and three things hold that
 * together: `assignDocumentNumber()` takes the counter under a row lock, the
 * trigger `documents_stay_fixed` refuses every later change to an issued
 * document, and the partial unique index below catches a number that somehow
 * got in by another way.
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
    /**
     * How this document is taxed, written when it is created and frozen when
     * it is issued. Not worked out on reading: the customer flag and the
     * tenant parameter it follows from both change, and an invoice issued
     * under section 19 has to go on saying so afterwards.
     */
    taxTreatment: taxTreatment('tax_treatment').notNull().default('standard'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('documents_customer_idx').on(table.tenantId, table.customerId),
    index('documents_job_idx').on(table.tenantId, table.jobId),
    index('documents_predecessor_idx').on(table.predecessorDocumentId),
    // The second lock on the numbering. The counter hands out each value once,
    // and this makes sure of it even if somebody ever writes a number by hand
    // or a counter is reset. Partial, because drafts carry no number and would
    // otherwise all collide on null.
    uniqueIndex('documents_number_unique')
      .on(table.tenantId, table.number)
      .where(sql`${table.number} is not null`),
  ],
)
