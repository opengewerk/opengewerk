import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  Database,
  FileStore,
  newId,
  StoredFileMissingError,
  sweepFileStore,
} from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from './test-database.js'

// The sweep of the file store (#657) against the migrated database: the store
// is one for the instance, and a file another business still holds is the one
// the sweep must never take, although the run sees no business at all.

let admin: Pool
let database: Database
let root: string
let store: FileStore

const day = 24 * 60 * 60 * 1000

/** Stores bytes and makes them a week old, as a file nobody touched since. */
async function weekOld(text: string): Promise<string> {
  const { sha256 } = await store.put(new TextEncoder().encode(text))
  const week = new Date(Date.now() - 7 * day)

  utimesSync(join(root, sha256.slice(0, 2), sha256.slice(2, 4), sha256), week, week)

  return sha256
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  database = Database.connect(applicationDatabaseUrl())
  root = mkdtempSync(join(tmpdir(), 'file-sweep-'))
  store = new FileStore(root)
})

afterAll(async () => {
  await database.close()
  await admin.end()
  rmSync(root, { recursive: true, force: true })
})

describe('the sweep of the file store (#657)', () => {
  it('takes out a file no business holds and keeps one another business holds', async () => {
    const [north, south] = [newId<'tenant'>(), newId<'tenant'>()]

    await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
      north,
      'Elektro Nord GmbH',
      south,
      'Elektro Süd GmbH',
    ])

    const heldBySouth = await weekOld('Rechnung des Südens')
    const orphan = await weekOld('Von niemandem gehalten')
    const fresh = (await store.put(new TextEncoder().encode('Gerade abgelegt'))).sha256

    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 19, 'application/pdf')`,
      [south, heldBySouth],
    )

    expect(await sweepFileStore(database, store)).toBe(1)

    await expect(store.get(orphan)).rejects.toThrow(StoredFileMissingError)
    expect(new TextDecoder().decode(await store.get(heldBySouth))).toBe('Rechnung des Südens')
    expect(new TextDecoder().decode(await store.get(fresh))).toBe('Gerade abgelegt')
  })

  it('asks the database as no business, which answers for every business', async () => {
    const tenant = newId<'tenant'>()
    const sha256 = await weekOld('Nur in einem Betrieb')

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant,
      'Elektro West GmbH',
    ])
    const unasked = await weekOld('Nicht gefragt')

    for (const name of [sha256, unasked]) {
      await admin.query(
        `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 20, 'application/pdf')`,
        [tenant, name],
      )
    }

    // Inside another business the row is not there; the function sees it.
    const inside = await database.forTenant({ tenantId: newId<'tenant'>() }, (tx) =>
      tx.execute(`select 1 from files where sha256 = '${sha256}'`),
    )
    const held = await database.forInstance((tx) =>
      tx.execute(`select held as sha256 from files_held(array['${sha256}']) as held`),
    )

    // And only for the names it is asked about, not for every file there is.
    expect(inside.rows).toEqual([])
    expect(held.rows).toEqual([{ sha256 }])
  })
})
