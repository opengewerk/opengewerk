import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { defaultMigrationHistory, type MigrationHistory } from '../database/migrations.js'
import { applicationRoleName } from '../database/roles.js'
import {
  foundationBlocks,
  readBlock,
  readBlockRollback,
  readRolesBlock,
  statementBreakpoint,
} from './blocks.js'
import {
  foundationGuards,
  protectionStatements,
  type TableGuard,
  triggerStatements,
} from './guards.js'

// The first migration of an application (ADR 0010, point 9).
//
// Every application has its own stream of migrations, and a new one does not
// start by copying sixty files of another. It lets drizzle-kit generate what
// drizzle-kit can, the tables, keys and policies of the schema, and this puts
// around it what drizzle-kit cannot: the role before, and after it FORCE, the
// grants, the functions and the triggers. The result is filed as the first
// migration and is frozen from then on, like every migration.

const name = '[a-z_][a-z0-9_]*'
const createdTable = new RegExp(`^CREATE TABLE "(${name})" \\(`, 'gm')
const createdType = new RegExp(`^CREATE TYPE "public"\\."(${name})" AS ENUM`, 'gm')
const createdPolicy = new RegExp(`^CREATE POLICY "(${name})" ON "(${name})"`, 'gm')
const foreignKey = new RegExp(
  `^ALTER TABLE "(${name})" ADD CONSTRAINT "${name}" FOREIGN KEY \\([^)]*\\) REFERENCES "public"\\."(${name})"`,
  'gm',
)
const plainName = new RegExp(`^${name}$`)

function all(pattern: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))]
}

const addsForeignKey =
  /^ALTER TABLE "[a-z_][a-z0-9_]*" ADD CONSTRAINT "[a-z_][a-z0-9_]*" FOREIGN KEY /
const createsUniqueIndex = /^CREATE UNIQUE INDEX /

/**
 * The statements drizzle-kit generated for an empty database, with the unique
 * indexes in front of the foreign keys.
 *
 * drizzle-kit writes every key before every index. A key that leans on a
 * unique index rather than on a unique constraint is then refused, because the
 * index is not there yet: the key of a version of a file onto the stored
 * files is one, over tenant and hash. In an application that got its files
 * with a later migration the index has long been there; in a first migration
 * that creates both, it has to come first. Everything else keeps its order.
 */
export function uniqueIndexesBeforeKeys(statements: readonly string[]): string[] {
  const firstKey = statements.findIndex((statement) => addsForeignKey.test(statement.trimStart()))

  if (firstKey === -1) {
    return [...statements]
  }

  const late = (statement: string, position: number) =>
    position > firstKey && createsUniqueIndex.test(statement.trimStart())

  return [
    ...statements.slice(0, firstKey),
    ...statements.filter(late),
    ...statements
      .slice(firstKey)
      .filter((statement, position) => !late(statement, position + firstKey)),
  ]
}

/** What an initial migration is put together for. */
export interface InitialMigrationOptions {
  /**
   * What each table the migration creates needs. The tables of the foundation
   * by default; an application whose first migration already creates tables
   * of its own hands in theirs as well.
   */
  readonly guards?: readonly TableGuard[]
}

/** Statements one under the other, with the mark the runner splits on. */
function separated(statements: readonly string[]): string {
  return statements.join(`${statementBreakpoint}\n`)
}

/**
 * The tables a generated migration creates, held against the descriptions.
 *
 * Both directions are refused. A table without a description would be created
 * without FORCE and without a grant, which is a table every tenant reads or
 * nobody does. A description without a table means the schema the migration
 * was generated from is not the one the descriptions were written for,
 * usually because the tables of the foundation are missing from it.
 */
function guardsFor(generated: string, guards: readonly TableGuard[]): readonly TableGuard[] {
  const created = all(createdTable, generated).map((match) => match[1] as string)
  const described = new Set(guards.map((guard) => guard.table))
  const unguarded = created.filter((table) => !described.has(table))
  const missing = [...described].filter((table) => !created.includes(table))

  if (created.length === 0) {
    throw new Error('The migration creates no table, so it is not an initial migration')
  }

  if (unguarded.length > 0) {
    throw new Error(
      `No description of what these tables need, so nothing would guard them: ${unguarded.join(', ')}`,
    )
  }

  if (missing.length > 0) {
    throw new Error(
      `The migration does not create these tables, though they are described: ${missing.join(', ')}. ` +
        'The schema it was generated from has to hand on "@opengewerk/platform-server/schema".',
    )
  }

  // In the order the tables are created, so the file reads top to bottom.
  return created.map((table) => guards.find((guard) => guard.table === table) as TableGuard)
}

/**
 * Puts the building blocks of the foundation around what drizzle-kit
 * generated for an empty database.
 *
 * `generated` is the file as drizzle-kit wrote it, unchanged. What comes back
 * is the whole migration.
 */
export function completeInitialMigration(
  generated: string,
  options: InitialMigrationOptions = {},
): string {
  if (generated.includes('CREATE ROLE')) {
    throw new Error('This migration already creates a role, so it has been completed before')
  }

  const guards = guardsFor(generated, options.guards ?? foundationGuards)
  const triggers = guards.flatMap(triggerStatements)

  const parts = [
    `-- The foundation (ADR 0010 in the repository "opengewerk"): the tables every
-- application of the organisation carries, and what keeps tenants apart and
-- the log complete around them.
--
-- Put together by \`completeInitialMigration\` of @opengewerk/platform-server.
-- The tables, keys and policies in the second part are what drizzle-kit
-- generated from the schema; everything else is a building block of the
-- foundation, which knows what drizzle-kit does not: the role, FORCE, the
-- grants, the functions and the triggers.
--
-- From here on this file is frozen like every migration. A correction is a
-- new migration, because this one has run on somebody's database.

-- Part 1 of 5: the role. First, because the policies below name it.

${readRolesBlock()}`,

    `-- Part 2 of 5: the tables, as drizzle-kit generated them.

${generated.trim()}`,

    `-- Part 3 of 5: FORCE, and what the application role may do with each table.
--
-- drizzle-kit switches row level security on wherever a table has a policy.
-- FORCE is what makes the policies apply to the owner of the tables as well,
-- and without a grant the role does not see a table at all. The rights are
-- given table by table and never for the schema as a whole: a table added
-- later starts with none.

${separated(guards.flatMap(protectionStatements))}`,

    ...foundationBlocks.map(
      (block, position) =>
        `${position === 0 ? '-- Part 4 of 5: the functions, and what a block brings with them.\n\n' : ''}${readBlock(block)}`,
    ),
  ]

  if (triggers.length > 0) {
    parts.push(`-- Part 5 of 5: the triggers on the tables, which call the functions above.

${separated(triggers)}`)
  }

  return `${parts.join(`${statementBreakpoint}\n\n`)}\n`
}

/**
 * The order in which tables can be dropped without CASCADE: whatever points at
 * a table goes before it.
 *
 * No CASCADE on purpose. It would also clear away what somebody built next to
 * these tables later, and that is exactly what should be noticed instead of
 * disappearing without a word.
 */
function dropOrder(generated: string): string[] {
  const remaining = all(createdTable, generated).map((match) => match[1] as string)
  const references = all(foreignKey, generated)
    .map((match) => ({ from: match[1] as string, to: match[2] as string }))
    .filter((reference) => reference.from !== reference.to)
  const order: string[] = []

  while (remaining.length > 0) {
    // The last one created that nothing still standing points at.
    const next = [...remaining]
      .reverse()
      .find(
        (table) =>
          !references.some(
            (reference) => reference.to === table && remaining.includes(reference.from),
          ),
      )

    if (!next) {
      throw new Error(
        `These tables point at each other in a circle and cannot be dropped in any order: ${remaining.join(', ')}`,
      )
    }

    order.push(next)
    remaining.splice(remaining.indexOf(next), 1)
  }

  return order
}

/**
 * What takes the initial migration back out, down to an empty database.
 *
 * The record of the runner goes last: after this file there is nothing left
 * for it to describe. The role stays. It belongs to the cluster and may hold
 * rights elsewhere, and a rollback that drops a role may take more with it
 * than its migration created.
 */
export function initialMigrationRollback(
  generated: string,
  history: MigrationHistory = defaultMigrationHistory,
): string {
  if (!plainName.test(history.schema) || !plainName.test(history.table)) {
    throw new Error(
      `Not a name for the migration history: ${JSON.stringify(history.schema)}.${JSON.stringify(history.table)}`,
    )
  }

  const policies = all(createdPolicy, generated).map(
    (match) => `DROP POLICY IF EXISTS "${match[1]}" ON "${match[2]}";`,
  )
  const tables = dropOrder(generated).map((table) => `DROP TABLE IF EXISTS "${table}";`)
  const types = all(createdType, generated)
    .map((match) => `DROP TYPE IF EXISTS "public"."${match[1]}";`)
    .reverse()
  const record = [`DROP TABLE IF EXISTS "${history.schema}"."${history.table}";`]

  if (history.schema !== 'public') {
    record.push(`DROP SCHEMA IF EXISTS "${history.schema}";`)
  }

  const parts = [
    `-- The rollback for the initial migration: back to an empty database.
--
-- The functions and triggers first, in the opposite order to the one they
-- were created in, then the tables.

${[...foundationBlocks]
  .reverse()
  .map((block) => readBlockRollback(block))
  .join(`${statementBreakpoint}\n\n`)}`,

    `-- The policies before the tables. One of them reads another table, the
-- chooser on \`tenants\` reads the memberships, and a table a policy still
-- reads cannot be dropped.
${separated(policies)}`,

    `-- The tables, whatever points at a table before the table itself, and no
-- CASCADE: that would also clear away what somebody built next to them later,
-- and exactly that should be noticed instead of disappearing without a word.
${separated(tables)}`,
  ]

  if (types.length > 0) {
    parts.push(separated(types))
  }

  parts.push(`-- The way into the schema. The role itself stays: it belongs to the cluster
-- and may hold rights elsewhere.
REVOKE USAGE ON SCHEMA "public" FROM "${applicationRoleName}";`)

  parts.push(`-- And the record of the runner, last: there is nothing left for it to describe.
${separated(record)}`)

  return `${parts.join(`${statementBreakpoint}\n\n`)}\n`
}

/** What completing the first migration of a folder comes back with. */
export interface CompletedInitialMigration {
  /** The tag of the migration, the way the journal spells it. */
  readonly tag: string
  /** The file that was completed, and the rollback written beside it. */
  readonly file: string
  readonly rollback: string
}

/**
 * Completes the first migration of a migrations folder where it lies, and
 * writes its rollback under `down/`.
 *
 * For the one moment an application is begun: `drizzle-kit generate` has just
 * written the first migration and its snapshot, and nothing has run anywhere.
 * A folder with more than one migration is refused, because then the first one
 * has run somewhere, and a migration that has run is not changed.
 */
export function completeInitialMigrationIn(
  folder: string,
  options: InitialMigrationOptions & { readonly history?: MigrationHistory } = {},
): CompletedInitialMigration {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  const [first, ...later] = journal.entries

  if (!first || later.length > 0) {
    throw new Error(
      `Only the first migration of an application is completed, and "${folder}" holds ${journal.entries.length}`,
    )
  }

  const file = join(folder, `${first.tag}.sql`)
  const rollback = join(folder, 'down', `${first.tag}.sql`)
  const generated = readFileSync(file, 'utf8')

  // Both are worked out before either is written, so that a refusal leaves
  // the folder as it was.
  const completed = completeInitialMigration(generated, options)
  const back = initialMigrationRollback(generated, options.history)

  writeFileSync(file, completed, 'utf8')
  mkdirSync(join(folder, 'down'), { recursive: true })
  writeFileSync(rollback, back, 'utf8')

  return { tag: first.tag, file, rollback }
}
