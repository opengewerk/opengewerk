import { gridOperatorLimits } from '@opengewerk/domain'
import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, date, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

/**
 * The grid operators the business reports installations to (#306), with the
 * entry of the business in each one's installer directory: its number, the
 * last day it holds and the responsible electrician. Before that day a
 * deadline reminds (`elektro.installer_registration`).
 *
 * No sync columns: the office keeps them at a desk, and an installation that
 * names one carries only its key to the device. Removed by marking, not for
 * real, so that an installation deleted long ago may still name it; one that
 * a living installation names is not removed at all. The application may add
 * and change a row, never delete one.
 */
export const gridOperators = pgTable(
  'grid_operators',
  {
    id: primaryId<'grid-operator'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    portalUrl: text('portal_url'),
    requirements: text('requirements'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    registrationNumber: text('registration_number'),
    registeredUntil: date('registered_until'),
    responsibleElectrician: text('responsible_electrician'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('grid_operators_tenant_id_key').on(table.tenantId, table.id),
    check(
      'grid_operators_texts_fit',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(gridOperatorLimits.name))}
        and char_length(coalesce(${table.portalUrl}, '')) <= ${sql.raw(String(gridOperatorLimits.portalUrl))}
        and char_length(coalesce(${table.requirements}, '')) <= ${sql.raw(String(gridOperatorLimits.requirements))}
        and char_length(coalesce(${table.contactName}, '')) <= ${sql.raw(String(gridOperatorLimits.contact))}
        and char_length(coalesce(${table.contactEmail}, '')) <= ${sql.raw(String(gridOperatorLimits.contact))}
        and char_length(coalesce(${table.contactPhone}, '')) <= ${sql.raw(String(gridOperatorLimits.contact))}
        and char_length(coalesce(${table.registrationNumber}, '')) <= ${sql.raw(String(gridOperatorLimits.registrationNumber))}
        and char_length(coalesce(${table.responsibleElectrician}, '')) <= ${sql.raw(String(gridOperatorLimits.contact))}`,
    ),
  ],
)
