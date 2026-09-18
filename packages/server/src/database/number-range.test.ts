import type { CustomerId, TenantId } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from './database.js'
import { newId } from './identifier.js'
import { assignDocumentNumber } from './number-ranges.js'
import * as schema from './schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  refusedBy,
  resetSchema,
} from './test-database.js'

/**
 * The numbering has to hold under the two conditions that break it in
 * practice: several people issuing at the same moment, and somebody reaching
 * past the application straight into the database.
 */

const tenant = { id: newId<'tenant'>(), name: 'Elektro Nummer GmbH' }
let admin: Pool
let database: Database
let customerId: CustomerId

/** The trigger's own error class. */
const documentIsFixed = 'OG001'

async function createDraft(kind: 'final_invoice' | 'quote' = 'final_invoice') {
  return database.forTenant(tenant.id, async (tx) => {
    const [draft] = await tx
      .insert(schema.documents)
      .values({
        tenantId: tenant.id,
        customerId,
        kind,
        documentDate: '2026-09-18',
      })
      .returning()

    if (!draft) {
      throw new Error('The insert returned no document')
    }

    return draft
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations(admin)
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])

  database = Database.connect(applicationDatabaseUrl())

  customerId = newId<'customer'>()
  await database.forTenant(tenant.id, (tx) =>
    tx
      .insert(schema.customers)
      .values({ id: customerId, tenantId: tenant.id, kind: 'business', name: 'Bauherr' }),
  )
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('numbers issued at the same moment', () => {
  it('are neither repeated nor skipped', async () => {
    const drafts = await Promise.all(Array.from({ length: 20 }, () => createDraft()))

    // All at once, each in its own transaction on its own connection. The row
    // lock on the counter is what serialises them; without it this is the test
    // that produces two invoices with the same number.
    const issued = await Promise.all(
      drafts.map((draft) =>
        database.forTenant(tenant.id, async (tx) => {
          const issuedAt = new Date()
          const number = await assignDocumentNumber(tx, tenant.id, draft.kind, issuedAt)

          const [document] = await tx
            .update(schema.documents)
            .set({ status: 'issued', number, issuedAt, updatedAt: issuedAt })
            .where(eq(schema.documents.id, draft.id))
            .returning()

          return document?.number
        }),
      ),
    )

    const numbers = issued.filter((number): number is string => number !== null)
    expect(numbers).toHaveLength(20)
    expect(new Set(numbers).size).toBe(20)

    const counters = numbers.map((number) => Number(number.split('-')[2])).sort((a, b) => a - b)
    expect(counters).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
  })

  it('leave no hole behind when a transaction fails', async () => {
    const before = await nextCounter()

    await expect(
      database.forTenant(tenant.id, async (tx) => {
        await assignDocumentNumber(tx, tenant.id, 'final_invoice', new Date())

        throw new Error('Etwas geht schief, nachdem die Nummer gezogen wurde')
      }),
    ).rejects.toThrow(/Etwas geht schief/)

    // The counter went back with the rollback. This is the reason it lives in
    // a row and not in a PostgreSQL sequence: a sequence would have kept the
    // value and left a gap that nobody can explain to an auditor.
    expect(await nextCounter()).toBe(before)
  })

  it('run separately per sequence', async () => {
    const invoice = await createDraft('final_invoice')
    const quote = await createDraft('quote')

    const numbers = await database.forTenant(tenant.id, async (tx) => ({
      invoice: await assignDocumentNumber(tx, tenant.id, invoice.kind, new Date()),
      quote: await assignDocumentNumber(tx, tenant.id, quote.kind, new Date()),
    }))

    expect(numbers.invoice).toMatch(/^RE-\d{4}-\d{4}$/)
    expect(numbers.quote).toBe('AN-2026-0001')
  })
})

describe('an issued document', () => {
  it('cannot be changed, and the refusal comes from the database', async () => {
    const draft = await createDraft()
    await database.forTenant(tenant.id, async (tx) => {
      const number = await assignDocumentNumber(tx, tenant.id, draft.kind, new Date())

      await tx
        .update(schema.documents)
        .set({ status: 'issued', number, issuedAt: new Date() })
        .where(eq(schema.documents.id, draft.id))
    })

    // Straight at the database, as the owner, past every check the server
    // makes. This is the point of the trigger: a rule that only the server
    // knows stops being a rule the moment somebody opens psql.
    const changed = await refusedBy(
      admin.query('update documents set subject = $1 where id = $2', ['Nachträglich', draft.id]),
    )
    expect(changed.code).toBe(documentIsFixed)

    const deleted = await refusedBy(admin.query('delete from documents where id = $1', [draft.id]))
    expect(deleted.code).toBe(documentIsFixed)

    const stillThere = await admin.query('select subject from documents where id = $1', [draft.id])
    expect(stillThere.rows[0].subject).toBeNull()
  })

  it('can be cancelled, and nothing else may change along the way', async () => {
    const draft = await createDraft()
    await database.forTenant(tenant.id, async (tx) => {
      const number = await assignDocumentNumber(tx, tenant.id, draft.kind, new Date())

      await tx
        .update(schema.documents)
        .set({ status: 'issued', number, issuedAt: new Date() })
        .where(eq(schema.documents.id, draft.id))
    })

    const sneaking = await refusedBy(
      admin.query("update documents set status = 'cancelled', subject = $1 where id = $2", [
        'Und nebenbei das hier',
        draft.id,
      ]),
    )
    expect(sneaking.code).toBe(documentIsFixed)

    await admin.query("update documents set status = 'cancelled' where id = $1", [draft.id])

    const after = await admin.query('select status, number from documents where id = $1', [
      draft.id,
    ])
    expect(after.rows[0].status).toBe('cancelled')
    // The number stays with the cancelled document. Handing it to the next one
    // would mean two documents carried the same number over time.
    expect(after.rows[0].number).not.toBeNull()
  })

  it('cannot be issued twice, not even past the server', async () => {
    const draft = await createDraft()
    await database.forTenant(tenant.id, async (tx) => {
      const number = await assignDocumentNumber(tx, tenant.id, draft.kind, new Date())

      await tx
        .update(schema.documents)
        .set({ status: 'issued', number, issuedAt: new Date() })
        .where(eq(schema.documents.id, draft.id))
    })

    const again = await refusedBy(
      admin.query('update documents set issued_at = now() where id = $1', [draft.id]),
    )
    expect(again.code).toBe(documentIsFixed)
  })
})

async function nextCounter(): Promise<number> {
  const [range] = await database.forTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(schema.numberRanges)
      .where(
        and(
          eq(schema.numberRanges.tenantId, tenant.id as TenantId),
          eq(schema.numberRanges.key, 'invoice'),
        ),
      ),
  )

  return range?.nextValue ?? 1
}
