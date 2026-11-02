import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PDFDocument } from '@cantoo/pdf-lib'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import {
  Database,
  FileStore,
  newId,
  type PrintJob,
  type Renderer,
} from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { issuableDraft, invoiceable, readyToInvoice } from './test-invoice.js'
import { created, push as pushVia } from './test-structure.js'

/**
 * Wallbox and battery (#307): the capacity and power an installation names,
 * the funding programmes as templates the owner and the office keep, and the
 * papers of a programme put together at an installation: the list of proofs,
 * the declaration, the serial numbers, the commissioning protocol and the
 * invoices behind them.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let store: FileStore

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

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

/** The papers as one PDF, and the pages the renderer was asked for on the way. */
async function papers(path: string, who = office()) {
  jobs.length = 0

  const answer = await http()
    .get(path)
    .set('x-test-identity', who)
    .buffer(true)
    .parse(binary)
    .expect(200)
  const pdf = await PDFDocument.load(answer.body as Buffer)

  return { pages: pdf.getPageCount(), printed: [...jobs] }
}

const programme = {
  name: 'Ladeinfrastruktur 2026',
  sponsor: 'Stadtwerke Neckartal',
  url: 'https://stadtwerke.example.org/foerderung',
  kinds: ['wallbox', 'battery'],
  evidence: [
    { source: 'invoice', label: 'Rechnung mit einzeln ausgewiesenen Positionen' },
    { source: 'declaration', label: 'Fachunternehmererklärung' },
    { source: 'commissioning', label: 'Inbetriebnahmeprotokoll der Ladeeinrichtung' },
    { source: 'photos', label: 'Foto der Wallbox mit Typenschild' },
    { source: 'serial_numbers', label: 'Seriennummer der Wallbox' },
    { source: 'operator', label: 'Kontoauszug mit allen Zahlungen' },
  ],
  declaration:
    'Hiermit bestätigt {betrieb}, dass {anlage} mit der Seriennummer {seriennummer} bei {betreiber} am {inbetriebnahme} mit {leistung} in Betrieb ging.',
}

let customer = ''
let home = ''
let wallbox = ''
let battery = ''
let meter = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])
  await readyToInvoice(admin, north.id)

  database = Database.connect(applicationDatabaseUrl())
  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-funding-'))
  store = new FileStore(storageRoot)

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { renderer: standIn, files: store })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  customer = await post('/customers', { kind: 'private', name: 'Familie Weber', ...invoiceable })
  home = await post('/sites', { customerId: customer, designation: 'Wohnhaus', ...invoiceable })
  wallbox = await post('/installations', {
    siteId: home,
    kind: 'wallbox',
    designation: 'Wallbox Garage',
    manufacturer: 'Mennekes',
    model: 'Amtron 4Business',
    serialNumber: 'MA4B-2611-08812',
    ratedPowerW: 11_000,
  })
  battery = await post('/installations', {
    siteId: home,
    kind: 'battery',
    designation: 'Speicher Keller',
    usableCapacityWh: 7680,
    ratedPowerW: 5000,
  })
  meter = await post('/installations', { siteId: home, kind: 'meter', designation: 'Zähler' })
})

beforeEach(() => {
  jobs.length = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the capacity and the power an installation names (#307)', () => {
  it('are kept at a battery and the power at a wallbox', async () => {
    const { rows } = await admin.query<{
      usable_capacity_wh: number | null
      rated_power_w: number | null
    }>(
      'select usable_capacity_wh, rated_power_w from installations where id = any($1) order by designation',
      [[battery, wallbox]],
    )

    expect(rows).toEqual([
      { usable_capacity_wh: 7680, rated_power_w: 5000 },
      { usable_capacity_wh: null, rated_power_w: 11_000 },
    ])
  })

  it('are refused at a kind that has none, at the route and in the sync', async () => {
    const atWallbox = await http()
      .patch(`/installations/${wallbox}`)
      .set('x-test-identity', office())
      .send({ usableCapacityWh: 7680 })
      .expect(422)
    expect(refusal(atWallbox)).toBe('Eine nutzbare Kapazität nennt nur ein Speicher.')

    const atMeter = await http()
      .patch(`/installations/${meter}`)
      .set('x-test-identity', office())
      .send({ ratedPowerW: 4000 })
      .expect(422)
    expect(refusal(atMeter)).toBe(
      'Eine Bemessungsleistung nennen nur ein Speicher und eine Wallbox.',
    )

    const pushed = await pushVia(
      app,
      office(),
      [
        created('installations', newId<'installation'>(), {
          siteId: home,
          kind: 'heating',
          designation: 'Heizung',
          ratedPowerW: 9000,
        }),
      ],
      400,
    )

    expect(pushed.message).toContain('Eine Bemessungsleistung nennen nur ein Speicher und eine Wallbox.')
    expect(
      (await admin.query("select 1 from installations where designation = 'Heizung'")).rowCount,
    ).toBe(0)
  })

  it('are refused by the database too, past every route', async () => {
    await expect(
      admin.query(
        `insert into installations (tenant_id, site_id, kind, designation, rated_power_w)
         values ($1, $2, 'meter', 'Zähler mit Leistung', 4000)`,
        [north.id, home],
      ),
    ).rejects.toThrow('installations_ratings')
    await expect(
      admin.query(
        `insert into installations (tenant_id, site_id, kind, designation, usable_capacity_wh)
         values ($1, $2, 'wallbox', 'Wallbox mit Kapazität', 7680)`,
        [north.id, home],
      ),
    ).rejects.toThrow('installations_ratings')
  })

  it('are refused as no whole number above none', async () => {
    const answer = await http()
      .patch(`/installations/${wallbox}`)
      .set('x-test-identity', office())
      .send({ ratedPowerW: 0 })
      .expect(422)
    expect(refusal(answer)).toBe(
      'Die Bemessungsleistung ist größer als null und höchstens 100.000 kW.',
    )
  })

  it('stand on the application of a wallbox and a battery of their own', async () => {
    const operator = await post('/grid-operators', { name: 'Stadtwerke Neckartal Netze GmbH' })

    for (const id of [wallbox, battery]) {
      await http()
        .patch(`/installations/${id}`)
        .set('x-test-identity', office())
        .send({ gridOperatorId: operator })
        .expect(200)
    }

    await papers(`/installations/${wallbox}/grid-application`)
    expect(jobs[0]?.html).toContain('<th>Bemessungsleistung</th><td>11 kW</td>')

    await papers(`/installations/${battery}/grid-application`)
    expect(jobs[0]?.html).toContain('<th>Nutzbare Speicherkapazität</th><td>7,68 kWh</td>')
    expect(jobs[0]?.html).toContain('<th>Wechselrichterleistung</th><td>5 kW</td>')
  })

  it('leave the completion of a battery with the protocol for the grid operator only', async () => {
    await admin.query(
      `insert into form_records (id, tenant_id, definition_key, definition_version, installation_id, performed_on, status, values)
       values ($1, $2, 'vde-ar-n-4105', 1, $3, '2026-11-02', 'signed', '{}'),
              ($4, $2, 'battery-commissioning', 1, $3, '2026-11-03', 'signed', '{}')`,
      [newId<'form-record'>(), north.id, battery, newId<'form-record'>()],
    )

    const { printed } = await papers(`/installations/${battery}/grid-completion`)

    expect(printed).toHaveLength(2)
    expect(printed[0]?.html).toContain('<th>Tag der Inbetriebsetzung</th><td>02.11.2026</td>')
    expect(printed[1]?.html).toContain('Inbetriebsetzungsprotokoll nach VDE-AR-N 4105')
    expect(printed.map((job) => job.html).join('')).not.toContain(
      'Inbetriebnahmeprotokoll Batteriespeicher',
    )
  })
})

describe('the funding programmes (#307)', () => {
  it('are kept by the owner and the office, and neither read nor kept by a technician', async () => {
    const id = await post('/funding-programs', programme)

    await http().get('/funding-programs').set('x-test-identity', technician()).expect(403)
    await http()
      .post('/funding-programs')
      .set('x-test-identity', technician())
      .send(programme)
      .expect(403)

    const listed = await http()
      .get('/funding-programs')
      .set('x-test-identity', office())
      .expect(200)
    expect((listed.body as { id: string; name: string }[]).map((entry) => entry.id)).toContain(id)

    await http().delete(`/funding-programs/${id}`).set('x-test-identity', office()).expect(200)
  })

  it('are refused as the template says, with the sentence for the office', async () => {
    for (const [body, sentence] of [
      [{ ...programme, name: ' ' }, 'Ein Förderprogramm braucht einen Namen.'],
      [{ ...programme, declaration: null }, 'Eine Fachunternehmererklärung braucht ihren Text.'],
      [
        { ...programme, declaration: 'Für {kunde}.' },
        'Den Platzhalter {kunde} kennt OpenGewerk nicht.',
      ],
      [
        { ...programme, kinds: ['heating'] },
        'Ein Förderprogramm gilt für eine PV-Anlage, einen Speicher oder eine Wallbox.',
      ],
      [
        {
          ...programme,
          evidence: [...programme.evidence, { source: 'invoice', label: 'Schlussrechnung' }],
        },
        'Rechnung steht nur einmal in der Liste; die Förderunterlagen legen sie einmal bei.',
      ],
    ] as const) {
      const answer = await http()
        .post('/funding-programs')
        .set('x-test-identity', office())
        .send(body)
        .expect(422)
      expect(refusal(answer)).toBe(sentence)
    }
  })

  it('keep the text of a declaration they ask for, whichever field a change sends', async () => {
    const id = await post('/funding-programs', programme)

    try {
      const answer = await http()
        .patch(`/funding-programs/${id}`)
        .set('x-test-identity', office())
        .send({ declaration: '' })
        .expect(422)
      expect(refusal(answer)).toBe('Eine Fachunternehmererklärung braucht ihren Text.')

      // Without the declaration among the proofs the text may go.
      await http()
        .patch(`/funding-programs/${id}`)
        .set('x-test-identity', office())
        .send({
          evidence: programme.evidence.filter((entry) => entry.source !== 'declaration'),
          declaration: '',
        })
        .expect(200)
      const { rows } = await admin.query('select declaration from funding_programs where id = $1', [
        id,
      ])
      expect(rows).toEqual([{ declaration: null }])
    } finally {
      await http().delete(`/funding-programs/${id}`).set('x-test-identity', office()).expect(200)
    }
  })

  it('keep of a proof only its source and its name', async () => {
    const id = await post('/funding-programs', {
      ...programme,
      evidence: [{ source: 'operator', label: '  Kontoauszug  ', note: 'nicht gespeichert' }],
      declaration: null,
    })

    try {
      const { rows } = await admin.query('select evidence from funding_programs where id = $1', [
        id,
      ])
      expect(rows).toEqual([{ evidence: [{ source: 'operator', label: 'Kontoauszug' }] }])
    } finally {
      await http().delete(`/funding-programs/${id}`).set('x-test-identity', office()).expect(200)
    }
  })

  it('are read, changed and deleted only in their own business, and deleted for real', async () => {
    const id = await post('/funding-programs', programme)

    await http().get(`/funding-programs/${id}`).set('x-test-identity', office(south.id)).expect(404)
    await http()
      .patch(`/funding-programs/${id}`)
      .set('x-test-identity', office(south.id))
      .send({ name: 'Fremd' })
      .expect(404)
    await http()
      .delete(`/funding-programs/${id}`)
      .set('x-test-identity', office(south.id))
      .expect(404)

    await http().delete(`/funding-programs/${id}`).set('x-test-identity', office()).expect(200)
    expect((await admin.query('select 1 from funding_programs where id = $1', [id])).rowCount).toBe(
      0,
    )
  })
})

describe('the papers of a funding programme at an installation (#307)', () => {
  let program = ''
  let invoice = ''

  beforeAll(async () => {
    program = await post('/funding-programs', programme)

    // The commissioning of the wallbox, signed, and a draft after it that counts not.
    await admin.query(
      `insert into form_records (id, tenant_id, definition_key, definition_version, installation_id, performed_on, status, values)
       values ($1, $2, 'vde-0100-722', 1, $3, '2026-11-02', 'signed', '{}'),
              ($4, $2, 'vde-0100-722', 1, $3, '2026-11-04', 'draft', '{}')`,
      [newId<'form-record'>(), north.id, wallbox, newId<'form-record'>()],
    )

    invoice = await issuableDraft(app, office(), customer, { installationId: wallbox })
    await http().post(`/documents/${invoice}/issue`).set('x-test-identity', office()).expect(201)
  })

  /** A file among those of the wallbox, in the store and in the tables. */
  async function filed(title: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    const blob = await store.put(bytes)
    const attachment = newId<'attachment'>()

    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [north.id, blob.sha256, bytes.length, mediaType],
    )
    await admin.query(
      'insert into attachments (id, tenant_id, title, installation_id) values ($1, $2, $3, $4)',
      [attachment, north.id, title, wallbox],
    )
    await admin.query(
      `insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
       values ($1, $2, $3, $4, $5, $6)`,
      [north.id, attachment, blob.sha256, `${title}.bin`, mediaType, bytes.length],
    )
  }

  it('list every proof with what lies in, what is missing and what the operator brings', async () => {
    const { printed } = await papers(`/installations/${wallbox}/funding/${program}`)
    const cover = printed[0]?.html ?? ''
    const { rows } = await admin.query<{ number: string }>(
      'select number from documents where id = $1',
      [invoice],
    )

    expect(cover).toContain('Förderunterlagen')
    expect(cover).toContain('Ladeinfrastruktur 2026, Stadtwerke Neckartal')
    expect(cover).toContain('<th>Bemessungsleistung</th><td>11 kW</td>')
    expect(cover).toMatch(
      new RegExp(
        `Rechnung mit einzeln ausgewiesenen Positionen</td><td class="state enclosed">liegt bei</td><td class="said">${rows[0]?.number ?? 'x'} vom 18\\.09\\.2026`,
      ),
    )
    expect(cover).toContain(
      'Inbetriebnahmeprotokoll der Ladeeinrichtung</td><td class="state enclosed">liegt bei</td><td class="said">unterschrieben am 02.11.2026',
    )
    expect(cover).toContain(
      'Foto der Wallbox mit Typenschild</td><td class="state missing">fehlt</td><td class="said">kein Foto unter den Dateien der Anlage',
    )
    expect(cover).toContain(
      'Kontoauszug mit allen Zahlungen</td><td class="state operator">bringt der Betreiber</td>',
    )
  })

  it('fill the declaration, list the serial numbers, bind the protocol, the photo and the invoice', async () => {
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )

    await filed('Wallbox mit Typenschild', png, 'image/png')
    await filed('Schaltplan', new TextEncoder().encode('%PDF-1.7 Plan'), 'application/pdf')

    const { pages, printed } = await papers(`/installations/${wallbox}/funding/${program}`)
    const titles = printed.map((job) => /<title>([^<]*)<\/title>/.exec(job.html)?.[1] ?? '')

    expect(titles.slice(0, 5)).toEqual([
      'Förderunterlagen, Wallbox Garage',
      'Fachunternehmererklärung, Wallbox Garage',
      'Seriennummern, Wallbox Garage',
      expect.stringContaining('Inbetriebnahmeprotokoll Ladeeinrichtung'),
      'Fotos, Wallbox Garage',
    ])
    expect(printed[0]?.html).toContain(
      'Foto der Wallbox mit Typenschild</td><td class="state enclosed">liegt bei</td><td class="said">1 Foto unter den Dateien der Anlage',
    )
    // The photo itself, and not the plan beside it.
    expect(printed[4]?.html).toContain(
      `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    )
    expect(printed[4]?.html).toContain('Wallbox mit Typenschild, Wallbox mit Typenschild.bin')
    expect(printed[4]?.html).not.toContain('Schaltplan')
    expect(printed[1]?.html).toContain(
      'dass Wallbox Garage, Mennekes Amtron 4Business mit der Seriennummer MA4B-2611-08812 bei Familie Weber am 02.11.2026 mit 11 kW in Betrieb ging.',
    )
    expect(printed[2]?.html).toContain(
      '<th>Wallbox Garage, Mennekes Amtron 4Business</th><td>MA4B-2611-08812</td>',
    )
    // Five pages printed for the papers, and the invoice as it went to the customer behind them.
    expect(pages).toBe(6)
  })

  it('lay in only what the programme asks for', async () => {
    const lean = await post('/funding-programs', {
      ...programme,
      name: 'Nur die Rechnung',
      evidence: [{ source: 'invoice', label: 'Rechnung' }],
      declaration: null,
    })

    try {
      const { pages, printed } = await papers(`/installations/${wallbox}/funding/${lean}`)

      expect(printed.map((job) => /<title>([^<]*)<\/title>/.exec(job.html)?.[1])).toEqual([
        'Förderunterlagen, Wallbox Garage',
      ])
      // The list, and the invoice behind it.
      expect(pages).toBe(2)
    } finally {
      await http().delete(`/funding-programs/${lean}`).set('x-test-identity', office()).expect(200)
    }
  })

  it('are put together by the owner and the office, not by a technician', async () => {
    await http()
      .get(`/installations/${wallbox}/funding/${program}`)
      .set('x-test-identity', technician())
      .expect(403)
  })

  it('are not for a programme of another kind, nor for an installation it is not for', async () => {
    const forBatteries = await post('/funding-programs', {
      ...programme,
      name: 'Nur Speicher',
      kinds: ['battery'],
    })

    try {
      await http()
        .get(`/installations/${wallbox}/funding/${forBatteries}`)
        .set('x-test-identity', office())
        .expect(404)
      await http()
        .get(`/installations/${meter}/funding/${program}`)
        .set('x-test-identity', office())
        .expect(404)
      await http()
        .get(`/installations/${wallbox}/funding/${program}`)
        .set('x-test-identity', office(south.id))
        .expect(404)
    } finally {
      await http()
        .delete(`/funding-programs/${forBatteries}`)
        .set('x-test-identity', office())
        .expect(200)
    }
  })
})
