import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { newId } from './identifier.js'
import type { MigrationHistory } from './migrations.js'
import { catalogueDeviations, readCatalogue } from './catalogue.js'
import {
  allowApplicationLogin,
  applicationRole,
  appliedMigrationCount,
  migrationsFingerprint,
  ownerRole,
  type WrittenMigration,
  writeMigrationsFolder,
} from './test-database.js'

/**
 * What a test starts from when it asks the kit for a freshly migrated database
 * (#578): a copy of a template the migrations ran into once. It has to be the
 * database that emptying the schema and migrating builds, with the same grant
 * and the same two roles to look through, and a changed migration has to get
 * a template of its own.
 */

let foundation: ProbeFoundation
let admin: Pool

/** The templates on this server, by name, with the identity each has in it. */
async function templates(): Promise<Map<string, number>> {
  const { rows } = await admin.query<{ datname: string; oid: number }>(
    "select datname, oid::int as oid from pg_database where datname like '%\\_template\\_%'",
  )

  return new Map(rows.map((row) => [row.datname, row.oid]))
}

/**
 * Drops the templates of this test database, so that the next reset builds
 * one: a template that an earlier run left would be copied without anything
 * in this run having built it.
 */
async function dropTemplates(): Promise<void> {
  const base = new URL(foundation.kit.testDatabaseUrl()).pathname.slice(1).replace(/_test$/, '')
  const { rows } = await admin.query<{ datname: string }>(
    'select datname from pg_database where left(datname, length($1)) = $1',
    [`${base}_template_`],
  )

  for (const { datname } of rows) {
    await admin.query(`drop database "${datname}"`)
  }
}

/** Who the application role is, connected through its own address. */
async function signedInAsTheApplication(): Promise<string | undefined> {
  const application = new Pool({
    connectionString: foundation.kit.applicationDatabaseUrl(),
    max: 1,
  })

  try {
    const { rows } = await application.query<{ name: string }>('select current_user as name')

    return rows[0]?.name
  } finally {
    await application.end()
  }
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
}, 60_000)

afterAll(async () => {
  await admin.end()
  foundation.remove()
})

describe('a freshly migrated database from the template', () => {
  it('is the database that emptying the schema and migrating builds', async () => {
    // From a copy, so that nothing an earlier test run left beside the schema
    // stands in the one that is built and not in the copy; and from a template
    // this run builds, which is what is compared.
    await dropTemplates()
    await foundation.kit.resetToMigrated()
    await foundation.kit.resetSchema(admin)
    await foundation.kit.applyMigrations()
    await allowApplicationLogin(admin)
    const built = await readCatalogue(admin)
    const applied = await appliedMigrationCount(admin)

    await foundation.kit.resetToMigrated()
    const copied = await readCatalogue(admin)

    expect(catalogueDeviations(built, copied)).toEqual([])
    expect(copied).toEqual(built)
    expect(await appliedMigrationCount(admin)).toBe(applied)
  })

  it('lets the owner create in it, as emptying the schema grants', async () => {
    await foundation.kit.resetToMigrated()

    const { rows } = await admin.query<{ allowed: boolean }>(
      "select has_database_privilege($1, current_database(), 'CREATE') as allowed",
      [ownerRole],
    )

    expect(rows[0]?.allowed).toBe(true)
  })

  it('lets the application connect, also after a test took its login away', async () => {
    await foundation.kit.resetToMigrated()
    await admin.query(`alter role "${applicationRole}" nologin`)

    await foundation.kit.resetToMigrated()

    expect(await signedInAsTheApplication()).toBe(applicationRole)
  })

  it('holds nothing a test wrote into the one before', async () => {
    await foundation.kit.resetToMigrated()
    await admin.query('insert into tenants (id, name) values ($1, $2)', [newId(), 'Probe'])

    await foundation.kit.resetToMigrated()

    const { rows } = await admin.query<{ count: number }>(
      'select count(*)::int as count from tenants',
    )

    expect(rows[0]?.count).toBe(0)
  })

  it('refuses a database whose name does not end in _test, rather than drop it', async () => {
    const elsewhere = new URL(foundation.kit.testDatabaseUrl())
    elsewhere.pathname = '/refused_by_the_kit'

    await expect(foundation.kit.resetToMigrated(elsewhere.toString())).rejects.toThrow(
      'only one whose name ends in "_test"',
    )

    const { rows } = await admin.query('select 1 from pg_database where datname = $1', [
      'refused_by_the_kit',
    ])

    expect(rows).toHaveLength(0)
  })

  it('is copied from a template made once, not built again', async () => {
    await foundation.kit.resetToMigrated()
    const before = await templates()

    await foundation.kit.resetToMigrated()

    expect(before.size).toBeGreaterThan(0)
    expect(await templates()).toEqual(before)
  })
})

describe('the fingerprint a template is named after', () => {
  const first: WrittenMigration = {
    tag: '0000_first',
    sql: 'create table first (id int);',
    when: 1,
  }
  const second: WrittenMigration = {
    tag: '0001_second',
    sql: 'create table second (id int);',
    when: 2,
  }

  /** The fingerprint of a folder with these migrations, after `change` had its way with it. */
  function fingerprintOf(
    migrations: readonly WrittenMigration[],
    change: (folder: string) => void = () => undefined,
    history?: MigrationHistory,
  ): string {
    const folder = writeMigrationsFolder(migrations)

    try {
      change(folder)

      return migrationsFingerprint(folder, history)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }

  it('changes with a changed migration, an added one and another place for the record', () => {
    const now = fingerprintOf([first])

    expect(fingerprintOf([{ ...first, sql: 'create table first (id bigint);' }])).not.toBe(now)
    expect(fingerprintOf([first, second])).not.toBe(now)
    expect(fingerprintOf([first], undefined, { schema: 'history', table: 'applied' })).not.toBe(now)
  })

  it('stays the same for what the migration runner does not read', () => {
    expect(
      fingerprintOf([first], (folder) => {
        writeFileSync(join(folder, 'meta', '0000_snapshot.json'), '{"tables":{}}', 'utf8')
      }),
    ).toBe(fingerprintOf([first]))
  })
})
