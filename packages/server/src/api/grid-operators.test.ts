import { PDFDocument } from '@cantoo/pdf-lib'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { Database, newId, type PrintJob, type Renderer } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { changed, created, push as pushVia } from './test-structure.js'

/**
 * The grid operators of a business and the papers for them (#306): the owner
 * and the office keep the grid operators with the entry of the business in
 * their installer directories; a PV system, a battery or a wallbox names its
 * grid operator; and out of that come the application, the completion with
 * the commissioning protocols behind it, and the help for the register.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const jobs: PrintJob[] = []
// A real PDF of one page per job, so that the parts can be bound into one.
const standIn: Renderer = async (job) => {
  jobs.push(job)

  const pdf = await PDFDocument.create()

  pdf.addPage()

  return pdf.save()
}

const office = (tenant: TenantId = north.id) => as(tenant, 'office')
const technician = (tenant: TenantId = north.id) => as(tenant, 'technician')

function http() {
  return request(app.getHttpServer())
}

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

async function patch(path: string, body: Record<string, unknown>, expected = 200) {
  return http().patch(path).set('x-test-identity', office()).send(body).expect(expected)
}

async function printed(path: string, who = office()) {
  jobs.length = 0

  await http().get(path).set('x-test-identity', who).buffer(true).parse(binary).expect(200)

  return [...jobs]
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

let home = ''
let system = ''
let battery = ''
let cabinet = ''
let operator = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await post('/customers', {
    kind: 'private',
    name: 'Familie Weber',
    phone: '06221 76 54 32',
    street: 'Birkenweg',
    houseNumber: '7',
    postalCode: '69214',
    city: 'Eppelheim',
  })

  home = await post('/sites', {
    customerId: customer,
    designation: 'Wohnhaus',
    street: 'Birkenweg',
    houseNumber: '7',
    postalCode: '69214',
    city: 'Eppelheim',
  })
  system = await post('/installations', {
    siteId: home,
    kind: 'pv_system',
    designation: 'PV-Anlage Dach',
    commissionedOn: '2026-10-20',
  })
  battery = await post('/installations', {
    siteId: home,
    kind: 'battery',
    designation: 'Speicher Technikraum',
    manufacturer: 'BYD',
    model: 'Battery-Box HVS 7.7',
    serialNumber: 'P03HVS2310288',
    pvSystemId: system,
  })
  cabinet = await post('/installations', {
    siteId: home,
    kind: 'meter_cabinet',
    designation: 'Zählerschrank',
  })

  const inverter = newId<'inverter'>()
  const south1 = newId<'pv-string'>()
  const west = newId<'pv-string'>()
  const module = (stringId: string, position: number) =>
    created('pv_modules', newId<'pv-module'>(), {
      pvStringId: stringId,
      manufacturer: 'JA Solar',
      model: 'JAM54S30-400/MR',
      ratedPowerW: 400,
      position,
    })
  const answer = await pushVia(app, office(), [
    created('inverters', inverter, {
      installationId: system,
      designation: 'WR 1',
      manufacturer: 'Fronius',
      model: 'Symo GEN24 10.0 Plus',
      serialNumber: '34120117',
      ratedPowerW: 10_000,
      position: 0,
    }),
    created('pv_strings', south1, {
      inverterId: inverter,
      designation: 'String 1',
      mppInput: 1,
      azimuthDeg: 180,
      tiltDeg: 30,
      position: 0,
    }),
    created('pv_strings', west, {
      inverterId: inverter,
      designation: 'String 2',
      mppInput: 2,
      azimuthDeg: 270,
      tiltDeg: 30,
      position: 1,
    }),
    module(south1, 0),
    module(south1, 1),
    module(south1, 2),
    module(west, 0),
  ])

  expect(answer.receipts.every((receipt) => receipt.outcome === 'applied')).toBe(true)

  operator = await post('/grid-operators', {
    name: 'Stadtwerke Neckartal Netze GmbH',
    portalUrl: 'https://netzportal.neckartal-netze.de',
    requirements: 'Anmeldung über das Netzportal.',
    registrationNumber: 'IV-2023-0417',
    registeredUntil: '2099-12-31',
    responsibleElectrician: 'Moritz Kohm',
  })

  // The commissioning of the PV system after VDE-AR-N 4105, signed, and a draft that counts not.
  for (const [day, status] of [
    ['2026-11-02', 'signed'],
    ['2026-11-03', 'draft'],
  ] as const) {
    await admin.query(
      `insert into form_records (id, tenant_id, definition_key, definition_version, installation_id, performed_on, status, values)
       values ($1, $2, 'vde-ar-n-4105', 1, $3, $4, $5, '{}')`,
      [newId<'form-record'>(), north.id, system, day, status],
    )
  }
})

beforeEach(() => {
  jobs.length = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the grid operators of a business (#306)', () => {
  it('are kept by the owner and the office, and neither read nor kept by a technician', async () => {
    await http().get('/grid-operators').set('x-test-identity', office()).expect(200)
    await http().get('/grid-operators').set('x-test-identity', as(north.id, 'owner')).expect(200)
    await http().get('/grid-operators').set('x-test-identity', technician()).expect(403)
    await http()
      .post('/grid-operators')
      .set('x-test-identity', technician())
      .send({ name: 'Netze Bergstraße GmbH' })
      .expect(403)
  })

  it('need a name, take a portal only as an address, and a last day only with a number', async () => {
    const without = await http()
      .post('/grid-operators')
      .set('x-test-identity', office())
      .send({ name: '  ' })
      .expect(422)
    expect(refusal(without)).toBe('Ein Netzbetreiber braucht einen Namen.')

    const bare = await http()
      .post('/grid-operators')
      .set('x-test-identity', office())
      .send({ name: 'Netze Bergstraße GmbH', portalUrl: 'netzportal.de' })
      .expect(422)
    expect(refusal(bare)).toBe('Das Portal ist eine Adresse, die mit https:// beginnt.')

    const day = await http()
      .post('/grid-operators')
      .set('x-test-identity', office())
      .send({ name: 'Netze Bergstraße GmbH', registeredUntil: '2027-06-30' })
      .expect(422)
    expect(refusal(day)).toBe('Ein letzter Tag gehört zu einer Eintragung mit Nummer.')

    // The number taken out of an entry with a last day: judged with what stays.
    const apart = await patch(`/grid-operators/${operator}`, { registrationNumber: null }, 422)
    expect(refusal(apart)).toBe('Ein letzter Tag gehört zu einer Eintragung mit Nummer.')
  })

  it('are read and changed only in their own business', async () => {
    await http()
      .get(`/grid-operators/${operator}`)
      .set('x-test-identity', office(south.id))
      .expect(404)
    await http()
      .patch(`/grid-operators/${operator}`)
      .set('x-test-identity', office(south.id))
      .send({ name: 'Übernommen' })
      .expect(404)

    const theirs = await http().get('/grid-operators').set('x-test-identity', office(south.id))
    expect(theirs.body).toEqual([])
  })

  it('stay while a living installation names them, and go once none does', async () => {
    const other = await post('/grid-operators', { name: 'Netze Bergstraße GmbH' })
    const wallbox = await post('/installations', {
      siteId: home,
      kind: 'wallbox',
      designation: 'Wallbox Hof',
      gridOperatorId: other,
    })

    const one = await http()
      .get(`/grid-operators/${other}`)
      .set('x-test-identity', office())
      .expect(200)
    expect(one.body).toMatchObject({
      installations: 1,
      named: [
        {
          id: wallbox,
          kind: 'wallbox',
          designation: 'Wallbox Hof',
          site: 'Wohnhaus',
          customer: 'Familie Weber',
        },
      ],
    })

    const held = await http()
      .delete(`/grid-operators/${other}`)
      .set('x-test-identity', office())
      .expect(409)
    expect(refusal(held)).toBe(
      'Eine Anlage nennt diesen Netzbetreiber. Solange sie ihn nennt, lässt er sich nicht entfernen.',
    )

    await patch(`/installations/${wallbox}`, { gridOperatorId: null })
    await http().delete(`/grid-operators/${other}`).set('x-test-identity', office()).expect(200)
    await http().get(`/grid-operators/${other}`).set('x-test-identity', office()).expect(404)

    const list = await http().get('/grid-operators').set('x-test-identity', office())
    expect((list.body as { id: string }[]).map((entry) => entry.id)).not.toContain(other)

    // A removed one is named by no new installation either.
    const named = await http()
      .patch(`/installations/${wallbox}`)
      .set('x-test-identity', office())
      .send({ gridOperatorId: other })
      .expect(422)
    expect(refusal(named)).toBe(
      'Den Netzbetreiber aus gridOperatorId gibt es in diesem Betrieb nicht.',
    )
  })
})

describe('the grid operator of an installation', () => {
  it('is named by a PV system, a battery or a wallbox, and by nothing else', async () => {
    const refused = await patch(`/installations/${cabinet}`, { gridOperatorId: operator }, 422)
    expect(refusal(refused)).toBe(
      'Einen Netzbetreiber nennt nur eine PV-Anlage, ein Speicher oder eine Wallbox.',
    )

    // The same through the sync, as a device would send it: a new one refused with the sentence
    // of the form, and a change against the kind the server holds a conflict on both fields.
    const made = await pushVia(
      app,
      office(),
      [
        created('installations', newId<'installation'>(), {
          siteId: home,
          kind: 'meter',
          designation: 'Zähler',
          gridOperatorId: operator,
        }),
      ],
      400,
    )
    expect(made.message).toBe(
      'Einen Netzbetreiber nennt nur eine PV-Anlage, ein Speicher oder eine Wallbox.',
    )

    const answer = await pushVia(app, office(), [
      changed('installations', cabinet, { gridOperatorId: { from: null, to: operator } }),
    ])
    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      fields: ['kind', 'gridOperatorId'],
    })
  })

  it('is a grid operator of its own business', async () => {
    const theirs = await post('/grid-operators', { name: 'Netz Süd' }, office(south.id))
    const refused = await patch(`/installations/${system}`, { gridOperatorId: theirs }, 422)
    expect(refusal(refused)).toBe(
      'Den Netzbetreiber aus gridOperatorId gibt es in diesem Betrieb nicht.',
    )
  })

  it('is read by whoever may see the installation, without the list', async () => {
    await patch(`/installations/${system}`, {
      gridOperatorId: operator,
      gridOperatorReference: 'SNN-2026-04711',
    })

    const known = await http()
      .get(`/installations/${system}/grid-operator`)
      .set('x-test-identity', technician())
      .expect(200)
    expect(known.body).toEqual({
      operator: {
        id: operator,
        name: 'Stadtwerke Neckartal Netze GmbH',
        portalUrl: 'https://netzportal.neckartal-netze.de',
      },
      reference: 'SNN-2026-04711',
    })
  })
})

describe('the papers for the grid operator', () => {
  beforeAll(async () => {
    await patch(`/installations/${system}`, {
      gridOperatorId: operator,
      gridOperatorReference: 'SNN-2026-04711',
    })
  })

  it('need a grid operator to go to', async () => {
    const lone = await post('/installations', {
      siteId: home,
      kind: 'wallbox',
      designation: 'Wallbox ohne Netzbetreiber',
    })
    const refused = await http()
      .get(`/installations/${lone}/grid-application`)
      .set('x-test-identity', office())
      .expect(409)
    expect(refusal(refused)).toBe(
      'Die Anlage nennt noch keinen Netzbetreiber. Unter „Bearbeiten“ lässt er sich wählen.',
    )
  })

  it('print the application out of customer, site and structure, with the entry of the business', async () => {
    const [page] = await printed(`/installations/${system}/grid-application`)
    const html = page?.html ?? ''

    expect(html).toContain('Anmeldung beim Netzbetreiber')
    expect(html).toContain('An Stadtwerke Neckartal Netze GmbH, Kennung SNN-2026-04711')
    expect(html).toContain('Was der Netzbetreiber verlangt')
    expect(html).toContain('Anmeldung über das Netzportal.')
    expect(html).toContain('Birkenweg 7, 69214 Eppelheim')
    expect(html).toContain('4 Module, JA Solar JAM54S30-400/MR, zusammen 1,60 kWp')
    expect(html).toContain('WR 1, Fronius Symo GEN24 10.0 Plus, Seriennummer 34120117, 10 kW')
    expect(html).toContain(
      'Stadtwerke Neckartal Netze GmbH, Nummer IV-2023-0417, gültig bis 31.12.2099',
    )
    expect(html).toContain('Moritz Kohm')
    expect(html).toContain(
      'Speicher Technikraum, BYD Battery-Box HVS 7.7, Seriennummer P03HVS2310288',
    )
    expect(html).toContain('Geplante Inbetriebnahme')
    expect(page?.landscape).toBe(false)
  })

  it('name another entry that still holds where the own one ran out', async () => {
    const other = await post('/grid-operators', {
      name: 'Netze Bergstraße GmbH',
      registrationNumber: 'NB-77',
      registeredUntil: '2099-06-30',
    })

    await patch(`/grid-operators/${operator}`, { registeredUntil: '2020-12-31' })

    try {
      const [page] = await printed(`/installations/${system}/grid-application`)

      expect(page?.html).toContain('Netze Bergstraße GmbH, Nummer NB-77, gültig bis 30.06.2099')
      expect(page?.html).not.toContain('IV-2023-0417')
    } finally {
      await patch(`/grid-operators/${operator}`, { registeredUntil: '2099-12-31' })
      await http().delete(`/grid-operators/${other}`).set('x-test-identity', office()).expect(200)
    }
  })

  it('bind the signed commissioning protocol behind the completion, with its day', async () => {
    const pages = await printed(`/installations/${system}/grid-completion`)

    expect(pages).toHaveLength(2)
    expect(pages[0]?.html).toContain('Fertigmeldung an den Netzbetreiber')
    expect(pages[0]?.html).toContain('Tag der Inbetriebsetzung')
    // The day of the signed protocol, not of the draft after it nor of "In Betrieb seit".
    expect(pages[0]?.html).toContain('<th>Tag der Inbetriebsetzung</th><td>02.11.2026</td>')
    expect(pages[0]?.html).not.toContain('Geplante Inbetriebnahme')
    expect(pages[1]?.html).toContain('In Betrieb gesetzt am 02.11.2026')
  })

  it('are not for a meter cabinet, nor for a battery that belongs to a PV system', async () => {
    for (const id of [cabinet, battery]) {
      await http()
        .get(`/installations/${id}/grid-application`)
        .set('x-test-identity', office())
        .expect(404)
      await http()
        .get(`/installations/${id}/market-register`)
        .set('x-test-identity', office())
        .expect(404)
    }
  })
})

describe('the help for the Marktstammdatenregister', () => {
  it('names the deadline of the operator, a month after the commissioning', async () => {
    const [page] = await printed(`/installations/${system}/market-register`)
    const html = page?.html ?? ''

    expect(html).toContain('Ausfüllhilfe für das Marktstammdatenregister')
    expect(html).toContain('In Betrieb seit 02.11.2026, also bis zum 02.12.2026.')
  })

  it('asks a natural person what the register asks of one, and answers out of the structure', async () => {
    const [page] = await printed(`/installations/${system}/market-register`)
    const html = page?.html ?? ''

    expect(html).toContain('Anlagenbetreiber als Marktakteur, natürliche Person')
    expect(html).toContain('Geburtsdatum')
    expect(html).toContain('Süd, 180°, Neigung 30°, 3 Module')
    expect(html).toContain('West, 270°, Neigung 30°, 1 Modul')
    expect(html).toContain('Stromspeicher Speicher Technikraum')
    expect(html).toContain('SNN-2026-04711')
    // Under 25 kW nothing of a direct marketer, and after 2022 nothing of the old control.
    expect(html).not.toContain('Direktvermarkter')
    expect(html).not.toContain('Fernsteuerbarkeit durch den Netzbetreiber')
  })

  it('is not for a wallbox, which the register does not ask about', async () => {
    const wallbox = await post('/installations', {
      siteId: home,
      kind: 'wallbox',
      designation: 'Wallbox Garage',
      gridOperatorId: operator,
    })

    await http()
      .get(`/installations/${wallbox}/market-register`)
      .set('x-test-identity', office())
      .expect(404)
  })
})
