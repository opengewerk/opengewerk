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

/**
 * The test of the electrical installation of a site (#302), as one PDF: the
 * report reads the last signed test of the whole of each installation and the
 * last test of each appliance of the site, leaves out a heating nobody tested
 * electrically, and binds the protocols of the installations behind it.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customer = ''

const jobs: PrintJob[] = []
// A real PDF of one page per job, so that the parts can be bound into one.
const standIn: Renderer = async (job) => {
  jobs.push(job)

  const pdf = await PDFDocument.create()

  pdf.addPage()

  return pdf.save()
}

const signature = {
  name: 'Anna Weber',
  path: 'M10,10L200,120L400,80',
  signedAt: '2026-11-02T10:00:00.000Z',
}

/** A site of the business, with nothing on it yet. */
async function aSite(designation: string, tenant = north.id, owner = customer): Promise<string> {
  const id = newId<'site'>()

  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation, street, house_number, postal_code, city)
     values ($1, $2, $3, $4, 'Rheinstraße', '12', '68159', 'Mannheim')`,
    [id, tenant, owner, designation],
  )

  return id
}

async function anInstallation(site: string, kind: string, designation: string): Promise<string> {
  const id = newId<'installation'>()

  await admin.query(
    `insert into installations (id, tenant_id, site_id, kind, designation) values ($1, $2, $3, $4, $5)`,
    [id, north.id, site, kind, designation],
  )

  return id
}

async function anAppliance(site: string, number: string, designation: string): Promise<string> {
  const id = newId<'appliance'>()

  await admin.query(
    `insert into appliances (id, tenant_id, site_id, inventory_number, designation, protection_class, mobility)
     values ($1, $2, $3, $4, $5, 'II', 'portable')`,
    [id, north.id, site, number, designation],
  )

  return id
}

/** A protocol as the database holds it, signed unless it says otherwise. */
async function aProtocol(over: {
  installation?: string
  appliance?: string
  key: string
  version: number
  on: string
  values: Record<string, unknown>
  status?: 'draft' | 'signed'
}): Promise<void> {
  await admin.query(
    `insert into form_records (id, tenant_id, definition_key, definition_version, installation_id, appliance_id, performed_on, status, values)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      newId<'form-record'>(),
      north.id,
      over.key,
      over.version,
      over.installation ?? null,
      over.appliance ?? null,
      over.on,
      over.status ?? 'signed',
      JSON.stringify({ tester: 'Anna Weber', tester_signature: signature, ...over.values }),
    ],
  )
}

async function printed(site: string, who = as(north.id, 'office')) {
  jobs.length = 0

  const answer = await request(app.getHttpServer())
    .get(`/sites/${site}/inspection-report`)
    .set('x-test-identity', who)
    .buffer(true)
    .parse(binary)
    .expect(200)
  const pdf = await PDFDocument.load(answer.body as Buffer)

  return { pages: pdf.getPageCount(), report: jobs[0]?.html ?? '', protocols: jobs.slice(1) }
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

  customer = newId<'customer'>()
  await admin.query(
    `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Hausverwaltung Süd GmbH')`,
    [customer, north.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(() => {
  jobs.length = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the test of the electrical installation of a site', () => {
  it('reads the last test of the whole of each installation and of each appliance', async () => {
    const site = await aSite('Rheinstraße 12')
    const cabinet = await anInstallation(site, 'meter_cabinet', 'Zählerschrank, Keller')
    const roof = await anInstallation(site, 'pv_system', 'PV-Anlage Dach')
    const store = await anInstallation(site, 'battery', 'Speicher Technikraum')
    const drill = await anAppliance(site, '001', 'Bohrhammer')

    await anAppliance(site, '008', 'Kabeltrommel 50 m')
    await aProtocol({
      installation: cabinet,
      key: 'vde-0105-100',
      version: 1,
      on: '2022-03-01',
      values: { verdict: 'passed', next_inspection_months: 48_000 },
    })
    await aProtocol({
      installation: cabinet,
      key: 'vde-0105-100',
      version: 1,
      on: '2026-11-02',
      values: { verdict: 'defects', defects: 'F3 zu hoch.', next_inspection_months: 48_000 },
    })
    // An extension after it tests a part, and the report names the test of the whole.
    await aProtocol({
      installation: cabinet,
      key: 'vde-0100-600',
      version: 3,
      on: '2026-11-05',
      values: { occasion: 'extension', verdict: 'passed' },
    })
    await aProtocol({
      installation: roof,
      key: 'vde-0100-600',
      version: 3,
      on: '2024-05-17',
      values: { occasion: 'new', verdict: 'passed', next_inspection_months: 48_000 },
    })
    // A draft is no test anybody vouched for.
    await aProtocol({
      installation: store,
      key: 'vde-0105-100',
      version: 1,
      on: '2026-11-02',
      values: { verdict: 'passed' },
      status: 'draft',
    })
    await aProtocol({
      appliance: drill,
      key: 'dguv-v3',
      version: 1,
      on: '2026-11-02',
      values: { verdict: 'passed', next_inspection_months: 12_000 },
    })

    const { pages, report, protocols } = await printed(site)

    expect(report).toContain('<h1>Prüfung der Elektroinstallation</h1>')
    expect(report).toContain(
      'Rheinstraße 12, Rheinstraße 12, 68159 Mannheim, für Hausverwaltung Süd GmbH',
    )
    expect(report).toContain('Ergebnis: Mängel festgestellt')
    expect(report).toContain(
      '3 Anlagen: 1 ohne Mängel, 1 mit Mängeln, 1 noch nicht geprüft. 2 Geräte: 1 ohne Mängel, 0 mit Mängeln, 1 noch nicht geprüft.',
    )
    expect(report).toContain('Nächste Prüfung am Objekt: 02.11.2027.')
    expect(report).toContain('<td>Wiederholungsprüfung nach DIN VDE 0105-100</td>')
    expect(report).toContain('<td>Erstprüfung nach DIN VDE 0100-600</td>')
    expect(report).not.toContain('05.11.2026')
    expect(report).not.toContain('01.03.2022')
    // The protocols of the two tested installations behind the report, by their designation.
    expect(protocols.map((job) => /<h1>([^<]*)<\/h1>/.exec(job.html)?.[1])).toEqual([
      'Prüfprotokoll Erstprüfung nach DIN VDE 0100-600',
      'Prüfprotokoll Wiederholungsprüfung nach DIN VDE 0105-100',
    ])
    expect(protocols[1]?.html).toContain('F3 zu hoch.')
    expect(pages).toBe(3)
  })

  it('leaves out a heating nobody tested with a protocol of an installation', async () => {
    const site = await aSite('Lindenweg 3')
    const heating = await anInstallation(site, 'heating', 'Wärmepumpe')

    await anInstallation(site, 'wallbox', 'Wallbox Garage')

    expect((await printed(site)).report).not.toContain('Wärmepumpe')

    await aProtocol({
      installation: heating,
      key: 'vde-0100-600',
      version: 3,
      on: '2026-10-01',
      values: { occasion: 'new', verdict: 'passed', next_inspection_months: 48_000 },
    })

    const { report, pages } = await printed(site)

    expect(report).toContain('Wärmepumpe<div class="maker">Heizung</div>')
    expect(report).toContain('Ergebnis: Noch nicht alles geprüft')
    expect(pages).toBe(2)
  })

  it('is one page with nothing tested, and says so', async () => {
    const site = await aSite('Leer')
    const { report, protocols, pages } = await printed(site)

    expect(report).toContain('Ergebnis: Noch nichts geprüft')
    expect(report).toContain('An diesem Objekt gibt es noch keine Anlage.')
    expect(report).not.toContain('Die Protokolle der Anlagen folgen')
    expect(protocols).toEqual([])
    expect(pages).toBe(1)
  })

  it('is not found for a site of another business, nor for one that is not there', async () => {
    const theirs = newId<'customer'>()

    await admin.query(
      `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Süd')`,
      [theirs, south.id],
    )

    const theirSite = await aSite('Süd 1', south.id, theirs)

    for (const site of [theirSite, newId<'site'>()]) {
      await request(app.getHttpServer())
        .get(`/sites/${site}/inspection-report`)
        .set('x-test-identity', as(north.id, 'office'))
        .expect(404)
    }
  })
})
