import { readFileSync } from 'node:fs'

// The SQL of the foundation that no schema describes, as files under `sql/`
// of this package: the role, and the functions and triggers of the audit log,
// the sync layer, the first run, the area of the instance, the versions of a
// file and the labels with a QR code. They are files and not strings in here
// so that they read, diff and review as what they are.
//
// They are the state the migrations of the trades application arrived at, and
// a test there holds every one of them against its database. A block that
// differs from that database is wrong, not the migration: a merged migration
// has run on somebody's installation, a block has not.

/** What drizzle-kit puts between two statements, and the runner splits on. */
export const statementBreakpoint = '--> statement-breakpoint'

/**
 * The blocks that stand on the tables, in the order they are applied: the
 * sync layer, the first run, the area of the instance and the versions of a
 * file call nothing of each other, the triggers on the tables call the first
 * two and the last.
 *
 * The last two bring functions and no table. The tables they keep are made
 * by an application: one that keeps files in its records
 * (`attachmentsSchema`), where the triggers that call the two functions come
 * with the description of those tables, and one that prints labels with a QR
 * code (`labelColumns`), which hangs the one function on its table itself.
 * In a database without such tables the functions stand unused.
 */
export const foundationBlocks = [
  'audit',
  'sync',
  'setup',
  'instance',
  'attachments',
  'labels',
] as const

export type FoundationBlock = (typeof foundationBlocks)[number]

function read(path: string): string {
  // Relative to this file, which sits two levels below the package both as
  // source and as built: `src/migration` and `dist/migration`.
  return readFileSync(new URL(`../../sql/${path}`, import.meta.url), 'utf8').trimEnd()
}

/** The role and its way into the schema. Before everything else: the policies name it. */
export function readRolesBlock(): string {
  return read('roles.sql')
}

export function readBlock(block: FoundationBlock): string {
  return read(`${block}.sql`)
}

/** What takes a block back out again. */
export function readBlockRollback(block: FoundationBlock): string {
  return read(`down/${block}.sql`)
}
