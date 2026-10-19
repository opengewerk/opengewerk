import { photovoltaicSchema, reference } from '@opengewerk/platform-server'
import { foreignKey, index } from 'drizzle-orm/pg-core'

import { installations } from './installations.js'

/**
 * The structure below a PV system: inverter, string, module (#300). The
 * tables are the foundation's (`photovoltaicSchema`, ADR 0014), under the
 * names they had here before. Kept here is what an inverter hangs on: the
 * installation that is the PV system, through the business as well as the id.
 */
export const { inverters, pvStrings, pvModules } = photovoltaicSchema({
  inverters: {
    columns: { installationId: reference<'installation'>('installation_id').notNull() },
    constraints: (table) => [
      foreignKey({
        columns: [table.tenantId, table.installationId],
        foreignColumns: [installations.tenantId, installations.id],
        name: 'inverters_installation_in_tenant',
      }).onDelete('cascade'),
      index('inverters_installation_idx').on(table.installationId),
    ],
  },
})
