import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  isLabelCode,
  labelAddress,
  printedLabelCode,
  type InstallationLabelId,
  type RoleKey,
  type TenantId,
} from '@opengewerk/domain'
import { Database, newId, type PrintJob, type Renderer } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { installationLabels } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  checkViolation,
  connect,
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import { qrSvg } from '../labels/label-print.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { created, push } from './test-structure.js'

/**
 * The QR labels of the installations (#308): made and blocked in the office,
 * printed as a PDF, read by a device through the sync.
 *
 * Two businesses on the instance, because a label is an address anybody can
 * type, and the one thing it must never do is open an installation of another
 * business. The renderer is a stand-in that keeps the page it was handed:
 * what is on the label is tested here, how it looks against the real renderer.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }
const origin = 'https://msk.opengewerk.de'

let admin: Pool
let database: Database
let app: INestApplication

const jobs: PrintJob[] = []
const standIn: Renderer = async (job) => {
  jobs.push(job)

  return new Uint8Array([37, 80, 68, 70])
}

/**
 * Somebody of the first business with a user of their own. `as` gives every
 * test the same user, and a device holds whatever its person created, so a
 * question about the share of a device needs a person who created nothing.
 */
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

async function installationOf(tenantId: TenantId, designation: string) {
  const who = as(tenantId, 'office')
  const customer = await post(
    '/customers',
    { kind: 'business', name: 'Hausverwaltung Süd GmbH' },
    who,
  )
  const site = await post(
    '/sites',
    {
      customerId: customer,
      designation: 'Rheinstraße 12',
      street: 'Rheinstraße',
      houseNumber: '12',
      postalCode: '68159',
      city: 'Mannheim',
    },
    who,
  )

  return post('/installations', { siteId: site, kind: 'meter_cabinet', designation }, who)
}

interface Label {
  readonly id: string
  readonly installationId: string
  readonly code: string
  readonly blockedAt: string | null
}

async function makeLabel(installationId: string, who = as(north.id, 'office')) {
  const answer = await http()
    .post(`/installations/${installationId}/labels`)
    .set('x-test-identity', who)
    .expect(201)

  return answer.body as Label
}

function block(installationId: string, id: string, who = as(north.id, 'office')) {
  return http()
    .post(`/installations/${installationId}/labels/${id}/block`)
    .set('x-test-identity', who)
}

function pdf(installationId: string, id: string, query = '', who = as(north.id, 'office')) {
  return http()
    .get(`/installations/${installationId}/labels/${id}/pdf${query}`)
    .set('x-test-identity', who)
}

interface Pulled {
  readonly changes: { entity: string; rows: Record<string, unknown>[] }[]
}

async function pulledLabels(who: string) {
  const answer = await http().get('/sync?since=0').set('x-test-identity', who).expect(200)

  return (
    (answer.body as Pulled).changes.find((change) => change.entity === 'installation_labels')
      ?.rows ?? []
  )
}

let cabinet = ''
let other = ''

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

  for (const [userId, role] of [
    ['britta', 'office'],
    ['max', 'technician'],
  ] as const) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      userId,
      `${userId}@example.de`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      north.id,
      userId,
      [role],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, { renderer: standIn, trustedOrigins: [origin] }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  cabinet = await installationOf(north.id, 'Zählerschrank, Keller')
  other = await installationOf(south.id, 'Zählerschrank, Süd')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

beforeEach(() => {
  jobs.length = 0
})

describe('a label made in the office', () => {
  it('carries a random code of its own, not the id of the installation', async () => {
    const installation = await installationOf(north.id, 'UV Treppenhaus')
    const label = await makeLabel(installation)

    expect(label.installationId).toBe(installation)
    expect(isLabelCode(label.code)).toBe(true)
    expect(label.code).not.toContain(installation.replaceAll('-', '').toUpperCase().slice(0, 8))
    expect(label.blockedAt).toBeNull()
  })

  it('is the only valid one of its installation until it is blocked', async () => {
    const installation = await installationOf(north.id, 'HV Halle')
    const first = await makeLabel(installation)

    const second = await http()
      .post(`/installations/${installation}/labels`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(409)
    expect((second.body as { message: string }).message).toBe(
      'Diese Anlage hat schon ein gültiges Etikett. Erst sperren, dann ein neues anlegen.',
    )

    const blocked = await block(installation, first.id).expect(201)
    expect((blocked.body as Label).blockedAt).not.toBeNull()

    const next = await makeLabel(installation)
    expect(next.code).not.toBe(first.code)
  })

  it('stays blocked: blocking again changes nothing, and the database takes no unblocking', async () => {
    const installation = await installationOf(north.id, 'UV Garage')
    const label = await makeLabel(installation)
    const first = (await block(installation, label.id).expect(201)).body as Label
    const again = (await block(installation, label.id).expect(201)).body as Label

    expect(again.blockedAt).toBe(first.blockedAt)

    const refused = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx
          .update(installationLabels)
          .set({ blockedAt: null })
          .where(eq(installationLabels.id, label.id as InstallationLabelId)),
      ),
    )
    expect(refused.code).toBe(checkViolation)
  })

  it('goes with its installation when that is deleted', async () => {
    const installation = await installationOf(north.id, 'UV Keller')
    const label = await makeLabel(installation)

    await http()
      .delete(`/installations/${installation}`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(200)

    const { rows } = await admin.query<{ deleted_at: Date | null }>(
      'select deleted_at from installation_labels where id = $1',
      [label.id],
    )
    expect(rows[0]?.deleted_at).not.toBeNull()
  })

  it('is made and blocked by whoever may change the installation, and by nobody else', async () => {
    const technician = as(north.id, 'technician')
    const label = await makeLabel(cabinet, technician)

    await block(cabinet, label.id, technician).expect(201)
    await http()
      .post(`/installations/${cabinet}/labels`)
      .set('x-test-identity', as(north.id))
      .expect(403)
    await block(cabinet, label.id, as(north.id)).expect(403)
  })
})

describe('a label as a PDF', () => {
  it('prints one label to a page of 62 by 29 mm, with the business, the installation, the site and the code', async () => {
    const installation = await installationOf(north.id, 'Zählerschrank, Dachboden')
    const label = await makeLabel(installation)

    const answer = await pdf(installation, label.id, '?count=2').expect(200)
    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['cache-control']).toBe('no-store')

    const job = jobs.at(-1)
    expect(job?.size).toEqual({ width: '62mm', height: '29mm' })
    expect(job?.html.match(/class="page"/g)).toHaveLength(2)
    expect(job?.html).toContain('Elektro Kohm GmbH')
    expect(job?.html).toContain('Zählerschrank, Dachboden')
    expect(job?.html).toContain('Rheinstraße 12')
    expect(job?.html).toContain(printedLabelCode(label.code))
  })

  it('puts the address of the instance with the code of the label into the QR, and nothing else', async () => {
    const installation = await installationOf(north.id, 'Wechselrichter, Dach')
    const label = await makeLabel(installation)

    await pdf(installation, label.id).expect(200)

    expect(jobs.at(-1)?.html).toContain(qrSvg(labelAddress(origin, label.code), 25))
    expect(jobs.at(-1)?.html).not.toContain(installation)
  })

  it('fills a sheet from the first free field and goes on at the top of the next', async () => {
    const installation = await installationOf(north.id, 'UV Werkstatt')
    const label = await makeLabel(installation)

    await pdf(installation, label.id, '?format=sheet&count=3&start=5').expect(200)
    const one = jobs.at(-1)
    expect(one?.size).toBeUndefined()
    expect(one?.html.match(/class="page sheet"/g)).toHaveLength(1)
    expect(one?.html.match(/<div><\/div>/g)).toHaveLength(4)
    expect(one?.html.match(/class="label"/g)).toHaveLength(3)

    await pdf(installation, label.id, '?format=sheet&count=24&start=5').expect(200)
    const two = jobs.at(-1)
    expect(two?.html.match(/class="page sheet"/g)).toHaveLength(2)
    expect(two?.html.match(/class="label"/g)).toHaveLength(24)
  })

  it('says what is wrong with a print it cannot make', async () => {
    const installation = await installationOf(north.id, 'UV Lager')
    const label = await makeLabel(installation)

    await pdf(installation, label.id, '?format=karton').expect(400)
    const none = await pdf(installation, label.id, '?count=0').expect(422)
    expect((none.body as { message: string }).message).toBe(
      'Gedruckt werden 1 bis 24 Etiketten auf einmal.',
    )
    const field = await pdf(installation, label.id, '?format=sheet&start=25').expect(422)
    expect((field.body as { message: string }).message).toBe('Ein Bogen hat die Felder 1 bis 24.')
    await pdf(installation, label.id, '?count=zwei').expect(422)
  })

  it('prints no label that is blocked', async () => {
    const installation = await installationOf(north.id, 'UV Büro')
    const label = await makeLabel(installation)
    await block(installation, label.id).expect(201)

    const answer = await pdf(installation, label.id).expect(409)
    expect((answer.body as { message: string }).message).toBe(
      'Ein gesperrtes Etikett wird nicht mehr gedruckt.',
    )
    expect(jobs).toHaveLength(0)
  })
})

describe('a label and the other business', () => {
  it('opens only an installation of its own business: another business finds neither the label nor the installation', async () => {
    const theirs = await makeLabel(other, as(south.id, 'office'))

    await pdf(other, theirs.id).expect(404)
    await pdf(cabinet, theirs.id).expect(404)
    await block(other, theirs.id).expect(404)
    await http()
      .post(`/installations/${other}/labels`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(404)

    const pulled = await pulledLabels(as(north.id, 'office'))
    expect(pulled.map((row) => row['code'])).not.toContain(theirs.code)
    expect(pulled.every((row) => row['tenantId'] === north.id)).toBe(true)
  })

  it('reaches a device with the installations it holds and no other', async () => {
    const office = person('britta', 'office')
    const technician = person('max', 'technician')
    const installation = await installationOf(north.id, 'Zählerschrank, Nebengebäude')
    const label = await makeLabel(installation, office)

    // A technician on no job holds no installation, and so no label.
    expect((await pulledLabels(technician)).map((row) => row['id'])).not.toContain(label.id)
    expect((await pulledLabels(office)).map((row) => row['id'])).toContain(label.id)

    // On a job at the installation the technician holds it, and its label.
    const [row] = (
      await admin.query<{ customer_id: string; site_id: string }>(
        'select s.customer_id, s.id as site_id from installations i join sites s on s.id = i.site_id where i.id = $1',
        [installation],
      )
    ).rows
    const job = await post(
      '/jobs',
      {
        customerId: row?.customer_id,
        siteId: row?.site_id,
        installationId: installation,
        kind: 'service',
        status: 'active',
        designation: 'Zähler tauschen',
      },
      office,
    )
    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office)
      .send({ userIds: ['max'] })
      .expect(200)

    const theirs = await pulledLabels(technician)
    expect(theirs.map((row) => row['id'])).toEqual([label.id])
  })

  it('is written by no device: the server draws the code', async () => {
    const answer = await push(app, as(north.id, 'office'), [
      created('installation_labels', newId<'installation-label'>(), {
        installationId: cabinet,
        code: '7K2M9QX4TBA3HW8P',
      }),
    ])

    expect(answer.receipts[0]?.outcome).toBe('conflict')
    expect(answer.receipts[0]?.reason).toBe('online_only')
  })
})
