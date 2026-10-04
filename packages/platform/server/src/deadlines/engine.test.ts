import {
  type DeadlineKind,
  deadlineRegistry,
  type Id,
  type IsoDate,
  type TenantId,
} from '@opengewerk/platform-domain'
import { eq, sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { type ProbeDeadlineColumns, probeDeadlines } from '../database/probe-schema.js'
import { deadlineSettings } from '../database/schema/deadline-settings.js'
import {
  type DeadlineEngine,
  type ExpectedDeadline,
  runDeadlineCycle,
  runDeadlinesOf,
} from './engine.js'
import { deadlineRunOf } from './runs.js'

/**
 * The deadline engine of the foundation, with sources no real application
 * has (opengewerk-haustechnik#24). At the desk of the probe application a
 * parcel is to be picked up within a week of its arrival, and the fire doors
 * of a building are checked every six months. The sources say what is due;
 * the engine writes the deadlines, follows the sources, reminds once per due
 * day, carries out the actions of the application and lets a deadline drop
 * out when its source is gone.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

/** The records the sources of the probe application follow: two parcels and two houses. */
const parcelOne = newId<'source'>()
const parcelTwo = newId<'source'>()
const eastHouse = newId<'source'>()
const westHouse = newId<'source'>()

type ProbeSource = 'parcel' | 'door'
type ProbeAction = 'reminder' | 'note'
type ProbeKind = DeadlineKind<ProbeSource, ProbeAction>

const pickup: ProbeKind = {
  key: 'parcel.pickup',
  title: 'Abholung eines Pakets',
  about: 'Ein Paket am Empfang wird binnen einer Woche abgeholt.',
  source: 'parcel',
  intervalDays: 7,
  leadDays: 1,
  responsible: 'source',
  actions: ['reminder', 'note'],
}

const doors: ProbeKind = {
  key: 'door.check',
  title: 'Prüfung der Brandschutztüren',
  about: 'Die Türen eines Hauses werden alle sechs Monate geprüft.',
  source: 'door',
  intervalDays: null,
  intervalMonths: 6,
  leadDays: 14,
  responsible: 'lead',
  actions: ['note'],
}

const registry = deadlineRegistry([pickup, doors], {
  sources: ['parcel', 'door'],
  actions: ['reminder', 'note'],
})

/** What the sources of the probe application write in its column of its own. */
interface ProbeValues {
  readonly parcelNumber: string | null
}

/** A parcel at the desk: when it came, who took it in, its number, and what the desk calls it. */
interface Parcel {
  readonly arrivedOn: IsoDate
  readonly takenInBy: string
  readonly number: string
  readonly label?: string
}

/** A building whose doors were last checked on a day. */
interface Building {
  readonly name: string
  readonly checkedOn: IsoDate
}

let parcels: Map<TenantId, Map<Id<'source'>, Parcel>>
let buildings: Map<TenantId, Map<Id<'source'>, Building>>
let noted: { kind: string; label: string; responsible: string | null; parcel: unknown }[]
let failing: { note: boolean; doorSourceOf: TenantId | null }
let completed: number

/** The tenant of the transaction a source is asked in. */
async function tenantOf(tx: TenantTransaction): Promise<TenantId> {
  const result = await tx.execute(sql`select current_setting('app.tenant_id') as tenant`)

  return result.rows[0]?.['tenant'] as TenantId
}

const parcelSource = async (
  tx: TenantTransaction,
): Promise<readonly ExpectedDeadline<ProbeValues>[]> => {
  const tenantId = await tenantOf(tx)

  return [...(parcels.get(tenantId) ?? new Map<Id<'source'>, Parcel>())].map(([id, parcel]) => ({
    sourceId: id,
    sourceLabel: parcel.label ?? `Paket ${parcel.number}`,
    anchorOn: parcel.arrivedOn,
    namedDueOn: null,
    naturalUserId: parcel.takenInBy,
    values: { parcelNumber: parcel.number },
  }))
}

const doorSource = async (
  tx: TenantTransaction,
): Promise<readonly ExpectedDeadline<ProbeValues>[]> => {
  const tenantId = await tenantOf(tx)

  if (failing.doorSourceOf === tenantId) {
    throw new Error('The doors of this tenant cannot be read.')
  }

  return [...(buildings.get(tenantId) ?? new Map<Id<'source'>, Building>())].map(
    ([id, building]) => ({
      sourceId: id,
      sourceLabel: building.name,
      anchorOn: building.checkedOn,
      namedDueOn: null,
      naturalUserId: null,
      values: { parcelNumber: null },
    }),
  )
}

let foundation: ProbeFoundation
let admin: Pool
let database: Database

type ProbeEngine = DeadlineEngine<ProbeKind, ProbeDeadlineColumns, ProbeValues>

function engine(over: Partial<ProbeEngine> = {}): ProbeEngine {
  return {
    database,
    table: probeDeadlines,
    registry,
    sources: { parcel: parcelSource, door: doorSource },
    actions: {
      note: async (context) => {
        if (failing.note) {
          throw new Error('The note could not be written.')
        }

        noted.push({
          kind: context.kind.key,
          label: context.deadline.sourceLabel,
          responsible: context.responsible,
          parcel: context.deadline.parcelNumber,
        })
      },
    },
    complete: async () => {
      completed += 1
    },
    sentences: { tenantFailed: (tenantId) => `Die Fristen des Mandanten ${tenantId} ruhen.` },
    ...over,
  }
}

/** A moment in Berlin, winter time: 2037-03-02 at nine is eight o'clock UTC. */
function at(day: string, hour = 9): Date {
  return new Date(`${day}T${String(hour - 1).padStart(2, '0')}:00:00Z`)
}

async function deadlinesOf(tenantId: TenantId) {
  return database.forTenant({ tenantId }, (tx) =>
    tx.select().from(probeDeadlines).orderBy(probeDeadlines.kind, probeDeadlines.sourceLabel),
  )
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
}, 60_000)

beforeEach(async () => {
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('lena', 'Lena Leitung', 'lena@example.de'),
       ('tom', 'Tom Empfang', 'tom@example.de'),
       ('ida', 'Ida Empfang', 'ida@example.de'),
       ('sven', 'Sven Süd', 'sven@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles, created_at) values
       ($1, 'lena', '{lead}', '2030-01-01'),
       ($1, 'tom', '{member}', '2031-01-01'),
       ($1, 'ida', '{member}', '2031-01-02'),
       ($2, 'sven', '{lead}', '2030-01-01')`,
    [north.id, south.id],
  )
  parcels = new Map([
    [north.id, new Map()],
    [south.id, new Map()],
  ])
  buildings = new Map([
    [north.id, new Map()],
    [south.id, new Map()],
  ])
  noted = []
  failing = { note: false, doorSourceOf: null }
  completed = 0
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('a source the application has', () => {
  it('makes its deadline, reminds of it once and lets it drop out when the source is gone', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-02'))).toMatchObject({
      created: 1,
      reminded: 0,
    })
    expect(await deadlinesOf(north.id)).toMatchObject([
      {
        kind: 'parcel.pickup',
        sourceId: parcelOne,
        sourceLabel: 'Paket P-0042',
        anchorOn: '2037-03-02',
        dueOn: '2037-03-09',
        naturalUserId: 'tom',
        parcelNumber: 'P-0042',
        status: 'open',
      },
    ])

    // A day before it is due, from the morning on: once, however often the engine runs.
    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-08', 7))).toMatchObject({
      reminded: 1,
    })
    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-08', 11))).toMatchObject({
      reminded: 0,
    })
    expect(noted).toEqual([
      { kind: 'parcel.pickup', label: 'Paket P-0042', responsible: 'tom', parcel: 'P-0042' },
    ])
    expect((await deadlinesOf(north.id))[0]).toMatchObject({ remindedFor: '2037-03-09' })

    // Picked up: the source asks no more, and the deadline drops out by itself.
    parcels.get(north.id)?.delete(parcelOne)

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-08', 12))).toMatchObject({
      dropped: 1,
    })
    expect((await deadlinesOf(north.id))[0]).toMatchObject({ status: 'dropped', closedBy: null })
    expect((await deadlinesOf(north.id))[0]?.closedAt).not.toBeNull()
  })

  it('stays in its tenant', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })

    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))
    await runDeadlinesOf(engine(), south.id, at('2037-03-02'))

    expect(await deadlinesOf(north.id)).toHaveLength(1)
    expect(await deadlinesOf(south.id)).toEqual([])
  })

  it('follows its source while it is open, and comes back when its source asks again', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))

    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-04', takenInBy: 'ida', number: 'P-0043' })

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-04'))).toMatchObject({ moved: 1 })
    expect((await deadlinesOf(north.id))[0]).toMatchObject({
      anchorOn: '2037-03-04',
      dueOn: '2037-03-11',
      naturalUserId: 'ida',
      parcelNumber: 'P-0043',
      sourceLabel: 'Paket P-0043',
    })

    // Nothing changed: nothing is written.
    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-04', 10))).toMatchObject({
      created: 0,
      moved: 0,
    })

    parcels.get(north.id)?.delete(parcelOne)
    await runDeadlinesOf(engine(), north.id, at('2037-03-05'))
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-04', takenInBy: 'ida', number: 'P-0043' })

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-05', 10))).toMatchObject({
      reopened: 1,
    })
    expect((await deadlinesOf(north.id))[0]).toMatchObject({ status: 'open', closedAt: null })
  })

  it('follows a change in what it hangs on, when nothing else changed', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))

    // Another number in the column of the application, and everything else
    // the same, the name in the list included.
    parcels.get(north.id)?.set(parcelOne, {
      arrivedOn: '2037-03-02',
      takenInBy: 'tom',
      number: 'P-0050',
      label: 'Paket P-0042',
    })

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-02', 10))).toMatchObject({
      moved: 1,
    })
    expect((await deadlinesOf(north.id))[0]).toMatchObject({ parcelNumber: 'P-0050' })
  })

  it('stays done once a person says so, until its source starts over from another day', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))
    await database.forTenant({ tenantId: north.id, userId: 'tom' }, (tx) =>
      tx
        .update(probeDeadlines)
        .set({ status: 'done', closedAt: new Date(), closedBy: 'tom' })
        .where(eq(probeDeadlines.sourceId, parcelOne)),
    )

    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0099' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-03'))

    expect((await deadlinesOf(north.id))[0]).toMatchObject({
      status: 'done',
      parcelNumber: 'P-0042',
    })

    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-06', takenInBy: 'tom', number: 'P-0099' })

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-06'))).toMatchObject({
      reopened: 1,
    })
    expect((await deadlinesOf(north.id))[0]).toMatchObject({
      status: 'open',
      dueOn: '2037-03-13',
      parcelNumber: 'P-0099',
    })
  })

  it('asks the application what follows once the sources are in, on every pass', async () => {
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))
    await runDeadlinesOf(engine(), north.id, at('2037-03-02', 3))

    expect(completed).toBe(2)
  })
})

describe('the way into a transaction of a pass', () => {
  it('is the one the application gives, for every transaction the pass opens for a tenant', async () => {
    const opened: string[] = []
    // A source that answers only inside the transaction the application opens,
    // as the tables of an application with areas do for a pass of nobody.
    const behindTheWay = async (
      tx: TenantTransaction,
    ): Promise<readonly ExpectedDeadline<ProbeValues>[]> => {
      const result = await tx.execute(sql`select current_setting('app.probe_way', true) as way`)

      return result.rows[0]?.['way'] === 'open' ? parcelSource(tx) : []
    }
    parcels.get(north.id)?.set(parcelOne, {
      arrivedOn: '2037-03-01',
      takenInBy: 'tom',
      number: 'P-0042',
    })

    const withoutTheWay = await runDeadlinesOf(
      engine({ sources: { parcel: behindTheWay, door: doorSource } }),
      north.id,
      at('2037-03-08'),
    )

    expect(withoutTheWay.created).toBe(0)

    const report = await runDeadlinesOf(
      engine({
        sources: { parcel: behindTheWay, door: doorSource },
        inTenant: (actor, work) =>
          database.forTenant(actor, async (tx) => {
            await tx.execute(sql`select set_config('app.probe_way', 'open', true)`)
            opened.push(actor.reason ?? '')

            return work(tx)
          }),
      }),
      north.id,
      at('2037-03-08'),
    )

    expect(report).toMatchObject({ created: 1, reminded: 1 })
    // Following the sources, reading what is due and the one reminder.
    expect(opened).toEqual(['deadline', 'deadline', 'deadline'])
    expect(noted).toEqual([
      { kind: 'parcel.pickup', label: 'Paket P-0042', responsible: 'tom', parcel: 'P-0042' },
    ])
  })
})

describe('an interval in months', () => {
  it('ends on the same day of the month, or the last one of a shorter month', async () => {
    buildings.get(north.id)?.set(eastHouse, { name: 'Haus Ost', checkedOn: '2037-08-31' })

    await runDeadlinesOf(engine(), north.id, at('2037-09-01'))

    expect((await deadlinesOf(north.id))[0]).toMatchObject({
      kind: 'door.check',
      dueOn: '2038-02-28',
      parcelNumber: null,
    })
  })

  it('moves an open deadline when the tenant sets another for the kind', async () => {
    buildings.get(north.id)?.set(eastHouse, { name: 'Haus Ost', checkedOn: '2037-08-31' })
    await runDeadlinesOf(engine(), north.id, at('2037-09-01'))
    await database.forTenant({ tenantId: north.id, userId: 'lena' }, (tx) =>
      tx
        .insert(deadlineSettings)
        .values({ tenantId: north.id, kind: 'door.check', intervalMonths: 3 }),
    )

    expect(await runDeadlinesOf(engine(), north.id, at('2037-09-02'))).toMatchObject({ moved: 1 })
    expect((await deadlinesOf(north.id))[0]).toMatchObject({ dueOn: '2037-11-30' })
  })
})

describe('a reminder', () => {
  it('waits for the morning of its day', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-08', 5))).toMatchObject({
      reminded: 0,
    })
    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-08', 6))).toMatchObject({
      reminded: 1,
    })
  })

  it('goes to whoever leads, for a kind that names nobody, and to the person the tenant chose', async () => {
    buildings.get(north.id)?.set(eastHouse, { name: 'Haus Ost', checkedOn: '2036-09-15' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-01'))
    await runDeadlinesOf(engine(), north.id, at('2037-03-01', 8))

    buildings.get(north.id)?.set(westHouse, { name: 'Haus West', checkedOn: '2036-09-16' })
    await database.forTenant({ tenantId: north.id, userId: 'lena' }, (tx) =>
      tx
        .insert(deadlineSettings)
        .values({ tenantId: north.id, kind: 'door.check', responsibleUserId: 'ida' }),
    )
    await runDeadlinesOf(engine(), north.id, at('2037-03-02', 8))

    expect(noted.map((note) => [note.label, note.responsible])).toEqual([
      ['Haus Ost', 'lena'],
      ['Haus West', 'ida'],
    ])
  })

  it('goes to whoever leads, even when somebody else has been in the tenant longer', async () => {
    await admin.query(`update memberships set created_at = '2029-01-01' where user_id = 'tom'`)
    buildings.get(north.id)?.set(eastHouse, { name: 'Haus Ost', checkedOn: '2036-09-15' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-01'))

    expect(noted.map((note) => note.responsible)).toEqual(['lena'])
  })

  it('passes over somebody who is blocked', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
    await admin.query(`update memberships set blocked_at = now() where user_id = 'tom'`)
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))
    await runDeadlinesOf(engine(), north.id, at('2037-03-08', 8))

    expect(noted.map((note) => note.responsible)).toEqual(['lena'])
  })

  it('leaves no mark when an action fails, and the next pass tries again', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))
    failing.note = true

    await expect(runDeadlinesOf(engine(), north.id, at('2037-03-08', 8))).rejects.toThrow(
      'The note could not be written.',
    )
    expect((await deadlinesOf(north.id))[0]).toMatchObject({ remindedFor: null, remindedAt: null })

    failing.note = false

    expect(await runDeadlinesOf(engine(), north.id, at('2037-03-08', 9))).toMatchObject({
      reminded: 1,
    })
  })

  describe('that fails', () => {
    beforeEach(async () => {
      parcels
        .get(north.id)
        ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
      parcels
        .get(north.id)
        ?.set(parcelTwo, { arrivedOn: '2037-03-02', takenInBy: 'ida', number: 'P-0043' })
      await runDeadlinesOf(engine(), north.id, at('2037-03-02'))
    })

    it('does not hold up the others of its tenant, and the pass still fails', async () => {
      // The first reminder of the pass fails, whichever deadline comes first.
      let calls = 0
      const firstFails = engine({
        actions: {
          note: async (context) => {
            calls += 1

            if (calls === 1) {
              throw new Error('The note could not be written.')
            }

            noted.push({
              kind: context.kind.key,
              label: context.deadline.sourceLabel,
              responsible: context.responsible,
              parcel: context.deadline.parcelNumber,
            })
          },
        },
      })

      await expect(runDeadlinesOf(firstFails, north.id, at('2037-03-08', 8))).rejects.toThrow(
        'The note could not be written.',
      )
      expect(noted).toHaveLength(1)
      expect(
        (await deadlinesOf(north.id)).map((deadline) => deadline.remindedFor !== null),
      ).toEqual(expect.arrayContaining([true, false]))

      expect(await runDeadlinesOf(engine(), north.id, at('2037-03-08', 9))).toMatchObject({
        reminded: 1,
      })
      expect(noted).toHaveLength(2)
    })

    it('names every reminder that failed in the pass', async () => {
      failing.note = true

      const failed: unknown = await runDeadlinesOf(engine(), north.id, at('2037-03-08', 8)).catch(
        (error: unknown) => error,
      )

      expect(failed).toBeInstanceOf(AggregateError)
      expect((failed as AggregateError).message).toBe('2 Erinnerungen sind gescheitert.')
      expect((failed as AggregateError).errors).toEqual([
        new Error('The note could not be written.'),
        new Error('The note could not be written.'),
      ])
      expect(await deadlinesOf(north.id)).toMatchObject([
        { remindedFor: null },
        { remindedFor: null },
      ])
    })
  })

  it('is left alone for a kind the instance no longer knows', async () => {
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })
    await runDeadlinesOf(engine(), north.id, at('2037-03-02'))
    const withoutParcels = deadlineRegistry([doors], {
      sources: ['parcel', 'door'],
      actions: ['reminder', 'note'],
    })

    expect(
      await runDeadlinesOf(engine({ registry: withoutParcels }), north.id, at('2037-03-08', 8)),
    ).toMatchObject({ reminded: 0, dropped: 0 })
    expect((await deadlinesOf(north.id))[0]).toMatchObject({ status: 'open', remindedFor: null })
  })
})

describe('a pass over every tenant', () => {
  it('writes down for each tenant when its deadlines were last gone through', async () => {
    const moment = at('2037-03-02', 10)

    await runDeadlineCycle(engine({ now: () => moment }))

    for (const tenant of [north, south]) {
      expect(await database.forTenant({ tenantId: tenant.id }, (tx) => deadlineRunOf(tx))).toEqual({
        succeededAt: moment,
        failedAt: null,
      })
    }
  })

  it('goes on with the next tenant when one fails, and writes down that it failed', async () => {
    const said: string[] = []
    const first = at('2037-03-02', 10)
    const second = at('2037-03-02', 11)

    await runDeadlineCycle(engine({ now: () => first }))
    failing.doorSourceOf = south.id
    parcels
      .get(north.id)
      ?.set(parcelOne, { arrivedOn: '2037-03-02', takenInBy: 'tom', number: 'P-0042' })

    const report = await runDeadlineCycle(
      engine({ now: () => second, complain: (line) => said.push(line) }),
    )

    expect(report.created).toBe(1)
    expect(said).toEqual([`Die Fristen des Mandanten ${south.id} ruhen.`])
    expect(await database.forTenant({ tenantId: north.id }, (tx) => deadlineRunOf(tx))).toEqual({
      succeededAt: second,
      failedAt: null,
    })
    expect(await database.forTenant({ tenantId: south.id }, (tx) => deadlineRunOf(tx))).toEqual({
      succeededAt: first,
      failedAt: second,
    })
  })

  it('knows of no pass for a tenant that has not had one', async () => {
    expect(await database.forTenant({ tenantId: north.id }, (tx) => deadlineRunOf(tx))).toEqual({
      succeededAt: null,
      failedAt: null,
    })
  })
})
