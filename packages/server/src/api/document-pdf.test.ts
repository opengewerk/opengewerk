import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { type PrintJob, type Renderer, RendererUnavailableError } from '../documents/renderer.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, issuableDraft, readyToInvoice } from './test-invoice.js'

/**
 * The PDF of a document, with a renderer that is not Chromium.
 *
 * The stand in answers every job with different bytes, a counter inside a
 * PDF header. That is what makes the second of the four acceptance points
 * testable at all: if the same PDF comes back on the second request, it came
 * out of the store and not out of a second rendering, because a second
 * rendering would have said a different number.
 *
 * What the real renderer makes of the page is looked at by hand, against the
 * container, and not here: a test cannot say whether an address sits in the
 * window of an envelope.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let customerId: string

const jobs: PrintJob[] = []
let renderer: 'working' | 'missing' | 'slow' = 'working'

const standIn: Renderer = async (job) => {
  if (renderer === 'missing') {
    throw new RendererUnavailableError(
      'Der Renderer antwortet nicht. Läuft der Dienst? Gestartet wird er mit ' +
        '"docker compose --profile renderer up -d".',
    )
  }

  if (renderer === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  jobs.push(job)

  return new TextEncoder().encode(`%PDF-1.7 Probedruck ${String(jobs.length)}`)
}

const office = () => as(north.id, 'office')

function http() {
  return request(app.getHttpServer())
}

function pdfOf(documentId: string, identity = office()) {
  return http()
    .get(`/documents/${documentId}/pdf`)
    .set('x-test-identity', identity)
    .buffer(true)
    .parse(binary)
}

async function issued(fields: Record<string, unknown> = {}) {
  const id = await issuableDraft(app, office(), customerId, fields)

  await http().post(`/documents/${id}/issue`).set('x-test-identity', office()).expect(201)

  return id
}

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
  await readyToInvoice(admin, north.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-pdf-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        files: new FileStore(storageRoot),
        renderer: standIn,
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const created = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'private', name: 'Familie Berg', ...invoiceable })
    .expect(201)
  customerId = (created.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

beforeEach(() => {
  renderer = 'working'
})

describe('an issued invoice', () => {
  it('comes out as a PDF with its letterhead, its lines and its totals', async () => {
    const document = await issued()
    const answer = await pdfOf(document).expect(200)

    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(answer.headers['content-disposition']).toContain("filename*=UTF-8''Schlussrechnung")

    const job = jobs.at(-1)

    expect(job?.html).toContain('Elektro Nord GmbH')
    expect(job?.html).toContain('Familie Berg')
    expect(job?.html).toContain('Unterverteilung erneuert')
    expect(job?.html).toMatch(/Gesamtbetrag<\/td><td class="figure">1\.190,00\s€/)
    // The note section 14 (4) number 9 asks for, because the customer is private.
    expect(job?.html).toContain('§ 14b Abs. 1 Satz 5 UStG')
    expect(job?.footerHtml).toContain('Steuernummer 22/815/08154')
    expect(job?.footerHtml).toContain('class="pageNumber"')
  })

  it('comes back unchanged the second time, and is not printed again', async () => {
    const document = await issued()
    const first = await pdfOf(document).expect(200)
    const printed = jobs.length
    const second = await pdfOf(document).expect(200)

    expect(jobs.length).toBe(printed)
    expect(Buffer.compare(first.body as Buffer, second.body as Buffer)).toBe(0)
  })

  it('is printed from what it said when it was issued, not from a customer who moved since', async () => {
    const moving = await http()
      .post('/customers')
      .set('x-test-identity', office())
      .send({ kind: 'private', name: 'Familie Umzug', ...invoiceable })
      .expect(201)
    const movingId = (moving.body as { id: string }).id
    const document = await issuableDraft(app, office(), movingId)
    await http().post(`/documents/${document}/issue`).set('x-test-identity', office()).expect(201)

    await http()
      .patch(`/customers/${movingId}`)
      .set('x-test-identity', office())
      .send({ street: 'Invalidenstraße', postalCode: '10115', city: 'Berlin' })
      .expect(200)

    await pdfOf(document).expect(200)

    expect(jobs.at(-1)?.html).toContain('22301 Hamburg')
    expect(jobs.at(-1)?.html).not.toContain('Berlin')
  })

  it('is refused rather than handed out when the stored file was changed on disk', async () => {
    const document = await issued()
    const first = await pdfOf(document).expect(200)
    const hash = createHash('sha256')
      .update(first.body as Buffer)
      .digest('hex')

    writeFileSync(join(storageRoot, hash.slice(0, 2), hash.slice(2, 4), hash), 'verändert')

    const refused = await pdfOf(document).expect(500)

    expect(String(JSON.parse((refused.body as Buffer).toString()).message)).toContain('beschädigt')
  })

  it('ends up as one file when two people ask for it at the same moment', async () => {
    const document = await issued()
    renderer = 'slow'

    const [one, two] = await Promise.all([pdfOf(document), pdfOf(document)])

    expect(one.status).toBe(200)
    expect(two.status).toBe(200)
    expect(Buffer.compare(one.body as Buffer, two.body as Buffer)).toBe(0)

    const { rows } = await admin.query<{ count: string }>(
      "select count(*) from document_files where document_id = $1 and purpose = 'pdf'",
      [document],
    )

    expect(Number(rows[0]?.count)).toBe(1)
  })

  it('is not found from another business, which is the same answer as not there at all', async () => {
    const document = await issued()

    await pdfOf(document, as(south.id, 'office')).expect(404)
  })
})

describe('a draft', () => {
  it('is printed as a draft, every time, and never kept', async () => {
    const draft = await issuableDraft(app, office(), customerId)

    await pdfOf(draft).expect(200)
    expect(jobs.at(-1)?.html).toContain('Schlussrechnung (Entwurf)')
    expect(jobs.at(-1)?.html).toContain('<div class="draft">ENTWURF</div>')

    const printed = jobs.length
    await pdfOf(draft).expect(200)
    expect(jobs.length).toBe(printed + 1)

    const { rows } = await admin.query<{ count: string }>(
      'select count(*) from document_files where document_id = $1',
      [draft],
    )
    expect(Number(rows[0]?.count)).toBe(0)
  })
})

describe('without a renderer', () => {
  it('says which service is missing instead of failing, and the PDF follows once it is back', async () => {
    // Issuing does not need the renderer. That is why the PDF is printed on
    // the first request and not in the issuing transaction.
    const document = await issued()
    renderer = 'missing'

    const refused = await pdfOf(document).expect(503)
    const body = JSON.parse((refused.body as Buffer).toString()) as { message: string }

    expect(body.message).toContain('--profile renderer')

    renderer = 'working'
    await pdfOf(document).expect(200)
  })
})

describe('a logo on the letterhead', () => {
  it('travels into the page as data, so the renderer has nothing to fetch', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )

    await http()
      .put('/settings/letterhead/logo')
      .set('x-test-identity', as(north.id, 'owner'))
      .set('content-type', 'image/png')
      .send(png)
      .expect(200)

    const document = await issued()
    await pdfOf(document).expect(200)

    expect(jobs.at(-1)?.html).toContain(`src="data:image/png;base64,${png.toString('base64')}"`)
  })
})
