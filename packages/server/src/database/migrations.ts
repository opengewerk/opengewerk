import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

/**
 * Where the migration files live, relative to this file rather than to the
 * working directory. The built output keeps the same depth as the source, so
 * the one path works for both, and neither depends on where a container was
 * started from.
 */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

/**
 * Where the migration runner records what it has applied. Written by
 * drizzle-kit with these names, so they are read back with them.
 */
const historyTable = 'drizzle.__drizzle_migrations'

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
export function readMigrationIndex(folder: string = migrationsFolder): MigrationFile[] {
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

/** What the database says has run, oldest first. Empty for a fresh database. */
async function appliedMigrations(pool: Pool): Promise<{ hash: string }[]> {
  const { rows: existing } = await pool.query<{ table: string | null }>(
    `select to_regclass('${historyTable}') as table`,
  )

  if (!existing[0]?.table) {
    return []
  }

  // By id, which is the order they were inserted in and therefore the order
  // they ran in. Not by created_at: that is the timestamp from the journal,
  // and a wrong one there is exactly what this check is meant to catch.
  const { rows } = await pool.query<{ hash: string }>(
    `select hash from ${historyTable} order by id`,
  )

  return rows
}

/**
 * Holds the database against the migrations this image carries, and refuses
 * every way the two can disagree.
 *
 * The runner does not do this itself. It writes a hash per migration and then
 * only ever compares the timestamp of the newest applied one, so a migration
 * that was changed after it ran is skipped without a word, and so is a new one
 * whose timestamp happens to sit before it. Both leave a database whose state
 * no file describes, and both are found here instead: once before the run,
 * where what is applied has to be the beginning of what the image carries, and
 * once after, where everything the image carries has to be applied.
 *
 * Refusing is the point. An update that stops with a reason costs an evening;
 * one that runs on a schema nobody can name costs the installation.
 */
export async function checkMigrationHistory(
  pool: Pool,
  files: readonly MigrationFile[],
  stage: 'before' | 'after',
): Promise<void> {
  const applied = await appliedMigrations(pool)

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
 * Brings a database up to the state this image carries.
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
 * transaction, CREATE INDEX CONCURRENTLY above all; a test holds that.
 *
 * Whether an instance is still running on that state afterwards is a different
 * question, and one about the order of the update rather than about this
 * function. It is answered in the README under "Aktualisieren".
 *
 * The folder is a parameter so that a test can run an older state of it, which
 * is what an older image is. Operation never passes it.
 */
export async function runMigrations(
  connectionString: string,
  folder: string = migrationsFolder,
): Promise<void> {
  const files = readMigrationIndex(folder)
  const pool = new Pool({ connectionString, max: 1 })

  try {
    await checkMigrationHistory(pool, files, 'before')
    await migrate(drizzle(pool), { migrationsFolder: folder })
    await checkMigrationHistory(pool, files, 'after')
  } finally {
    await pool.end()
  }
}
