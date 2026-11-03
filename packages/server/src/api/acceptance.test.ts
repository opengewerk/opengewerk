import { PDFDocument } from '@cantoo/pdf-lib'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { Database, newId, type PrintJob, type Renderer } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { todayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { created, push as pushVia } from './test-structure.js'

/**
 * The acceptance of a job (#310): the terms of the job, the protocol as a
 * form of the job alone, its PDF with the warranty it starts, and the request
 * to accept within a deadline, with the notice a consumer is owed.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const jobs: PrintJob[] = []
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

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

async function printed(path: string, who = office()) {
  jobs.length = 0
  await http().get(path).set('x-test-identity', who).buffer(true).parse(binary).expect(200)

  return [...jobs]
}

/** A signed acceptance as the database holds it, the way a device leaves it. */
async function signedAcceptance(jobId: string, on: string, values: Record<string, unknown>) {
  const id = newId<'form-record'>()

  await admin.query(
    `insert into form_records (id, tenant_id, definition_key, definition_version, job_id, performed_on, status, values)
     values ($1, $2, 'acceptance', 1, $3, $4, 'signed', $5)`,
    [id, north.id, jobId, on, JSON.stringify(values)],
  )

  return id
}

let privateCustomer = ''
let businessCustomer = ''
let home = ''
let job = ''
let serviceJob = ''

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

  privateCustomer = await post('/customers', {
    kind: 'private',
    name: 'Familie Weber',
    street: 'Birkenweg',
    houseNumber: '7',
    postalCode: '69214',
    city: 'Eppelheim',
  })
  businessCustomer = await post('/customers', { kind: 'business', name: 'Hausverwaltung Süd GmbH' })
  home = await post('/sites', { customerId: privateCustomer, designation: 'Wohnhaus' })
  job = await post('/jobs', {
    customerId: privateCustomer,
    siteId: home,
    kind: 'project',
    designation: 'Wallbox Garage montieren',
  })
  serviceJob = await post('/jobs', {
    customerId: businessCustomer,
    kind: 'service',
    designation: 'Störung Treppenhauslicht',
  })
})

beforeEach(() => {
  jobs.length = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the terms of a job (#310)', () => {
  it('keep whether the VOB/B is agreed and whether the work is a building, undecided at first', async () => {
    const { rows: before } = await admin.query(
      'select vob_agreed, building_work from jobs where id = $1',
      [job],
    )
    expect(before).toEqual([{ vob_agreed: false, building_work: null }])

    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', office())
      .send({ vobAgreed: true, buildingWork: true })
      .expect(200)

    const { rows } = await admin.query('select vob_agreed, building_work from jobs where id = $1', [
      job,
    ])
    expect(rows).toEqual([{ vob_agreed: true, building_work: true }])

    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', office())
      .send({ vobAgreed: false })
      .expect(200)
  })

  it('are a yes or a no, at the route and in the sync', async () => {
    const atRoute = await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', office())
      .send({ buildingWork: 'ja' })
      .expect(422)
    expect(refusal(atRoute)).toBe(
      'Ob die Leistung ein Bauwerk ist, heißt ja, nein oder noch offen.',
    )

    const pushed = await pushVia(
      app,
      office(),
      [
        created('jobs', newId<'job'>(), {
          customerId: privateCustomer,
          kind: 'service',
          designation: 'Mit falscher VOB',
          vobAgreed: 'nein',
        }),
      ],
      400,
    )
    expect(pushed.message).toContain('Ob die VOB/B vereinbart ist, heißt ja oder nein.')
  })
})

describe('the acceptance as a form of the job alone (#310)', () => {
  const draft = (over: Record<string, unknown>) =>
    created('form_records', newId<'form-record'>(), {
      definitionKey: 'acceptance',
      definitionVersion: 1,
      performedOn: '2026-11-05',
      status: 'draft',
      values: JSON.stringify({ result: 'accepted' }),
      installationId: null,
      applianceId: null,
      ...over,
    })

  it('hangs on a job and on nothing else', async () => {
    const taken = await pushVia(app, office(), [draft({ jobId: job })])
    expect(taken.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const installation = await post('/installations', {
      siteId: home,
      kind: 'wallbox',
      designation: 'Wallbox Garage',
    })
    const refused = await pushVia(
      app,
      office(),
      [draft({ jobId: job, installationId: installation })],
      400,
    )
    expect(refused.message).toContain('Dieses Formular gehört an einen Auftrag.')
  })

  it('lets no form of an installation hang on a job alone', async () => {
    const refused = await pushVia(
      app,
      office(),
      [draft({ jobId: job, definitionKey: 'vde-0105-100', values: '{}' })],
      400,
    )
    expect(refused.message).toContain('Dieses Formular gehört an eine Anlage.')
  })

  it('is refused by the database without any subject', async () => {
    await expect(
      admin.query(
        `insert into form_records (tenant_id, definition_key, definition_version, performed_on, values)
         values ($1, 'acceptance', 1, '2026-11-05', '{}')`,
        [north.id],
      ),
    ).rejects.toThrow('form_records_one_subject')
  })

  it('changes no more once it is signed', async () => {
    const id = await signedAcceptance(job, '2026-11-05', { result: 'accepted' })

    await expect(
      admin.query(`update form_records set values = '{"result":"refused"}' where id = $1`, [id]),
    ).rejects.toThrow()
  })
})

describe('the PDF of an acceptance (#310)', () => {
  it('names the job and the warranty that runs from it', async () => {
    const id = await signedAcceptance(serviceJob, '2026-11-05', {
      result: 'accepted_with_reservations',
      building_work: true,
      vob_agreed: true,
      maintenance_transferred: false,
      reservations: 'Abdeckung verkratzt',
    })
    const [page] = await printed(`/form-records/${id}/pdf`)

    expect(page?.html).toContain('<h1>Abnahmeprotokoll</h1>')
    expect(page?.html).toContain('Störung Treppenhauslicht')
    expect(page?.html).toContain('Abgenommen am 05.11.2026')
    expect(page?.html).toContain(
      'Gewährleistung bis 05.11.2030: vier Jahre ab der Abnahme (§ 13 Abs. 4 Nr. 1 Satz 1 VOB/B).',
    )
    expect(page?.html).toContain(
      'Für wartungsbedürftige Teile ohne übertragene Wartung bis 05.11.2028: zwei Jahre (§ 13 Abs. 4 Nr. 2 VOB/B).',
    )
  })

  it('says that a refused acceptance starts no warranty', async () => {
    const id = await signedAcceptance(serviceJob, '2026-11-06', { result: 'refused' })
    const [page] = await printed(`/form-records/${id}/pdf`)

    expect(page?.html).toContain('Abnahme verweigert: die Gewährleistung beginnt nicht.')
    expect(page?.html).not.toContain('Gewährleistung bis')
  })
})

describe('the request to accept a job (#310)', () => {
  const until = '2099-11-19'

  it('sets the deadline and tells a consumer the consequences of letting it pass', async () => {
    const [page] = await printed(`/jobs/${job}/acceptance-request?until=${until}`)

    expect(page?.html).toContain('Aufforderung zur Abnahme')
    expect(page?.html).toContain('Wir bitten Sie, sie bis zum 19.11.2099 abzunehmen.')
    expect(page?.html).toContain(
      'Die Leistung gilt als abgenommen, wenn Sie die Abnahme nicht bis zum 19.11.2099 unter Angabe mindestens eines Mangels verweigern',
    )
    expect(page?.html).toContain('Hinweis nach § 640 Abs. 2 Satz 2 BGB')
    expect(page?.html).toContain('die Vergütung wird fällig (§ 641 Abs. 1 BGB)')
    expect(page?.landscape).toBe(false)
  })

  it('leaves the notice out for a business, which the law does not owe it', async () => {
    const [page] = await printed(`/jobs/${serviceJob}/acceptance-request?until=${until}`)

    expect(page?.html).toContain('Die Leistung gilt als abgenommen')
    expect(page?.html).not.toContain('Hinweis nach § 640 Abs. 2 Satz 2 BGB')
  })

  it('needs a day from today on, and a job of its own business', async () => {
    for (const day of ['', '2026-02-30', '2020-01-01']) {
      const answer = await http()
        .get(`/jobs/${job}/acceptance-request?until=${day}`)
        .set('x-test-identity', office())
        .expect(422)
      expect(refusal(answer)).toBe('Die Frist zur Abnahme ist ein Tag, heute oder später.')
    }

    await http()
      .get(`/jobs/${job}/acceptance-request?until=${todayInGermany()}`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)
    await http()
      .get(`/jobs/${job}/acceptance-request?until=${until}`)
      .set('x-test-identity', office(south.id))
      .expect(404)
  })
})
