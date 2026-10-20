import { createHash } from 'node:crypto'

import { Database, newId } from '@opengewerk/platform-server'
import type { TenantId } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from './test-database.js'

// A document and its files going for good (#658), against the migrated
// database. This application opens no way for it, so the test defines the
// function an application would define in a migration of its own,
// `application_attachment_may_go`, and lets it answer from a setting of the
// transaction. What it holds is the foundation's: the locks, the shell, the
// files nobody else names, and a log that copies nothing on the way out.

let admin: Pool
let database: Database
let tenant: TenantId
let customer: string

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const onlyHere = sha('Schaltplan Fassung 1')
const sharedWithAnother = sha('Schaltplan Fassung 2')
const ofNoDocument = sha('gerade hochgeladen')

async function one(statement: string, values: unknown[]): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(`${statement} returning id`, values)

  return rows[0]?.id ?? ''
}

/** A document with two versions, the second of whose files another document names as well. */
async function planted(): Promise<{ document: string; other: string }> {
  const document = await one(
    "insert into attachments (tenant_id, customer_id, title) values ($1, $2, 'Schaltplan Kellerverteilung')",
    [tenant, customer],
  )
  const other = await one(
    "insert into attachments (tenant_id, customer_id, title) values ($1, $2, 'Anlagenfoto')",
    [tenant, customer],
  )

  for (const [attachment, hash, name] of [
    [document, onlyHere, 'schaltplan-keller-1.pdf'],
    [document, sharedWithAnother, 'schaltplan-keller-2.pdf'],
    [other, sharedWithAnother, 'foto.pdf'],
  ] as const) {
    await admin.query(
      `insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
       values ($1, $2, $3, $4, 'application/pdf', 1)`,
      [tenant, attachment, hash, name],
    )
  }

  return { document, other }
}

/** What the database said, under the query drizzle wraps it in. */
const refusal = (words: string) => ({
  cause: expect.objectContaining({ message: expect.stringContaining(words) }),
})

/** Runs a statement as the application, with the way to let `document` go open or not. */
function asTheApplication(statement: ReturnType<typeof sql>, mayGo: string | null) {
  return database.forTenant({ tenantId: tenant, userId: 'u-lead' }, async (tx) => {
    await tx.execute(sql`select set_config('test.may_go', ${mayGo ?? ''}, true)`)

    return tx.execute(statement)
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  tenant = newId<'tenant'>()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Elektro Nord GmbH'])
  customer = await one(
    "insert into customers (tenant_id, kind, name) values ($1, 'business', 'Bauherr')",
    [tenant],
  )

  for (const hash of [onlyHere, sharedWithAnother, ofNoDocument]) {
    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 1, 'application/pdf')
       on conflict do nothing`,
      [tenant, hash],
    )
  }

  // Who stored the file only this document names: two people, one of whom
  // the person who lets it go cannot see.
  await admin.query(
    `insert into file_uploads (tenant_id, sha256, user_id) values ($1, $2, 'u-lead'), ($1, $2, 'u-office')`,
    [tenant, onlyHere],
  )
  await admin.query(
    `create or replace function application_attachment_may_go(p uuid) returns boolean
       language sql stable as $$ select p::text = current_setting('test.may_go', true) $$`,
  )
})

afterAll(async () => {
  await admin.query('drop function if exists application_attachment_may_go(uuid)')
  await database.close()
  await admin.end()
})

describe('a document going for good (#658)', () => {
  it('takes its versions and the file nobody else names, and leaves the document as a shell', async () => {
    const { document, other } = await planted()
    const { rows: before } = await admin.query<{ count: number }>(
      `select count(*)::int as count from audit_entries
        where table_name in ('attachments', 'attachment_versions')`,
    )

    const result = await asTheApplication(
      sql`select purge_attachment(${document}::uuid, 'Gelöscht nach Ablauf der Aufbewahrung') as gone`,
      document,
    )

    expect(result.rows).toEqual([{ gone: 1 }])

    const { rows: shell } = await admin.query(
      'select title, deleted_at is not null as marked from attachments where id = $1',
      [document],
    )
    const { rows: versions } = await admin.query(
      'select attachment_id::text as attachment, file_name from attachment_versions where tenant_id = $1',
      [tenant],
    )
    const { rows: files } = await admin.query(
      'select sha256 from files where tenant_id = $1 order by sha256',
      [tenant],
    )
    const { rows: uploads } = await admin.query('select 1 from file_uploads where tenant_id = $1', [
      tenant,
    ])
    const { rows: after } = await admin.query<{ count: number; copied: number }>(
      `select count(*)::int as count,
              count(*) filter (where old_value like '%Schaltplan%' or old_value like '%schaltplan%')::int as copied
         from audit_entries where table_name in ('attachments', 'attachment_versions')`,
    )

    expect(shell).toEqual([{ title: 'Gelöscht nach Ablauf der Aufbewahrung', marked: true }])
    expect(versions).toEqual([{ attachment: other, file_name: 'foto.pdf' }])
    expect(files).toEqual([ofNoDocument, sharedWithAnother].sort().map((sha256) => ({ sha256 })))
    expect(uploads).toEqual([])
    expect(after[0]?.count).toBe(before[0]?.count)
    expect(after[0]?.copied).toBe(0)
  })

  it('goes only on the way the application opens, for the document it opens it for', async () => {
    const { document, other } = await planted()

    for (const mayGo of [null, other]) {
      await expect(
        asTheApplication(sql`select purge_attachment(${document}::uuid, 'weg')`, mayGo),
      ).rejects.toMatchObject(refusal('nur auf dem Weg endgültig gelöscht'))
    }

    await admin.query('drop function application_attachment_may_go(uuid)')

    await expect(
      asTheApplication(sql`select purge_attachment(${document}::uuid, 'weg')`, document),
    ).rejects.toMatchObject(refusal('nur auf dem Weg endgültig gelöscht'))
  })

  it('refuses to delete a version or a file any other way, the owner of the tables included', async () => {
    const { document } = await planted()

    // The application, with the way open for the document but outside it.
    await expect(
      asTheApplication(
        sql`delete from attachment_versions where attachment_id = ${document}::uuid`,
        document,
      ),
    ).rejects.toMatchObject(refusal('weder geändert noch gelöscht'))
    await expect(
      asTheApplication(sql`delete from files where sha256 = ${onlyHere}`, document),
    ).rejects.toMatchObject(refusal('permission denied for table files'))

    // Whoever owns the tables, or more.
    await expect(
      admin.query('delete from attachment_versions where attachment_id = $1', [document]),
    ).rejects.toThrow('weder geändert noch gelöscht')
    await expect(admin.query('delete from files where tenant_id = $1', [tenant])).rejects.toThrow(
      'Eine Datei geht nur mit dem Dokument',
    )
  })

  it('takes no file but those of its versions, while it goes and whoever asks', async () => {
    const { document } = await planted()

    // The application, with the way open and the document named as going:
    // a file of no document, only just stored, is not its to delete.
    await expect(
      database.forTenant({ tenantId: tenant, userId: 'u-lead' }, async (tx) => {
        await tx.execute(sql`select set_config('test.may_go', ${document}, true)`)
        await tx.execute(sql`select set_config('app.purging_attachment', ${document}, true)`)

        return tx.execute(sql`delete from files where sha256 = ${ofNoDocument}`)
      }),
    ).rejects.toMatchObject(refusal('permission denied for table files'))

    // Whoever owns the tables, in the same state, and with a file the
    // document does name: only the trigger of a version takes one.
    const owner = await admin.connect()

    try {
      await owner.query('begin')
      await owner.query(`select set_config('test.may_go', $1, true)`, [document])
      await owner.query(`select set_config('app.purging_attachment', $1, true)`, [document])

      for (const hash of [ofNoDocument, onlyHere]) {
        await owner.query('savepoint probe')
        await expect(
          owner.query('delete from files where tenant_id = $1 and sha256 = $2', [tenant, hash]),
        ).rejects.toThrow('Eine Datei geht nur mit dem Dokument')
        await owner.query('rollback to savepoint probe')
      }
    } finally {
      await owner.query('rollback')
      owner.release()
    }

    const { rows } = await admin.query('select sha256 from files where tenant_id = $1', [tenant])

    expect(rows).toHaveLength(3)
  })
})
