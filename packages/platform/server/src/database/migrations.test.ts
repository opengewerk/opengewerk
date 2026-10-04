import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'

import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  defaultMigrationHistory,
  type MigrationHistory,
  MigrationHistoryError,
  readMigrationIndex,
  runMigrations,
} from './migrations.js'
import { probeDatabase, type ProbeMigration, probeMigrations } from './probe-database.js'
import { appliedMigrationCount, changeMigration, tableNames } from './test-database.js'

// The runner with migrations that are nobody's: two tables that exist for
// these tests only. What is held here is the mechanism every application
// relies on for its own stream, and it has to hold whichever folder it is
// given.

const first: ProbeMigration = {
  tag: '0000_first',
  sql: 'CREATE TABLE "probe_first" ("id" integer PRIMARY KEY);',
  when: 1_000,
}
const second: ProbeMigration = {
  tag: '0001_second',
  sql:
    'CREATE TABLE "probe_second" ("id" integer PRIMARY KEY);\n--> statement-breakpoint\n' +
    'ALTER TABLE "probe_first" ADD COLUMN "note" text;',
  when: 3_000,
}

let pool: Pool
const folders: string[] = []

function folderOf(...migrations: ProbeMigration[]): string {
  const folder = probeMigrations(migrations)
  folders.push(folder)

  return folder
}

const kit = probeDatabase(folderOf(first, second))

beforeAll(async () => {
  pool = await kit.connect()
})

beforeEach(async () => {
  await kit.resetSchema(pool)
})

afterEach(() => {
  // The folder of the kit stays for the whole file, the others go.
  for (const folder of folders.splice(1)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

afterAll(async () => {
  await kit.resetSchema(pool)
  await pool.end()

  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true })
  }
})

async function failure(run: Promise<void>): Promise<unknown> {
  try {
    await run
  } catch (error) {
    return error
  }

  return undefined
}

describe('the migration runner', () => {
  it('brings an empty database up to what the folder describes, and then does nothing', async () => {
    const folder = folderOf(first, second)

    await runMigrations(kit.ownerDatabaseUrl(), folder)

    expect(await tableNames(pool)).toEqual(['probe_first', 'probe_second'])
    expect(await appliedMigrationCount(pool)).toBe(2)

    // In front of every start, not only of an update: a database that is
    // current is left alone.
    await runMigrations(kit.ownerDatabaseUrl(), folder)

    expect(await appliedMigrationCount(pool)).toBe(2)
  })

  it('takes a later release from where the earlier one stopped', async () => {
    await runMigrations(kit.ownerDatabaseUrl(), folderOf(first))
    expect(await tableNames(pool)).toEqual(['probe_first'])

    await runMigrations(kit.ownerDatabaseUrl(), folderOf(first, second))

    expect(await tableNames(pool)).toEqual(['probe_first', 'probe_second'])
    expect(await appliedMigrationCount(pool)).toBe(2)
  })

  /**
   * All pending migrations in one transaction. A failure in the last of them
   * leaves the database at the state before the update, not somewhere in the
   * middle of it, which is why an update that stops needs no restore.
   */
  it('leaves nothing behind when one of several pending migrations fails', async () => {
    const broken: ProbeMigration = {
      tag: '0001_broken',
      sql: 'CREATE TABLE "probe_third" ("id" integer PRIMARY KEY);\n--> statement-breakpoint\nSELECT 1 / 0;',
      when: 3_000,
    }

    const error = await failure(runMigrations(kit.ownerDatabaseUrl(), folderOf(first, broken)))

    expect(error).toBeDefined()
    expect(error).not.toBeInstanceOf(MigrationHistoryError)
    expect(await tableNames(pool)).toEqual([])
  })

  it('refuses a migration that was changed after it ran', async () => {
    const folder = folderOf(first, second)

    await runMigrations(kit.ownerDatabaseUrl(), folder)
    changeMigration(folder, first.tag, '-- corrected afterwards')

    const error = await failure(runMigrations(kit.ownerDatabaseUrl(), folder))

    expect(error).toBeInstanceOf(MigrationHistoryError)
    expect((error as Error).message).toContain(`Die Migration "${first.tag}" ist nicht mehr die`)
    expect((error as Error).message).toContain('Es wurde nichts eingespielt.')
  })

  it('refuses an image that is older than the database', async () => {
    await runMigrations(kit.ownerDatabaseUrl(), folderOf(first, second))

    const error = await failure(runMigrations(kit.ownerDatabaseUrl(), folderOf(first)))

    expect(error).toBeInstanceOf(MigrationHistoryError)
    expect((error as Error).message).toContain('Das Abbild ist also älter als die Datenbank')
    expect(await tableNames(pool)).toEqual(['probe_first', 'probe_second'])
  })

  /**
   * The case the runner itself passes over without a word: a new migration
   * whose timestamp sits before the newest applied one, as two branches merged
   * in the wrong order leave it. The runner skips it and applies the ones after
   * it in the same run; until opengewerk-haustechnik#31 the check after the run
   * found that only once it was committed, and blamed a changed file. It is
   * refused before anything runs, and on a fresh database as well, where the
   * runner would take it.
   */
  const late: ProbeMigration = {
    tag: '0002_late',
    sql: 'CREATE TABLE "probe_late" ("id" integer PRIMARY KEY);',
    when: 2_000,
  }
  const later: ProbeMigration = {
    tag: '0003_later',
    sql: 'CREATE TABLE "probe_later" ("id" integer PRIMARY KEY);',
    when: 4_000,
  }

  it('refuses a journal whose timestamps do not rise, before anything runs', async () => {
    await runMigrations(kit.ownerDatabaseUrl(), folderOf(first, second))

    const error = await failure(
      runMigrations(kit.ownerDatabaseUrl(), folderOf(first, second, late, later)),
    )

    expect(error).toBeInstanceOf(MigrationHistoryError)
    expect((error as Error).message).toContain(`der Migration "${late.tag}" nicht nach dem von`)
    expect((error as Error).message).toContain('Es wurde nichts eingespielt.')
    expect(await tableNames(pool)).toEqual(['probe_first', 'probe_second'])
    expect(await appliedMigrationCount(pool)).toBe(2)

    await kit.resetSchema(pool)

    expect(
      await failure(runMigrations(kit.ownerDatabaseUrl(), folderOf(first, second, late, later))),
    ).toBeInstanceOf(MigrationHistoryError)
    expect(await tableNames(pool)).toEqual([])
  })

  /**
   * A journal that rises can still disagree with the database: a timestamp
   * changed after its migration ran is the old one there, and the runner
   * compares against that.
   */
  it('refuses a migration that would sit before the newest that ran, by what the database says', async () => {
    await runMigrations(kit.ownerDatabaseUrl(), folderOf(first, second))

    const restamped: ProbeMigration = { ...second, when: 2_000 }
    const between: ProbeMigration = { ...late, when: 2_500 }
    const error = await failure(
      runMigrations(kit.ownerDatabaseUrl(), folderOf(first, restamped, between)),
    )

    expect(error).toBeInstanceOf(MigrationHistoryError)
    expect((error as Error).message).toContain(`Die Migration "${late.tag}" hat einen Zeitstempel`)
    expect((error as Error).message).toContain('Es wurde nichts eingespielt.')
    expect(await tableNames(pool)).not.toContain('probe_late')
  })

  it('reads a folder the way the runner hashes it', () => {
    const index = readMigrationIndex(folderOf(second, first))

    // In the order of the journal, which is the order the folder was built in.
    expect(index.map((file) => file.tag)).toEqual([second.tag, first.tag])
    expect(index[1]).toEqual({
      tag: first.tag,
      // SHA-256 over the text of the file, which is what the runner writes
      // into the database and what the check compares against.
      hash: createHash('sha256').update(first.sql, 'utf8').digest('hex'),
      when: first.when,
    })
  })
})

describe('the record of what has run', () => {
  const elsewhere: MigrationHistory = { schema: 'probe_history', table: 'applied' }

  afterEach(async () => {
    await pool.query(`drop schema if exists "${elsewhere.schema}" cascade`)
  })

  it('is kept where the application says, and read back from there', async () => {
    const folder = folderOf(first, second)

    await runMigrations(kit.ownerDatabaseUrl(), folder, elsewhere)

    const { rows } = await pool.query<{ count: string }>(
      `select count(*) as count from "${elsewhere.schema}"."${elsewhere.table}"`,
    )
    expect(Number(rows[0]?.count)).toBe(2)

    const { rows: usual } = await pool.query<{ table: string | null }>(
      'select to_regclass($1) as table',
      [`${defaultMigrationHistory.schema}.${defaultMigrationHistory.table}`],
    )
    expect(usual[0]?.table).toBeNull()

    // Read back from the same place: a changed migration is found there too.
    changeMigration(folder, second.tag, '-- corrected afterwards')

    expect(await failure(runMigrations(kit.ownerDatabaseUrl(), folder, elsewhere))).toBeInstanceOf(
      MigrationHistoryError,
    )
  })

  it('takes a plain name and nothing that would need quoting rules of its own', async () => {
    for (const history of [
      { schema: 'drizzle', table: 'applied; drop table probe_first' },
      { schema: 'Probe', table: 'applied' },
      { schema: 'probe"history', table: 'applied' },
    ]) {
      const error = await failure(runMigrations(kit.ownerDatabaseUrl(), folderOf(first), history))

      expect((error as Error | undefined)?.message).toContain(
        'Not a name for the migration history',
      )
    }

    expect(await tableNames(pool)).toEqual([])
  })
})
