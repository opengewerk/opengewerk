import { type DocumentKind, instructionTemplates } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { documentKind } from './documents.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const instructionTemplate = pgEnum('instruction_template', instructionTemplates)

/**
 * The instructions a business hands its customers with a document: the
 * instruction on withdrawal, its form, and the ones the business writes.
 *
 * A shipped instruction is a row like any other, so that the business can
 * decide where it is proposed and whether it goes out with the document. Its
 * words are not in the row until the business changes them: an empty `body`
 * means the model as the package of this version has it, in the version in
 * force on the day of the document. The unique index keeps one row per
 * shipped instruction and business; the server writes the missing ones the
 * first time the business asks for its instructions.
 *
 * No sync columns. Instructions are kept at a desk, and a document takes a
 * copy of their words when it is issued, which is what a device and later the
 * customer portal read.
 *
 * Deleted for real when the business wrote it, like a text snippet: every
 * document that carried one has its words in its snapshot. A shipped one is
 * not deleted, the route refuses it; one that is proposed for nothing is the
 * way to stop using it.
 */
export const instructions = pgTable(
  'instructions',
  {
    id: primaryId<'instruction'>(),
    ...tenantColumn,
    template: instructionTemplate('template'),
    title: text('title').notNull(),
    body: text('body'),
    basedOn: date('based_on'),
    kinds: documentKind('kinds')
      .array()
      .notNull()
      .default(sql`'{}'`)
      .$type<readonly DocumentKind[]>(),
    consumersOnly: boolean('consumers_only').notNull().default(false),
    withDocument: boolean('with_document').notNull().default(true),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('instructions_template')
      .on(table.tenantId, table.template)
      .where(sql`${table.template} is not null`),
    // One the business wrote has words; only a shipped one may leave them to
    // the package.
    check('instructions_words', sql`${table.template} is not null or ${table.body} is not null`),
    // The version a wording was changed from belongs to a changed shipped
    // instruction and to nothing else.
    check(
      'instructions_based_on',
      sql`${table.basedOn} is null or (${table.template} is not null and ${table.body} is not null)`,
    ),
  ],
)
