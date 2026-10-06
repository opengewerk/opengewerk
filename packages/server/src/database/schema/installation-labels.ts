import {
  labelCodeShaped,
  labelColumns,
  labelIsValid,
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { foreignKey, index, pgTable, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { installations } from './installations.js'

/**
 * The QR labels of the installations (#308), one row for each label that was
 * made, valid or blocked.
 *
 * The code is random and stands once in the whole instance, not once per
 * business: the address on the label carries nothing else, and in phase 5 the
 * same address opens the page of the customer without anybody signed in, so
 * the code alone has to name the label. An installation has at most one label
 * that is valid and not deleted, which the partial index holds.
 *
 * Made and blocked in the office at the routes of the installation; a device
 * reads the rows and writes none, and so opens an installation by its label
 * without a network. Blocking fills `blocked_at` and nothing else changes; a
 * deleted installation takes its labels with it (`mark_structure_deleted`).
 */
export const installationLabels = pgTable(
  'installation_labels',
  {
    id: primaryId<'installation-label'>(),
    ...tenantColumn,
    installationId: reference<'installation'>('installation_id').notNull(),
    ...labelColumns(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('installation_labels_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'installation_labels_installation_in_tenant',
    }).onDelete('restrict'),
    uniqueIndex('installation_labels_code_once').on(table.code),
    uniqueIndex('installation_labels_one_valid')
      .on(table.tenantId, table.installationId)
      .where(labelIsValid(table.blockedAt, table.deletedAt)),
    index('installation_labels_installation_idx').on(table.tenantId, table.installationId),
    // What `isLabelCode` asks, held here for every way in.
    labelCodeShaped('installation_labels_code_shaped', table.code),
  ],
)
