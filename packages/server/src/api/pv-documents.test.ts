import { PDFDocument } from '@cantoo/pdf-lib'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { Database, newId, type PrintJob, type Renderer } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { pvHandovers } from '../database/schema/index.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { todayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { changed, created, push as pushVia } from './test-structure.js'

/**
 * The papers of a PV system for its operator (#305): stringplan and component
 * list printed from the structure as it stands, and the folder of a handover,
 * frozen that day with the newest signed protocols of the system and what
 * belongs to it, which nothing done later reaches.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Solar Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Solar Süd GmbH' }

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

function http() {
  return request(app.getHttpServer())
}

function push(operations: unknown[], expected = 201) {
  return pushVia(app, office(), operations, expected)
}

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

async function printed(path: string, who = office()) {
  jobs.length = 0

  await http().get(path).set('x-test-identity', who).buffer(true).parse(binary).expect(200)

  return [...jobs]
}

const signature = {
  name: 'Jonas Brandt',
  path: 'M10,10L200,120',
  signedAt: '2026-11-02T10:00:00.000Z',
}

/** A protocol as the database holds it, signed unless it says otherwise. */
async function aProtocol(over: {
  installation: string
  key: string
  on: string
  status?: 'draft' | 'signed'
  values?: Record<string, unknown>
}) {
  await admin.query(
    `insert into form_records (id, tenant_id, definition_key, definition_version, installation_id, performed_on, status, values)
     values ($1, $2, $3, 1, $4, $5, $6, $7)`,
    [
      newId<'form-record'>(),
      north.id,
      over.key,
      over.installation,
      over.on,
      over.status ?? 'signed',
      JSON.stringify({ tester: 'Jonas Brandt', tester_signature: signature, ...over.values }),
    ],
  )
}

let system = ''
let cabinet = ''
let inverter = ''

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

  const customer = await post('/customers', { kind: 'private', name: 'Familie Weber' })
  const home = await post('/sites', {
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
  })
  cabinet = await post('/installations', {
    siteId: home,
    kind: 'meter_cabinet',
    designation: 'Zählerschrank',
  })

  const battery = await post('/installations', {
    siteId: home,
    kind: 'battery',
    designation: 'Speicher Technikraum',
    manufacturer: 'BYD',
    model: 'Battery-Box HVS 7.7',
    serialNumber: 'P03HVS2310288',
    pvSystemId: system,
  })

  await post('/installations', {
    siteId: home,
    kind: 'meter',
    designation: 'Zweirichtungszähler',
    serialNumber: '1EBZ0100507239',
    pvSystemId: system,
  })

  inverter = newId<'inverter'>()

  const south1 = newId<'pv-string'>()
  const west = newId<'pv-string'>()
  const module = (stringId: string, position: number, serialNumber: string | null) =>
    created('pv_modules', newId<'pv-module'>(), {
      pvStringId: stringId,
      manufacturer: 'JA Solar',
      model: 'JAM54S30-400/MR',
      serialNumber,
      ratedPowerW: 400,
      position,
    })
  const answer = await push([
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
    module(south1, 0, 'JA2404118751'),
    module(south1, 1, 'JA2404118752'),
    module(west, 0, null),
    changed('installations', system, {
      yieldForecastKwh: { from: null, to: 9120 },
      yieldForecastSource: { from: null, to: 'PV*SOL premium' },
    }),
  ])

  expect(answer.receipts.every((receipt) => receipt.outcome === 'applied')).toBe(true)

  // The test of the DC side twice, the newer counts; the commissioning at the battery; a draft counts not.
  await aProtocol({ installation: system, key: 'iec-62446-1', on: '2026-10-01' })
  await aProtocol({ installation: system, key: 'iec-62446-1', on: '2026-11-02' })
  await aProtocol({ installation: battery, key: 'vde-ar-n-4105', on: '2026-11-02' })
  await aProtocol({ installation: system, key: 'vde-0100-600', on: '2026-11-03', status: 'draft' })
})

beforeEach(() => {
  jobs.length = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('stringplan and component list of a PV system (#305)', () => {
  it('print the structure as it stands, with every serial number and the forecast', async () => {
    const [page] = await printed(`/installations/${system}/pv-plan`)
    const html = page?.html ?? ''

    expect(html).toContain('<h1>Stringplan und Komponentenliste</h1>')
    expect(html).toContain(
      'PV-Anlage Dach, Wohnhaus, Birkenweg 7, 69214 Eppelheim, für Familie Weber',
    )
    expect(html).toContain('Ertragsprognose: 9.120 kWh im Jahr, Quelle: PV*SOL premium.')
    expect(html).toContain('<td>WR 1</td>')
    expect(html).toContain('<td>Fronius, Symo GEN24 10.0 Plus</td>')
    expect(html).toContain('<td>Speicher Technikraum</td>')
    expect(html).toContain('<td>1EBZ0100507239</td>')
    expect(html).toContain('<td>String 1, Modul 2</td>')
    expect(html).toContain('<td>JA2404118752</td>')
    // The module of string 2 nobody scanned yet.
    expect(html).toContain('nicht erfasst')
    expect(html).toContain('<td>Süd, 180°</td>')
    expect(html).toContain('<td>West, 270°</td>')
    // Three modules of 400 W, 1,20 kWp together.
    expect(html).toMatch(/Zusammen<\/td><td[^>]*>3<\/td><td[^>]*>1,20 kWp<\/td>/)
    expect(page?.landscape).toBe(true)
  })

  it('are not found for an installation that is no PV system, nor for one of another business', async () => {
    await http()
      .get(`/installations/${cabinet}/pv-plan`)
      .set('x-test-identity', office())
      .expect(404)
    await http()
      .get(`/installations/${system}/pv-plan`)
      .set('x-test-identity', office(south.id))
      .expect(404)
    await http()
      .get('/installations/kein-schluessel/pv-plan')
      .set('x-test-identity', office())
      .expect(404)
  })
})

describe('the handover of the folder to the operator (#305)', () => {
  it('freezes the papers of the day with the newest signed protocols, and nothing later reaches them', async () => {
    const handed = await http()
      .post(`/installations/${system}/handovers`)
      .set('x-test-identity', office())
      .expect(201)
    const body = handed.body as { id: string; handedOverOn: string; protocols: number }

    expect(body).toMatchObject({ handedOverOn: todayInGermany(), protocols: 2 })

    // After the handover the inverter is renamed and the forecast changed.
    const answer = await push([
      changed('inverters', inverter, { designation: { from: 'WR 1', to: 'WR Süd' } }),
      changed('installations', system, { yieldForecastKwh: { from: 9120, to: 9500 } }),
    ])

    expect(answer.receipts.every((receipt) => receipt.outcome === 'applied')).toBe(true)

    const list = await http()
      .get(`/installations/${system}/handovers`)
      .set('x-test-identity', office())
      .expect(200)

    expect(list.body).toEqual([
      { id: body.id, handedOverOn: todayInGermany(), handedOverBy: null, protocols: 2 },
    ])

    const pages = await printed(`/installations/${system}/handovers/${body.id}/pdf`)
    const titles = pages.map((page) => /<h1>([^<]*)<\/h1>/.exec(page.html)?.[1])

    expect(titles).toEqual([
      'Unterlagen der PV-Anlage',
      'Prüfprotokoll Gleichstromseite nach DIN EN IEC 62446-1',
      'Inbetriebsetzungsprotokoll nach VDE-AR-N 4105',
    ])
    expect(pages[0]?.html).toContain('<td>WR 1</td>')
    expect(pages[0]?.html).not.toContain('WR Süd')
    expect(pages[0]?.html).toContain('Ertragsprognose: 9.120 kWh im Jahr')
    expect(pages[0]?.html).toContain(
      'Prüfprotokoll Gleichstromseite nach DIN EN IEC 62446-1, PV-Anlage Dach, vom 02.11.2026',
    )
    expect(pages[1]?.html).toContain('Geprüft am 02.11.2026')
    expect(pages[2]?.html).toContain('Speicher Technikraum')

    // The papers as they stand now have moved on.
    const [now] = await printed(`/installations/${system}/pv-plan`)

    expect(now?.html).toContain('<td>WR Süd</td>')
    expect(now?.html).toContain('Ertragsprognose: 9.500 kWh im Jahr')
  })

  it('cannot be changed or deleted by the application, only added and read', async () => {
    const actor = { tenantId: north.id }
    // What the database answered, under the wrapping of the query builder.
    const refusal = async (work: Promise<unknown>) => {
      try {
        await work
      } catch (error) {
        return String((error as { cause?: unknown }).cause ?? error)
      }

      return null
    }

    expect(
      await refusal(
        database.forTenant(actor, (tx) =>
          tx.update(pvHandovers).set({ handedOverOn: '2020-01-01' }),
        ),
      ),
    ).toMatch(/permission denied/)
    // Deleting goes only with the site of a deleted customer (#848), and otherwise its lock refuses.
    expect(await refusal(database.forTenant(actor, (tx) => tx.delete(pvHandovers)))).toMatch(
      /Übergabe der PV-Anlagendokumentation wird weder geändert noch gelöscht/,
    )
  })

  it('belongs to its business: another sees none of it and cannot print it', async () => {
    const [handover] = (
      await http()
        .get(`/installations/${system}/handovers`)
        .set('x-test-identity', office())
        .expect(200)
    ).body as { id: string }[]

    const other = await http()
      .get(`/installations/${system}/handovers`)
      .set('x-test-identity', office(south.id))
      .expect(200)

    expect(other.body).toEqual([])
    await http()
      .get(`/installations/${system}/handovers/${handover?.id ?? ''}/pdf`)
      .set('x-test-identity', office(south.id))
      .expect(404)
    await http()
      .post(`/installations/${system}/handovers`)
      .set('x-test-identity', office(south.id))
      .expect(404)
  })
})

describe('the forecast of the yield (#305)', () => {
  it('is a whole number of kilowatt hours, refused otherwise with the sentence of the form', async () => {
    const site = (
      await admin.query<{ site_id: string }>('select site_id from installations where id = $1', [
        system,
      ])
    ).rows[0]?.site_id
    const another = await post('/installations', {
      siteId: site,
      kind: 'pv_system',
      designation: 'PV-Anlage Garage',
    })
    const answer = await push(
      [changed('installations', another, { yieldForecastKwh: { from: null, to: 9120.5 } })],
      400,
    )

    expect(answer.message).toBe(
      'Die Ertragsprognose ist eine ganze Zahl von Kilowattstunden im Jahr.',
    )
  })
})
