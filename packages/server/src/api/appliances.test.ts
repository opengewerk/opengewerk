import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { permissionCatalogue, type RoleKey, shippedRoles, type TenantId } from '@opengewerk/domain'
import { Database, newId, type PrintJob, type Renderer } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  checkViolation,
  connect,
  refusedBy,
  resetToMigrated,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { changed, created, push } from './test-structure.js'

/**
 * The register of appliances and their test after DGUV Vorschrift 3 (#303):
 * an appliance is made at a site through the outbox, like an installation;
 * its test hangs on it and on nothing else; a technician's device holds the
 * appliances of the sites of its jobs; the protocol prints its limits worked
 * out of the appliance, and the report of a site lists every appliance with
 * its last signed test.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let site = ''
let customer = ''
let installation = ''

const jobs: PrintJob[] = []
const standIn: Renderer = (job) => {
  jobs.push(job)

  return Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))
}

function person(userId: string, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId, tenantId: north.id, roles })
}

function http() {
  return request(app.getHttpServer())
}

async function post(path: string, body: Record<string, unknown>, who: string) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

const signature = {
  name: 'Anna Weber',
  path: 'M10,10L200,120L400,80',
  signedAt: '2026-11-02T10:00:00.000Z',
}

/** Everything the test needs before it can be signed. */
function complete(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tester: 'Anna Weber',
    test_kind: 'recurring',
    housing: 'ok',
    cord: 'ok',
    plug: 'ok',
    markings: 'ok',
    suitability: 'ok',
    function: 'ok',
    safety_devices: 'not_applicable',
    verdict: 'passed',
    next_inspection_months: 12_000,
    ...over,
  })
}

function anAppliance(id: string, fields: Record<string, unknown> = {}) {
  return created('appliances', id, {
    siteId: site,
    inventoryNumber: '002',
    designation: 'Verlängerungsleitung 25 m',
    protectionClass: 'I',
    mobility: 'portable',
    cordLengthMilli: 25_000,
    ...fields,
  } as never)
}

function aTest(
  id: string,
  subject: Record<string, unknown>,
  values = complete(),
  performedOn = '2026-11-02',
) {
  return created('form_records', id, {
    definitionKey: 'dguv-v3',
    definitionVersion: 1,
    performedOn,
    status: 'draft',
    values,
    ...subject,
  } as never)
}

/** Signs a draft made with `aTest`, as the device does. */
function signed(id: string, before: string, after: string) {
  return changed('form_records', id, {
    status: { from: 'draft', to: 'signed' },
    values: { from: before, to: after },
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])
  await admin.query(
    `insert into auth_users (id, name, email) values ('max', 'Max Monteur', 'max@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, 'max', '{technician}')`,
    [north.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const office = as(north.id, 'office')

  customer = await post('/customers', { kind: 'business', name: 'Hausverwaltung Süd GmbH' }, office)
  site = await post(
    '/sites',
    {
      customerId: customer,
      designation: 'Rheinstraße 12',
      street: 'Rheinstraße',
      houseNumber: '12',
      postalCode: '68159',
      city: 'Mannheim',
    },
    office,
  )
  installation = await post(
    '/installations',
    { siteId: site, kind: 'meter_cabinet', designation: 'Zählerschrank' },
    office,
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an appliance of the register', () => {
  it('is made at a site through the outbox, on site as in the office', async () => {
    const id = newId<'appliance'>()
    const { receipts } = await push(app, as(north.id, 'technician'), [anAppliance(id)])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const { rows } = await admin.query(
      'select site_id, designation, protection_class, cord_length_milli from appliances where id = $1',
      [id],
    )

    expect(rows).toEqual([
      {
        site_id: site,
        designation: 'Verlängerungsleitung 25 m',
        protection_class: 'I',
        cord_length_milli: 25_000,
      },
    ])
  })

  it('is refused without a designation, and with a lead that has no length', async () => {
    const office = as(north.id, 'office')
    const unnamed = await push(
      app,
      office,
      [anAppliance(newId<'appliance'>(), { designation: ' ' })],
      400,
    )
    const nothing = await push(
      app,
      office,
      [anAppliance(newId<'appliance'>(), { cordLengthMilli: 0 })],
      400,
    )

    expect(unnamed.message).toBe('Ein Gerät braucht eine Bezeichnung.')
    expect(nothing.message).toBe('Die Länge ist größer als 0 und höchstens 1000 m.')
  })

  it('is written by nobody without the right to change installations', async () => {
    // Everything a technician may, but changing the installations: the
    // register is part of the installations of a site, and so is their right.
    const technician = shippedRoles.find((role) => role.key === 'technician')
    const rights = permissionCatalogue.sumOf(technician ? [technician] : []).rights
    const who = (held: readonly string[]) =>
      JSON.stringify({ userId: 'lena', tenantId: north.id, roles: [], rights: held })

    const refused = await push(
      app,
      who(rights.filter((right) => right !== 'installation.write')),
      [anAppliance(newId<'appliance'>())],
      400,
    )

    expect(refused.message).toBe(
      'Anlagen bearbeiten darf dieser Zugang nicht. Der Inhaber vergibt die Rollen unter „Zugänge“.',
    )

    const { receipts } = await push(app, who(rights), [anAppliance(newId<'appliance'>())])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
  })

  it('is held by the database to a designation and a lead of a length, whichever way it comes', async () => {
    expect(
      await refusedBy(
        admin.query(
          `insert into appliances (tenant_id, site_id, designation, protection_class, cord_length_milli)
         values ($1, $2, 'Bohrhammer', 'II', 0)`,
          [north.id, site],
        ),
      ),
    ).toEqual({ code: checkViolation, constraint: 'appliances_cord_length' })
    expect(
      await refusedBy(
        admin.query(
          `insert into appliances (tenant_id, site_id, designation, protection_class)
         values ($1, $2, '  ', 'II')`,
          [north.id, site],
        ),
      ),
    ).toEqual({ code: checkViolation, constraint: 'appliances_designation_named' })
  })

  it('reaches a device with the sites of its jobs and no other', async () => {
    const technician = person('max', 'technician')
    const office = as(north.id, 'office')
    const id = newId<'appliance'>()

    await push(app, office, [
      anAppliance(id, { inventoryNumber: '007', designation: 'Waschmaschine' }),
    ])

    const pulled = async () => {
      const answer = await http()
        .get('/sync?since=0')
        .set('x-test-identity', technician)
        .expect(200)
      const changes = (answer.body as { changes: { entity: string; rows: { id: string }[] }[] })
        .changes

      return (
        changes.find((change) => change.entity === 'appliances')?.rows.map((row) => row.id) ?? []
      )
    }

    // On no job, the technician holds no appliance of the site.
    expect(await pulled()).not.toContain(id)

    const job = await post(
      '/jobs',
      {
        customerId: customer,
        siteId: site,
        kind: 'service',
        status: 'active',
        designation: 'Geräte prüfen',
      },
      office,
    )

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office)
      .send({ userIds: ['max'] })
      .expect(200)

    expect(await pulled()).toContain(id)
  })
})

describe('the test of an appliance after DGUV Vorschrift 3', () => {
  it('hangs on the appliance and is signed there', async () => {
    const appliance = newId<'appliance'>()
    const id = newId<'form-record'>()
    const technician = as(north.id, 'technician')
    const before = complete({ protective_conductor: 650 })

    await push(app, technician, [anAppliance(appliance)])

    const { receipts } = await push(app, technician, [
      aTest(id, { applianceId: appliance }, before),
      signed(id, before, complete({ protective_conductor: 650, tester_signature: signature })),
    ])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied', 'applied'])
  })

  it('is refused at an installation, and a protocol of an installation at an appliance', async () => {
    const appliance = newId<'appliance'>()
    const technician = as(north.id, 'technician')

    await push(app, technician, [anAppliance(appliance)])

    const atInstallation = await push(
      app,
      technician,
      [aTest(newId<'form-record'>(), { installationId: installation })],
      400,
    )
    const atAppliance = await push(
      app,
      technician,
      [
        created('form_records', newId<'form-record'>(), {
          definitionKey: 'vde-0105-100',
          definitionVersion: 1,
          applianceId: appliance,
          performedOn: '2026-11-02',
          status: 'draft',
          values: '{}',
        } as never),
      ],
      400,
    )

    expect(atInstallation.message).toBe('Dieses Formular gehört an ein Gerät.')
    expect(atAppliance.message).toBe('Dieses Formular gehört an eine Anlage.')
  })

  it('hangs on exactly one of an installation and an appliance, whichever way it comes', async () => {
    const appliance = newId<'appliance'>()

    await push(app, as(north.id, 'office'), [anAppliance(appliance)])

    expect(
      await refusedBy(
        admin.query(
          `insert into form_records (tenant_id, definition_key, definition_version, installation_id, appliance_id, performed_on)
         values ($1, 'dguv-v3', 1, $2, $3, '2026-11-02')`,
          [north.id, installation, appliance],
        ),
      ),
    ).toEqual({ code: checkViolation, constraint: 'form_records_one_subject' })
    expect(
      await refusedBy(
        admin.query(
          `insert into form_records (tenant_id, definition_key, definition_version, performed_on)
         values ($1, 'dguv-v3', 1, '2026-11-02')`,
          [north.id],
        ),
      ),
    ).toEqual({ code: checkViolation, constraint: 'form_records_one_subject' })
  })

  it('prints its values judged by the limits worked out of the appliance', async () => {
    const appliance = newId<'appliance'>()
    const id = newId<'form-record'>()
    const technician = as(north.id, 'technician')
    const values = complete({ protective_conductor: 650 })

    await push(app, technician, [
      anAppliance(appliance),
      aTest(id, { applianceId: appliance }, values),
    ])
    await http()
      .get(`/form-records/${id}/pdf`)
      .set('x-test-identity', as(north.id, 'office'))
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(html).toContain('<h1>Prüfprotokoll Geräteprüfung nach DGUV Vorschrift 3</h1>')
    expect(html).toContain(
      '002 Verlängerungsleitung 25 m, Schutzklasse I, Anschlussleitung 25 m, Rheinstraße 12',
    )
    // 0,3 Ω up to 5 m and 0,1 Ω for each of the three lengths of 7,5 m begun beyond.
    expect(html).toContain('0,65 Ω <span class="outside">außerhalb des Grenzwerts</span>')
    expect(html).toContain('höchstens 0,60 Ω; DGUV Information 203-070')
  })
})

describe('the report of a site after DGUV Vorschrift 3', () => {
  it('lists every appliance with its last signed test, the untested ones too', async () => {
    // A site of its own, so that the appliances of the other tests stay out.
    const office = as(north.id, 'office')
    const technician = as(north.id, 'technician')
    const yard = await post(
      '/sites',
      {
        customerId: customer,
        designation: 'Bauhof',
        street: 'Hafenstraße',
        houseNumber: '2',
        postalCode: '68159',
        city: 'Mannheim',
      },
      office,
    )
    const drill = newId<'appliance'>()
    const heater = newId<'appliance'>()
    const drum = newId<'appliance'>()
    const older = newId<'form-record'>()
    const newer = newId<'form-record'>()
    const defect = newId<'form-record'>()
    const draft = newId<'form-record'>()
    const first = complete({ next_inspection_months: 6_000 })
    const second = complete()
    const found = complete({ verdict: 'defects', defects: 'Leitung beschädigt.', cord: 'defect' })

    await push(app, technician, [
      anAppliance(drill, {
        siteId: yard,
        inventoryNumber: '10',
        designation: 'Bohrhammer',
        protectionClass: 'II',
        cordLengthMilli: null,
      }),
      anAppliance(heater, {
        siteId: yard,
        inventoryNumber: '9',
        designation: 'Heizlüfter',
        cordLengthMilli: null,
      }),
      anAppliance(drum, { siteId: yard, inventoryNumber: null, designation: 'Kabeltrommel 50 m' }),
      aTest(older, { applianceId: drill }, first, '2026-01-10'),
      signed(
        older,
        first,
        complete({ next_inspection_months: 6_000, tester_signature: signature }),
      ),
      aTest(newer, { applianceId: drill }, second),
      signed(newer, second, complete({ tester_signature: signature })),
      aTest(defect, { applianceId: heater }, found),
      signed(
        defect,
        found,
        complete({
          verdict: 'defects',
          defects: 'Leitung beschädigt.',
          cord: 'defect',
          tester_signature: signature,
        }),
      ),
      // A draft is no test anybody vouched for.
      aTest(draft, { applianceId: drum }),
    ])

    await http()
      .get(`/sites/${yard}/appliance-report`)
      .set('x-test-identity', office)
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''
    const rows = [...html.matchAll(/<td class="number">([^<]*)<\/td>/g)].map((match) => match[1])

    expect(html).toContain('<h1>Prüfbericht nach DGUV Vorschrift 3</h1>')
    expect(html).toContain('Bauhof, Hafenstraße 2, 68159 Mannheim, für Hausverwaltung Süd GmbH')
    // As a person counts: 9 before 10, and one without a number last.
    expect(rows).toEqual(['9', '10', ''])
    // The newest signed test of the drill, a year from the 2nd of November.
    expect(html).toContain('02.11.2027')
    expect(html).not.toContain('10.07.2026')
    expect(html).toContain('<span class="outside">Mängel festgestellt</span>')
    expect(html).toContain('<span class="untested">noch nicht geprüft</span>')
    expect(html).toContain('3 Geräte: 1 ohne Mängel, 1 mit Mängeln, 1 noch nicht geprüft.')
  })

  it('is not found for a site of another business, nor for one that is not there', async () => {
    const theirs = await post(
      '/customers',
      { kind: 'business', name: 'Süd' },
      as(south.id, 'office'),
    )
    const theirSite = await post(
      '/sites',
      {
        customerId: theirs,
        designation: 'Süd 1',
        street: 'Weg',
        houseNumber: '1',
        postalCode: '68159',
        city: 'Mannheim',
      },
      as(south.id, 'office'),
    )

    await http()
      .get(`/sites/${theirSite}/appliance-report`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(404)
    await http()
      .get(`/sites/${newId<'site'>()}/appliance-report`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(404)
  })
})
