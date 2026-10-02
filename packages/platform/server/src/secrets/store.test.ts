import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probeSecrets } from '../database/probe-schema.js'
import { SecretKey } from './key.js'
import { secretStore } from './store.js'

/**
 * The sealed credentials of a tenant, kept and opened (ADR 0010).
 *
 * The purposes here are nobody's: the login to a mailbox, of which a tenant
 * has one, and the code of a locker, of which it has one per locker. That is
 * the point of the test. The store has to work with a list it has never seen,
 * because every application brings its own.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

const key = SecretKey.from('k'.repeat(64))
const store = secretStore(probeSecrets)

const lockerA = newId<'locker'>()
const lockerB = newId<'locker'>()
const lockerC = newId<'locker'>()

let foundation: ProbeFoundation
let admin: Pool
let database: Database

function inTenant<Result>(
  tenantId: TenantId,
  work: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return database.forTenant({ tenantId, reason: 'probe' }, work)
}

interface Row {
  tenant_id: string
  purpose: string
  record_id: string | null
  sealed: string
}

async function rows(): Promise<Row[]> {
  const found = await admin.query<Row>(
    'select tenant_id, purpose, record_id, sealed from secrets order by created_at, id',
  )

  return found.rows
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  database = Database.connect(foundation.kit.applicationDatabaseUrl())
})

beforeEach(async () => {
  await admin.query('delete from secrets')
})

afterAll(async () => {
  await database.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('the secret a tenant has of a purpose', () => {
  it('is kept sealed and read back open', async () => {
    await inTenant(north.id, (tx) =>
      store.keep(tx, key, { tenantId: north.id, purpose: 'mailbox' }, 'das-passwort-zum-postfach'),
    )

    const [kept] = await rows()

    expect(kept).toMatchObject({ tenant_id: north.id, purpose: 'mailbox', record_id: null })
    expect(kept?.sealed).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/)
    expect(kept?.sealed).not.toContain('passwort')

    expect(
      await inTenant(north.id, (tx) =>
        store.read(tx, key, { tenantId: north.id, purpose: 'mailbox' }),
      ),
    ).toEqual({ state: 'readable', value: 'das-passwort-zum-postfach' })
  })

  it('takes the place of the one before it, and is not kept beside it', async () => {
    const mailbox = { tenantId: north.id, purpose: 'mailbox' } as const

    await inTenant(north.id, (tx) => store.keep(tx, key, mailbox, 'das-alte'))
    await inTenant(north.id, (tx) => store.keep(tx, key, mailbox, 'das-neue'))

    expect(await rows()).toHaveLength(1)
    expect(await inTenant(north.id, (tx) => store.read(tx, key, mailbox))).toEqual({
      state: 'readable',
      value: 'das-neue',
    })
  })

  /**
   * Three answers and not two. A tenant that set nothing is asked to set
   * something; one whose value no longer opens, after the session secret of
   * the instance changed, is told to enter it again. Reading both as "none"
   * would make the second look as if it had never been set.
   */
  it('is told apart from none at all, and from one this key does not open', async () => {
    const mailbox = { tenantId: north.id, purpose: 'mailbox' } as const

    expect(await inTenant(north.id, (tx) => store.read(tx, key, mailbox))).toEqual({
      state: 'none',
    })

    await inTenant(north.id, (tx) => store.keep(tx, key, mailbox, 'geheim'))

    const another = SecretKey.from('a'.repeat(64))

    expect(await inTenant(north.id, (tx) => store.read(tx, another, mailbox))).toEqual({
      state: 'unreadable',
    })
  })

  it('is forgotten when asked, and nothing else with it', async () => {
    const mailbox = { tenantId: north.id, purpose: 'mailbox' } as const
    const locker = { tenantId: north.id, purpose: 'locker', recordId: lockerA } as const

    await inTenant(north.id, async (tx) => {
      await store.keep(tx, key, mailbox, 'postfach')
      await store.keep(tx, key, locker, '4711')
    })
    await inTenant(north.id, (tx) => store.forget(tx, mailbox))

    expect(await inTenant(north.id, (tx) => store.read(tx, key, mailbox))).toEqual({
      state: 'none',
    })
    expect(await inTenant(north.id, (tx) => store.read(tx, key, locker))).toEqual({
      state: 'readable',
      value: '4711',
    })
  })
})

describe('the secret of a record', () => {
  const locker = (recordId: string) =>
    ({ tenantId: north.id, purpose: 'locker', recordId }) as const

  it('is one per record, each replaced on its own', async () => {
    await inTenant(north.id, async (tx) => {
      await store.keep(tx, key, locker(lockerA), '1111')
      await store.keep(tx, key, locker(lockerB), '2222')
      await store.keep(tx, key, locker(lockerA), '3333')
    })

    expect(await rows()).toHaveLength(2)
    expect(await inTenant(north.id, (tx) => store.read(tx, key, locker(lockerA)))).toEqual({
      state: 'readable',
      value: '3333',
    })
    expect(await inTenant(north.id, (tx) => store.read(tx, key, locker(lockerB)))).toEqual({
      state: 'readable',
      value: '2222',
    })
  })

  it('stands beside the one the tenant has of the same purpose, and neither is the other', async () => {
    const whole = { tenantId: north.id, purpose: 'locker' } as const

    await inTenant(north.id, async (tx) => {
      await store.keep(tx, key, whole, 'für-alle')
      await store.keep(tx, key, locker(lockerA), 'nur-dieser')
    })

    expect(await inTenant(north.id, (tx) => store.read(tx, key, whole))).toEqual({
      state: 'readable',
      value: 'für-alle',
    })
    expect(await inTenant(north.id, (tx) => store.read(tx, key, locker(lockerA)))).toEqual({
      state: 'readable',
      value: 'nur-dieser',
    })

    await inTenant(north.id, (tx) => store.forget(tx, locker(lockerA)))

    expect(await rows()).toHaveLength(1)
    expect(await inTenant(north.id, (tx) => store.read(tx, key, whole))).toEqual({
      state: 'readable',
      value: 'für-alle',
    })
  })

  it('is read for several records at once, and a record without one is not in the answer', async () => {
    await inTenant(north.id, async (tx) => {
      await store.keep(tx, key, locker(lockerA), '1111')
      await store.keep(tx, key, locker(lockerB), '2222')
    })

    const found = await inTenant(north.id, (tx) =>
      store.readOf(tx, key, { tenantId: north.id, purpose: 'locker' }, [lockerA, lockerB, lockerC]),
    )

    expect([...found.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual(
      [
        [lockerA, { state: 'readable', value: '1111' }],
        [lockerB, { state: 'readable', value: '2222' }],
      ].sort(([left], [right]) => String(left).localeCompare(String(right))),
    )

    expect(
      await inTenant(north.id, (tx) =>
        store.readOf(tx, key, { tenantId: north.id, purpose: 'locker' }, []),
      ),
    ).toEqual(new Map())
  })

  /**
   * The seal holds the place the value was sealed for. What a copy of a row
   * to another record, another purpose or another tenant gets is a value that
   * does not open, which is what keeps a row moved by hand, or by a statement
   * gone wrong, from handing one tenant the key of another.
   */
  it('does not open at another record, for another purpose or in another tenant', async () => {
    await inTenant(north.id, (tx) => store.keep(tx, key, locker(lockerA), '1111'))

    const [kept] = await rows()
    const sealed = kept?.sealed ?? ''

    await admin.query(
      `insert into secrets (tenant_id, purpose, record_id, sealed) values
         ($1, 'locker', $3, $5), ($1, 'mailbox', null, $5), ($2, 'locker', $4, $5)`,
      [north.id, south.id, lockerB, lockerA, sealed],
    )

    expect(await inTenant(north.id, (tx) => store.read(tx, key, locker(lockerB)))).toEqual({
      state: 'unreadable',
    })
    expect(
      await inTenant(north.id, (tx) =>
        store.read(tx, key, { tenantId: north.id, purpose: 'mailbox' }),
      ),
    ).toEqual({ state: 'unreadable' })
    expect(
      await inTenant(south.id, (tx) =>
        store.read(tx, key, { tenantId: south.id, purpose: 'locker', recordId: lockerA }),
      ),
    ).toEqual({ state: 'unreadable' })

    // And where it was sealed for, it still opens.
    expect(await inTenant(north.id, (tx) => store.read(tx, key, locker(lockerA)))).toEqual({
      state: 'readable',
      value: '1111',
    })
  })
})

describe('the table behind it', () => {
  it('keeps the secrets of a tenant inside it', async () => {
    const mailboxOfTheSouth = { tenantId: south.id, purpose: 'mailbox' } as const

    await inTenant(south.id, (tx) => store.keep(tx, key, mailboxOfTheSouth, 'postfach-süd'))

    // Asked from the north by its name, the south has nothing.
    expect(await inTenant(north.id, (tx) => store.read(tx, key, mailboxOfTheSouth))).toEqual({
      state: 'none',
    })

    // And the north can neither replace it nor remove it.
    await expect(
      inTenant(north.id, (tx) => store.keep(tx, key, mailboxOfTheSouth, 'untergeschoben')),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
    await inTenant(north.id, (tx) => store.forget(tx, mailboxOfTheSouth))

    expect(await inTenant(south.id, (tx) => store.read(tx, key, mailboxOfTheSouth))).toEqual({
      state: 'readable',
      value: 'postfach-süd',
    })
  })

  /**
   * The one table of a tenant the log does not watch. The log is written once
   * and never touched again, and a sealed value in it would be there for good,
   * readable by whoever later holds the log and the key together.
   */
  it('is not in the log of the tenant, sealed or otherwise', async () => {
    await inTenant(north.id, async (tx) => {
      await store.keep(tx, key, { tenantId: north.id, purpose: 'mailbox' }, 'geheim')
      await store.keep(tx, key, { tenantId: north.id, purpose: 'mailbox' }, 'geheimer')
      await store.forget(tx, { tenantId: north.id, purpose: 'mailbox' })
    })

    const { rows: logged } = await admin.query(
      "select 1 from audit_entries where table_name = 'secrets'",
    )

    expect(logged).toEqual([])
  })
})
