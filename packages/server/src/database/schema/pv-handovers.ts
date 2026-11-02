import { primaryId, reference, tenantIsolation } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { date, foreignKey, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { installations } from './installations.js'

/**
 * The handovers of the papers of a PV system to its operator (#305): each one
 * the folder as it was that day, frozen like a document. `content` holds the
 * components, the strings, the forecast and which signed protocols belong to
 * it; the PDF is printed from that and from those protocols, which never
 * change once signed, and nothing done to the system later reaches it.
 *
 * Made in the office at the routes of the installation and read there; it
 * goes to no device. The application may add a row and read it, and neither
 * change nor delete one, as with an issued document.
 */
export const pvHandovers = pgTable(
  'pv_handovers',
  {
    id: primaryId<'pv-handover'>(),
    ...tenantColumn,
    installationId: reference<'installation'>('installation_id').notNull(),
    handedOverOn: date('handed_over_on').notNull(),
    content: jsonb('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'pv_handovers_installation_in_tenant',
    }).onDelete('restrict'),
    index('pv_handovers_installation_idx').on(table.tenantId, table.installationId),
  ],
)
