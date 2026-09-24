import { longestFormValues } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import { check, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * The forms a business writes itself (#78), one row per version: first and
 * for now only the fields it gives its reports, under the key `report`.
 *
 * The one place a form definition lives in the database. A trade package
 * brings its forms as files and they are built in; a business's fields are
 * written in the settings, and a device needs them without a network, so
 * they are rows that travel like any other. A change is the next version and
 * never an edit: a report keeps the version it was started with, and a
 * trigger of migration 0044 refuses any change or deletion of a row.
 *
 * The definition is JSON text in the format of `FormDefinition`, and its own
 * version is `definition_version`; `version` is the counter of the sync, as
 * on every other row.
 */
export const formDefinitions = pgTable(
  'form_definitions',
  {
    id: primaryId<'form-definition'>(),
    ...tenantColumn,
    key: text('key').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    definition: text('definition').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('form_definitions_version_once').on(
      table.tenantId,
      table.key,
      table.definitionVersion,
    ),
    check('form_definitions_version_positive', sql`${table.definitionVersion} > 0`),
    check(
      'form_definitions_bounded',
      sql`char_length(${table.definition}) <= ${sql.raw(String(longestFormValues))}`,
    ),
  ],
)
