import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

/**
 * Where the runner records what it has applied: a schema and a table in it.
 *
 * Every application has its own stream of migrations (ADR 0010) and its own
 * database, so the record of one never meets the record of another, and the
 * names drizzle-kit writes are the ones to read back with. An application that
 * wants its record elsewhere says so, and the check below follows it there.
 */
export interface MigrationHistory {
  readonly schema: string
  readonly table: string
}

/** The names drizzle-kit uses unless told otherwise. */
export const defaultMigrationHistory: MigrationHistory = {
  schema: 'drizzle',
  table: '__drizzle_migrations',
}

const plainName = /^[a-z_][a-z0-9_]*$/

/**
 * The record as it goes into a statement, quoted.
 *
 * The names come from the code of an application and never from a request.
 * They are held to plain names all the same: this is one of the few places
 * where a name is put into a statement rather than passed beside it, and a
 * name that needed quoting rules of its own would be the start of a mistake.
 */
function qualified(history: MigrationHistory): string {
  if (!plainName.test(history.schema) || !plainName.test(history.table)) {
    throw new Error(
      `Not a name for the migration history: ${JSON.stringify(history.schema)}.${JSON.stringify(history.table)}`,
    )
  }

  return `"${history.schema}"."${history.table}"`
}

/** One migration as the image carries it: the file, and what identifies it. */
export interface MigrationFile {
  /** The file name without the extension, the way the journal spells it. */
  readonly tag: string
  /** SHA-256 over the file, the same way the runner computes it. */
  readonly hash: string
  /** The timestamp from the journal. The runner orders by it. */
  readonly when: number
}

/** What the check found. Separate class so the command can print it plainly. */
export class MigrationHistoryError extends Error {}

/**
 * Reads the journal and the files beside it.
 *
 * The hash has to be computed exactly as the runner does, because it is
 * compared against what the runner wrote into the database: SHA-256 over the
 * file decoded as UTF-8, not over its bytes and not over a normalized form.
 */
export function readMigrationIndex(folder: string): MigrationFile[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { idx: number; when: number; tag: string }[]
  }

  return [...journal.entries]
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => ({
      tag: entry.tag,
      hash: createHash('sha256')
        .update(readFileSync(join(folder, `${entry.tag}.sql`), 'utf8'))
        .digest('hex'),
      when: entry.when,
    }))
}

/**
 * What the database says has run, oldest first, with the timestamp the runner
 * wrote for each. Empty for a fresh database.
 */
async function appliedMigrations(
  pool: Pool,
  history: MigrationHistory,
): Promise<{ hash: string; when: number }[]> {
  const table = qualified(history)
  const { rows: existing } = await pool.query<{ table: string | null }>(
    'select to_regclass($1) as table',
    [table],
  )

  if (!existing[0]?.table) {
    return []
  }

  // By id, which is the order they were inserted in and therefore the order
  // they ran in. Not by created_at: that is the timestamp from the journal,
  // and a wrong one there is exactly what this check is meant to catch.
  const { rows } = await pool.query<{ hash: string; created_at: string | null }>(
    `select hash, created_at from ${table} order by id`,
  )

  return rows.map((row) => ({ hash: row.hash, when: Number(row.created_at ?? 0) }))
}

/**
 * The first migration of the journal whose timestamp is not after the one
 * before it, or null when they all rise.
 *
 * On an empty database the runner takes every migration in the order of the
 * journal, whatever its timestamp, so a journal like that passes every test
 * that starts from nothing. It fails on an installation that already has the
 * one before: there the runner passes over it, as `checkMigrationHistory`
 * explains. Two branches merged in another order than their migrations were
 * made in leave a journal like that.
 */
function outOfOrder(files: readonly MigrationFile[]): [MigrationFile, MigrationFile] | null {
  for (const [position, file] of files.entries()) {
    const before = files[position - 1]

    if (before && file.when <= before.when) {
      return [before, file]
    }
  }

  return null
}

/**
 * Holds the database against the migrations this image carries, and refuses
 * every way the two can disagree.
 *
 * The runner does not do this itself. It writes a hash per migration and then
 * only ever compares the timestamp of the newest applied one, so a migration
 * that was changed after it ran is skipped without a word, and so is a new one
 * whose timestamp happens to sit before it, while the ones after it in the same
 * run are applied. Both leave a database whose state no file describes, and
 * both are found here instead. Before the run: the timestamps of the journal
 * rise, what is applied is the beginning of what the image carries, and every
 * migration still to come has a timestamp after the newest that ran. After the
 * run, everything the image carries has to be applied.
 *
 * Refusing is the point. An update that stops with a reason costs an evening;
 * one that runs on a schema nobody can name costs the installation.
 */
export async function checkMigrationHistory(
  pool: Pool,
  files: readonly MigrationFile[],
  stage: 'before' | 'after',
  history: MigrationHistory = defaultMigrationHistory,
): Promise<void> {
  const disorder = stage === 'before' ? outOfOrder(files) : null

  if (disorder) {
    const [before, file] = disorder

    throw new MigrationHistoryError(
      `Im Journal liegt der Zeitstempel der Migration "${file.tag}" nicht nach dem von ` +
        `"${before.tag}". Auf einer Datenbank, die "${before.tag}" schon kennt, übergeht der ` +
        'Migrationslauf sie stillschweigend und spielt die späteren ein. Das passiert, wenn ' +
        'zwei Branches in einer anderen Reihenfolge gemergt werden, als ihre Migrationen ' +
        'entstanden sind. Die Migration braucht einen Zeitstempel nach dem der vorigen. Es ' +
        'wurde nichts eingespielt.',
    )
  }

  const applied = await appliedMigrations(pool, history)

  if (applied.length > files.length) {
    throw new MigrationHistoryError(
      `Die Datenbank kennt ${applied.length} Migrationen, dieses Abbild bringt nur ` +
        `${files.length} mit. Das Abbild ist also älter als die Datenbank, meistens ein ` +
        'zurückgedrehtes Update. Zurück geht nicht: das ältere Abbild kennt die Spalten ' +
        'nicht, die der neuere Stand angelegt hat. Entweder wieder das neuere Abbild ' +
        'nehmen oder die Sicherung von vor dem Update zurückspielen. Es wurde nichts ' +
        'eingespielt.',
    )
  }

  for (const [position, entry] of applied.entries()) {
    const file = files[position]

    if (file && entry.hash !== file.hash) {
      throw new MigrationHistoryError(
        `Die Migration "${file.tag}" ist nicht mehr die, die auf dieser Datenbank ` +
          'gelaufen ist. Entweder wurde die Datei nachträglich geändert, oder es wurde ' +
          'eine neue Migration vor sie gesetzt. Eine gemergte Migration bleibt, wie sie ' +
          'ist, sonst hat die Datenbank einen Stand, den keine Datei beschreibt. Was ' +
          'geändert werden soll, gehört in eine neue Migration. Es wurde nichts ' +
          'eingespielt.',
      )
    }
  }

  // The journal rises, but the database has the word: a timestamp changed in
  // the journal after its migration ran is still the old one there.
  const newest = applied.reduce((latest, entry) => Math.max(latest, entry.when), 0)
  const late =
    stage === 'before' && applied.length > 0
      ? files.slice(applied.length).find((file) => file.when <= newest)
      : undefined

  if (late) {
    throw new MigrationHistoryError(
      `Die Migration "${late.tag}" hat einen Zeitstempel, der nicht nach dem der zuletzt ` +
        'eingespielten liegt. Der Migrationslauf vergleicht nur mit der neuesten, er würde ' +
        'sie stillschweigend übergehen und die späteren einspielen. Die Migration braucht ' +
        'einen Zeitstempel nach dem der letzten, dann läuft sie. Es wurde nichts eingespielt.',
    )
  }

  if (stage === 'after' && applied.length < files.length) {
    const missing = files[applied.length]

    throw new MigrationHistoryError(
      `Nach dem Lauf fehlen ${files.length - applied.length} Migrationen in der ` +
        `Datenbank, die erste ist "${missing?.tag}". Das passiert, wenn ihr Zeitstempel ` +
        'im Journal vor dem der zuletzt eingespielten liegt: der Migrationslauf ' +
        'vergleicht nur mit der neuesten und übergeht sie dann stillschweigend. Die ' +
        'Migration braucht einen Zeitstempel nach dem der letzten, dann läuft sie.',
    )
  }
}

/**
 * Brings a database up to the state the migrations in a folder describe.
 *
 * Runs as the role that owns the tables, never as the one the application
 * connects with: migrations create and alter, and the application role has
 * neither right. Keeping the two apart is what makes it impossible for a
 * mistake in a request to change the schema.
 *
 * Every pending migration runs inside one transaction, all of them together.
 * A failure in the third of three therefore leaves the database exactly at the
 * state it had before the update, not somewhere in the middle of it. The price
 * is that a migration must not contain anything that cannot run inside a
 * transaction, CREATE INDEX CONCURRENTLY above all.
 *
 * Whether an instance is still running on that state afterwards is a different
 * question, and one about the order of the update rather than about this
 * function.
 *
 * The folder is the application's: its migrations are its own, and the
 * foundation brings none. A test passes an older state of the folder, which is
 * what an older image is.
 */
export async function runMigrations(
  connectionString: string,
  folder: string,
  history: MigrationHistory = defaultMigrationHistory,
): Promise<void> {
  const files = readMigrationIndex(folder)
  const pool = new Pool({ connectionString, max: 1 })

  try {
    await checkMigrationHistory(pool, files, 'before', history)
    await migrate(drizzle(pool), {
      migrationsFolder: folder,
      migrationsSchema: history.schema,
      migrationsTable: history.table,
    })
    await checkMigrationHistory(pool, files, 'after', history)
  } finally {
    await pool.end()
  }
}
