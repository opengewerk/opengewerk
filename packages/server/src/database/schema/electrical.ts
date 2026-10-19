import { electricalSchema, reference } from '@opengewerk/platform-server'
import { foreignKey, index } from 'drizzle-orm/pg-core'

import { installations } from './installations.js'

/**
 * The electrical structure below an installation: board, section, circuit,
 * equipment (#70). The tables are the foundation's (`electricalSchema`, ADR
 * 0014), under the names they had here before, so that no instance needs a
 * migration for the move. Kept here is what a board hangs on: the
 * installation, through the business as well as the id, like every part of
 * the structure hangs on its parent.
 */
export const {
  distributionBoardKind,
  overcurrentDevice,
  tripCharacteristic,
  rcdType,
  cableInstallationMethod,
  distributionBoards,
  boardSections,
  circuits,
  equipment,
} = electricalSchema({
  boards: {
    columns: { installationId: reference<'installation'>('installation_id').notNull() },
    constraints: (table) => [
      foreignKey({
        columns: [table.tenantId, table.installationId],
        foreignColumns: [installations.tenantId, installations.id],
        name: 'distribution_boards_installation_in_tenant',
      }).onDelete('cascade'),
      index('distribution_boards_installation_idx').on(table.installationId),
    ],
  },
})
