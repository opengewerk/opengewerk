import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { belongsToPvSystemKind, installationKinds, type TenantId } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  checkViolation,
  connect,
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { changed, created, deleted, push as pushVia } from './test-structure.js'

/**
 * The PV structure below a PV system (#300), as a device builds it: inverter,
 * string, module, each an operation in the outbox; and the battery, meter or
 * wallbox that says which system it belongs to and at which inverter it hangs.
 *
 * Two businesses on the instance, and two sites in the first, because the
 * part of this that matters most is a link that points somewhere it may not:
 * into another business, to another site, or at an inverter of another system.
 */

const north = { id: newId<'tenant'>(), name: 'Solar Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Solar Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

const office = () => as(north.id, 'office')

function push(operations: unknown[], expected = 201) {
  return pushVia(app, office(), operations, expected)
}

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

/** A customer with a site, the way the office creates them. */
async function siteOf(tenantId: TenantId, designation: string) {
  const who = as(tenantId, 'office')
  const customer = await post('/customers', { kind: 'private', name: 'Familie Weber' }, who)

  return post(
    '/sites',
    {
      customerId: customer,
      designation,
      street: 'Birkenweg',
      houseNumber: '7',
      postalCode: '69214',
      city: 'Eppelheim',
    },
    who,
  )
}

async function installation(
  siteId: string,
  kind: string,
  designation: string,
  tenantId: TenantId = north.id,
) {
  return post('/installations', { siteId, kind, designation }, as(tenantId, 'office'))
}

/** An inverter with one string, straight through the outbox. */
async function inverterOf(installationId: string, designation = 'WR 1') {
  const inverterId = newId<'inverter'>()
  const stringId = newId<'pv-string'>()
  const moduleId = newId<'pv-module'>()

  const answer = await push([
    created('inverters', inverterId, { installationId, designation, position: 0 }),
    created('pv_strings', stringId, { inverterId, designation: 'String 1', position: 0 }),
    created('pv_modules', moduleId, { pvStringId: stringId, ratedPowerW: 400, position: 0 }),
  ])
  expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual([
    'applied',
    'applied',
    'applied',
  ])

  return { inverterId, stringId, moduleId }
}

async function row(table: string, id: string) {
  const { rows } = await admin.query<Record<string, unknown>>(
    `select * from ${table} where id = $1`,
    [id],
  )

  return rows[0] ?? {}
}

let home = ''
let neighbour = ''
let system = ''
let battery = ''

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  home = await siteOf(north.id, 'Wohnhaus')
  neighbour = await siteOf(north.id, 'Scheune')
  system = await installation(home, 'pv_system', 'PV-Anlage Dach')
  battery = await installation(home, 'battery', 'Speicher Technikraum')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a PV system written down in the office', () => {
  it('arrives whole, with the power, the inputs and where its strings face', async () => {
    const inverterId = newId<'inverter'>()
    const stringId = newId<'pv-string'>()
    const moduleId = newId<'pv-module'>()

    const answer = await push([
      created('inverters', inverterId, {
        installationId: system,
        designation: 'WR 1',
        manufacturer: 'Fronius',
        model: 'Symo GEN24 10.0 Plus',
        serialNumber: '34125009',
        ratedPowerW: 10_000,
        mppInputs: 2,
        position: 0,
      }),
      created('pv_strings', stringId, {
        inverterId,
        designation: 'String 2',
        mppInput: 2,
        azimuthDeg: 270,
        tiltDeg: 30,
        position: 1,
      }),
      created('pv_modules', moduleId, {
        pvStringId: stringId,
        manufacturer: 'JA Solar',
        model: 'JAM54S30-400/MR',
        serialNumber: 'JA2404118771',
        ratedPowerW: 400,
        position: 0,
      }),
    ])

    expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
    ])
    expect(await row('inverters', inverterId)).toMatchObject({
      rated_power_w: 10_000,
      mpp_inputs: 2,
    })
    expect(await row('pv_strings', stringId)).toMatchObject({
      mpp_input: 2,
      azimuth_deg: 270,
      tilt_deg: 30,
    })
    expect(await row('pv_modules', moduleId)).toMatchObject({
      rated_power_w: 400,
      serial_number: 'JA2404118771',
    })
  })

  it.each([
    [
      'an inverter of no power',
      'inverters',
      { ratedPowerW: 0 },
      'Die Nennleistung ist größer als 0 und höchstens 10000 kW.',
    ],
    [
      'more inputs than an inverter has',
      'inverters',
      { mppInputs: 25 },
      'Die MPP-Eingänge sind eine ganze Zahl von 1 bis 24.',
    ],
    [
      'a direction past the circle',
      'pv_strings',
      { azimuthDeg: 360 },
      'Die Ausrichtung ist eine ganze Zahl von 0 bis 359 Grad: 0 Nord, 90 Ost, 180 Süd, 270 West.',
    ],
    [
      'a tilt past upright',
      'pv_strings',
      { tiltDeg: 91 },
      'Die Neigung ist eine ganze Zahl von 0 bis 90 Grad.',
    ],
    [
      'a module of five kilowatts',
      'pv_modules',
      // Made with 400, which the device saw.
      { ratedPowerW: [400, 5_000] },
      'Die Leistung eines Moduls ist größer als 0 und höchstens 2000 Wp.',
    ],
  ])('refuses %s with the sentence of its form', async (_, entity, figures, sentence) => {
    const { inverterId, stringId, moduleId } = await inverterOf(system, 'WR Probe')
    const id = { inverters: inverterId, pv_strings: stringId, pv_modules: moduleId }[entity] ?? ''

    const answer = await push(
      [
        changed(
          entity,
          id,
          Object.fromEntries(
            Object.entries(figures).map(([field, value]) => [
              field,
              Array.isArray(value) ? { from: value[0], to: value[1] } : { from: null, to: value },
            ]),
          ),
        ),
      ],
      400,
    )

    expect(answer.message).toBe(sentence)
  })
})

describe('an installation that belongs to a PV system', () => {
  it('names the system at its site and the inverter it hangs at', async () => {
    const { inverterId } = await inverterOf(system)

    const answer = await push([
      changed('installations', battery, {
        pvSystemId: { from: null, to: system },
        inverterId: { from: null, to: inverterId },
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })
    expect(await row('installations', battery)).toMatchObject({
      pv_system_id: system,
      inverter_id: inverterId,
    })
  })

  it('is a battery, a meter or a wallbox, refused otherwise with the sentence of the form', async () => {
    const answer = await push(
      [
        created('installations', newId<'installation'>(), {
          siteId: home,
          kind: 'heating',
          designation: 'Heizung',
          pvSystemId: system,
        }),
      ],
      400,
    )

    expect(answer.message).toBe('Zu einer PV-Anlage gehören nur Speicher, Zähler und Wallbox.')
  })

  it('is a conflict when the kind changed elsewhere and no longer fits', async () => {
    const heating = await installation(home, 'heating', 'Heizung Keller')

    const answer = await push([
      changed('installations', heating, { pvSystemId: { from: null, to: system } }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['kind', 'pvSystemId'],
    })
  })

  it('names an inverter only together with its system', async () => {
    const { inverterId } = await inverterOf(system)

    const answer = await push(
      [
        created('installations', newId<'installation'>(), {
          siteId: home,
          kind: 'wallbox',
          designation: 'Wallbox Garage',
          inverterId,
        }),
      ],
      400,
    )

    expect(answer.message).toBe(
      'An einem Wechselrichter hängt nur, was zu seiner PV-Anlage gehört.',
    )
  })

  it('is a conflict about the one installation when the system is not a PV system at its site', async () => {
    const elsewhere = await installation(neighbour, 'pv_system', 'PV-Anlage Scheune')
    const heating = await installation(home, 'heating', 'Wärmepumpe')
    const meter = await installation(home, 'meter', 'Zähler 1')

    const answer = await push([
      changed('installations', meter, { pvSystemId: { from: null, to: elsewhere } }),
      changed('installations', meter, { pvSystemId: { from: null, to: heating } }),
      changed('installations', meter, { pvSystemId: { from: null, to: meter } }),
      changed('installations', meter, { designation: { from: 'Zähler 1', to: 'Zähler Haus' } }),
    ])

    expect(
      answer.receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields })),
    ).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['pvSystemId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['pvSystemId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['pvSystemId'] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
  })

  it('is a conflict when the inverter belongs to another system', async () => {
    const second = await installation(home, 'pv_system', 'PV-Anlage Garage')
    const { inverterId: ofTheSecond } = await inverterOf(second, 'WR Garage')
    const wallbox = await installation(home, 'wallbox', 'Wallbox Einfahrt')

    const answer = await push([
      changed('installations', wallbox, {
        pvSystemId: { from: null, to: system },
        inverterId: { from: null, to: ofTheSecond },
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: ['inverterId'],
    })
  })

  it('is a conflict when it moves to another site with its link', async () => {
    const meter = await installation(home, 'meter', 'Zähler 2')
    await push([changed('installations', meter, { pvSystemId: { from: null, to: system } })])

    const answer = await push([
      changed('installations', meter, { siteId: { from: home, to: neighbour } }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: ['pvSystemId'],
    })
  })

  it('is taken by the database for exactly the kinds of the domain', async () => {
    // The trigger names the kinds in SQL, the domain in `pvCompanionKinds`;
    // this is what keeps the two lists one.
    const accepted: string[] = []

    for (const kind of installationKinds) {
      const refused = await refusedBy(
        admin.query(
          `insert into installations (tenant_id, site_id, kind, designation, pv_system_id)
             values ($1, $2, $3, 'Probe', $4)`,
          [north.id, home, kind, system],
        ),
      ).catch(() => null)

      if (refused === null) {
        accepted.push(kind)
      } else {
        expect(refused.code).toBe(checkViolation)
      }
    }

    expect(accepted).toEqual(installationKinds.filter(belongsToPvSystemKind))
  })
})

describe('the links in the other direction', () => {
  async function linked() {
    const pv = await installation(home, 'pv_system', 'PV-Anlage Carport')
    const parts = await inverterOf(pv, 'WR Carport')
    const storage = await installation(home, 'battery', 'Speicher Carport')
    await push([
      changed('installations', storage, {
        pvSystemId: { from: null, to: pv },
        inverterId: { from: null, to: parts.inverterId },
      }),
    ])

    return { pv, storage, ...parts }
  }

  it('let go when the system is deleted, which takes its structure along', async () => {
    const { pv, storage, inverterId, stringId, moduleId } = await linked()

    await http().delete(`/installations/${pv}`).set('x-test-identity', office()).expect(200)

    expect(await row('installations', storage)).toMatchObject({
      pv_system_id: null,
      inverter_id: null,
      deleted_at: null,
    })

    for (const [table, id] of [
      ['inverters', inverterId],
      ['pv_strings', stringId],
      ['pv_modules', moduleId],
    ] as const) {
      expect((await row(table, id))['deleted_at']).not.toBeNull()
    }
  })

  it('let go of the inverter when it is deleted, which takes its strings along', async () => {
    const { pv, storage, inverterId, stringId, moduleId } = await linked()

    const answer = await push([deleted('inverters', inverterId)])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })
    expect(await row('installations', storage)).toMatchObject({
      pv_system_id: pv,
      inverter_id: null,
    })
    expect((await row('pv_strings', stringId))['deleted_at']).not.toBeNull()
    expect((await row('pv_modules', moduleId))['deleted_at']).not.toBeNull()
  })

  it('let go when the system becomes something else', async () => {
    const { pv, storage } = await linked()

    const answer = await push([
      changed('installations', pv, { kind: { from: 'pv_system', to: 'other' } }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })
    expect(await row('installations', storage)).toMatchObject({
      pv_system_id: null,
      inverter_id: null,
    })
  })

  it('let go when the system moves to another site', async () => {
    const { pv, storage } = await linked()

    await http()
      .patch(`/installations/${pv}`)
      .set('x-test-identity', office())
      .send({ siteId: neighbour })
      .expect(200)

    expect(await row('installations', storage)).toMatchObject({
      pv_system_id: null,
      inverter_id: null,
    })
  })

  it('let go of the inverter when it moves to another system', async () => {
    const { pv, storage, inverterId } = await linked()
    const other = await installation(home, 'pv_system', 'PV-Anlage Stall')

    const answer = await push([
      changed('inverters', inverterId, { installationId: { from: pv, to: other } }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })
    expect(await row('installations', storage)).toMatchObject({
      pv_system_id: pv,
      inverter_id: null,
    })
  })
})

describe('the route of an installation', () => {
  it('takes a link that holds', async () => {
    const { inverterId } = await inverterOf(system, 'WR Route')

    const answer = await http()
      .post('/installations')
      .set('x-test-identity', office())
      .send({
        siteId: home,
        kind: 'wallbox',
        designation: 'Wallbox Hof',
        pvSystemId: system,
        inverterId,
      })
      .expect(201)

    expect(answer.body).toMatchObject({ pvSystemId: system, inverterId })
  })

  it('refuses one that does not, with the field in the sentence', async () => {
    const elsewhere = await installation(neighbour, 'pv_system', 'PV-Anlage Nebengebäude')
    const second = await installation(home, 'pv_system', 'PV-Anlage Anbau')
    const { inverterId: ofTheSecond } = await inverterOf(second, 'WR Anbau')
    const foreign = await installation(
      await siteOf(south.id, 'Halle'),
      'pv_system',
      'PV-Anlage Halle',
      south.id,
    )
    const meter = await installation(home, 'meter', 'Zähler Route')

    const refusals = []

    for (const body of [
      { kind: 'heating', pvSystemId: system },
      { pvSystemId: elsewhere },
      { pvSystemId: system, inverterId: ofTheSecond },
      { inverterId: ofTheSecond },
      { pvSystemId: foreign },
    ]) {
      const answer = await http()
        .patch(`/installations/${meter}`)
        .set('x-test-identity', office())
        .send(body)
        .expect(422)

      refusals.push((answer.body as { message: string }).message)
    }

    expect(refusals).toEqual([
      'Zu einer PV-Anlage gehören nur Speicher, Zähler und Wallbox.',
      'Die Anlage aus pvSystemId ist keine PV-Anlage an diesem Objekt.',
      'Den Wechselrichter aus inverterId gibt es an dieser PV-Anlage nicht.',
      'An einem Wechselrichter hängt nur, was zu seiner PV-Anlage gehört.',
      'Die Anlage aus pvSystemId gibt es in diesem Betrieb nicht.',
    ])
  })

  it('answers 404 for an installation that is not there', async () => {
    await http()
      .patch(`/installations/${newId<'installation'>()}`)
      .set('x-test-identity', office())
      .send({ designation: 'Nirgends' })
      .expect(404)
  })
})
