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
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { boardOf, created, deleted, installationOf, push } from './test-structure.js'

/**
 * The circuit chart, with a renderer that is not Chromium: it keeps the page
 * it was handed and answers with fixed bytes. What the page looks like on
 * paper is looked at against the real renderer by hand; what is on it, and in
 * which order, is looked at here.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let installationId: string
let southInstallationId: string

const jobs: PrintJob[] = []
let renderer: 'working' | 'missing' = 'working'

const standIn: Renderer = async (job) => {
  if (renderer === 'missing') {
    throw new RendererUnavailableError('Der Renderer antwortet nicht.')
  }

  jobs.push(job)

  return new TextEncoder().encode('%PDF-1.7 Stromkreisverzeichnis')
}

const office = () => as(north.id, 'office')

function chartOf(id: string, query = '', who = office()) {
  return request(app.getHttpServer())
    .get(`/installations/${id}/circuit-chart${query}`)
    .set('x-test-identity', who)
    .buffer(true)
    .parse(binary)
}

/** The page the renderer was last handed. */
function lastPage(): string {
  const job = jobs.at(-1)

  if (!job) {
    throw new Error('Nothing was printed')
  }

  return job.html
}

/** The page as text, the way a reader goes through it, without the markup. */
function words(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let kitchen: { boardId: string; sectionId: string }
let hall: { boardId: string; sectionId: string }

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
    imports: [ApiModule.create(database, identities, { renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  installationId = await installationOf(app, north.id)
  southInstallationId = await installationOf(app, south.id)

  // Two boards: the kitchen one with a section, the hall one without any.
  kitchen = await boardOf(app, north.id, installationId, 'UV Küche')
  const hallBoard = newId<'distribution-board'>()
  await push(app, office(), [
    created('distribution_boards', hallBoard, {
      installationId,
      kind: 'main_distribution',
      designation: 'HV',
      location: 'Keller, Raum 2',
      position: -1,
    }),
  ])
  hall = { boardId: hallBoard, sectionId: '' }

  await push(app, office(), [
    created('circuits', newId<'circuit'>(), {
      distributionBoardId: kitchen.boardId,
      boardSectionId: kitchen.sectionId,
      designation: 'F10',
      consumer: 'Geschirrspüler',
      position: 0,
    }),
    created('circuits', newId<'circuit'>(), {
      distributionBoardId: kitchen.boardId,
      boardSectionId: kitchen.sectionId,
      designation: 'F2',
      consumer: 'Steckdosen Küche',
      overcurrentDevice: 'circuit_breaker',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      rcdType: 'a',
      ratedResidualCurrentMilli: 30,
      cableType: 'NYM-J',
      cableCores: 3,
      cableCrossSectionMilli: 2_500,
      cableLengthMilli: 18_500,
      cableInstallationMethod: 'c',
      position: 0,
    }),
    created('circuits', newId<'circuit'>(), {
      distributionBoardId: kitchen.boardId,
      designation: 'F1',
      consumer: 'Herd <script>alert(1)</script>',
      overcurrentDevice: 'fuse_d0',
      tripCharacteristic: 'gg',
      ratedCurrentMilli: 16_000,
      position: 0,
    }),
    created('circuits', newId<'circuit'>(), {
      distributionBoardId: hall.boardId,
      designation: 'Q1',
      consumer: 'Zuleitung UV Küche',
      position: 0,
    }),
  ])
})

beforeEach(() => {
  renderer = 'working'
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the circuit chart of an installation', () => {
  it('prints every board in its order, on its side, one to a page', async () => {
    const answer = await chartOf(installationId).expect(200)

    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(jobs.at(-1)?.landscape).toBe(true)

    const text = words(lastPage())
    // The main distribution first, because somebody put it there.
    expect(text.indexOf('Hauptverteilung HV')).toBeLessThan(
      text.indexOf('Unterverteilung UV Küche'),
    )
    expect(text).toContain('Keller, Raum 2')
    expect(lastPage().match(/class="board"/g)).toHaveLength(2)
  })

  it('lists the circuits the way the board counts them, sections as headings', async () => {
    await chartOf(installationId, `?board=${kitchen.boardId}`).expect(200)
    const text = words(lastPage())

    // The circuit on the board itself first, under a heading of its own so
    // that nobody reads it as part of the first section, then the section,
    // and in it F2 before F10.
    expect(text).toMatch(/Ohne Feld F1 .* Feld 1 F2 .* F10/)
  })

  it('writes the figures of a circuit the way they are written on a board', async () => {
    await chartOf(installationId, `?board=${kitchen.boardId}`).expect(200)
    const text = words(lastPage())

    expect(text).toContain('F2 Steckdosen Küche LS B 16 A Typ A 30 mA NYM-J 3 × 2,5 mm² 18,5 m C')
    expect(text).toContain('D0 gG 16 A')
  })

  it('escapes whatever somebody typed into a circuit', async () => {
    await chartOf(installationId, `?board=${kitchen.boardId}`).expect(200)

    expect(lastPage()).not.toContain('<script>')
    expect(lastPage()).toContain('Herd &lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('narrows to the one board whose door it is for, and says so in the file name', async () => {
    const answer = await chartOf(installationId, `?board=${hall.boardId}`).expect(200)

    expect(lastPage().match(/class="board"/g)).toHaveLength(1)
    expect(words(lastPage())).toContain('Q1 Zuleitung UV Küche')
    expect(answer.headers['content-disposition']).toContain(
      encodeURIComponent('Stromkreisverzeichnis HV.pdf'),
    )
  })

  it('says who keeps it and how current it is', async () => {
    await chartOf(installationId, `?board=${hall.boardId}`).expect(200)
    const text = words(lastPage())

    expect(text).toContain('Elektro Nord GmbH')
    expect(text).toMatch(/Stand \d{2}\.\d{2}\.\d{4}/)

    await admin.query(
      `insert into letterheads (tenant_id, company_name, phone)
       values ($1, 'Elektro Nord Inhaber Max Beispiel e. K.', '06203 123456')`,
      [north.id],
    )

    await chartOf(installationId, `?board=${hall.boardId}`).expect(200)
    expect(words(lastPage())).toContain(
      'Elektro Nord Inhaber Max Beispiel e. K. Telefon 06203 123456',
    )
  })

  it('leaves out what is marked as deleted', async () => {
    const gone = newId<'circuit'>()
    await push(app, office(), [
      created('circuits', gone, {
        distributionBoardId: hall.boardId,
        designation: 'Q9 entfernt',
        position: 9,
      }),
    ])
    await push(app, office(), [deleted('circuits', gone)])

    await chartOf(installationId, `?board=${hall.boardId}`).expect(200)
    expect(lastPage()).not.toContain('Q9 entfernt')

    const board = await boardOf(app, north.id, installationId, 'UV abgebaut')
    await push(app, office(), [deleted('distribution_boards', board.boardId)])

    await chartOf(installationId).expect(200)
    expect(lastPage()).not.toContain('UV abgebaut')
    await chartOf(installationId, `?board=${board.boardId}`).expect(404)
  })

  it('says a board without circuits has none, rather than printing an empty table', async () => {
    const empty = await boardOf(app, north.id, installationId, 'UV Garage')

    await chartOf(installationId, `?board=${empty.boardId}`).expect(200)
    expect(words(lastPage())).toContain('Für diesen Verteiler ist noch kein Stromkreis erfasst.')
  })

  it('is there for a technician too, who reads the structure on site', async () => {
    await chartOf(installationId, '', as(north.id, 'technician')).expect(200)
  })
})

describe('a circuit chart that does not exist', () => {
  it('is not found for an installation of another business, nor for its boards', async () => {
    const southBoard = await boardOf(app, south.id, southInstallationId)

    await chartOf(southInstallationId).expect(404)
    // Under this business's own installation, the other board is not one of its.
    await chartOf(installationId, `?board=${southBoard.boardId}`).expect(404)
  })

  it('is not found for an id that is none', async () => {
    await chartOf('kein-verteiler').expect(404)
    await chartOf(installationId, '?board=kein-verteiler').expect(404)
  })
})

describe('without a renderer', () => {
  it('says which service is missing instead of failing', async () => {
    renderer = 'missing'

    const answer = await chartOf(installationId).expect(503)
    const body = JSON.parse((answer.body as Buffer).toString()) as { message: string }

    expect(body.message).toBe('Der Renderer antwortet nicht.')
  })
})
