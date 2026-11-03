import { createHash } from 'node:crypto'
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { changed, created, deleted, push as pushVia } from './test-structure.js'

/**
 * Defects and complaints (#311): recorded on a device with their photos, the
 * steps they take with who took them and when, what may still change about
 * them, the defects a signed acceptance writes out of its reservations, the
 * business they belong to, and the report of a job.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot = ''

const printed: PrintJob[] = []
const standIn: Renderer = async (job) => {
  printed.push(job)

  const pdf = await PDFDocument.create()

  pdf.addPage()

  return pdf.save()
}

const office = (tenant: TenantId = north.id) => as(tenant, 'office')
const technician = (tenant: TenantId = north.id) => as(tenant, 'technician')

/** A tiny PNG, a photo of a defect as far as the store is concerned. */
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const signature = 'M10,20L30,40L35,42'

function http() {
  return request(app.getHttpServer())
}

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

function aDefect(fields: Record<string, unknown>) {
  const id = newId<'defect'>()

  return {
    id,
    operation: created('defects', id, {
      jobId: job,
      installationId: wallbox,
      description: 'Halter des Ladekabels locker, ein Dübel ausgerissen.',
      reportedAt: '2026-11-10T09:42:00.000Z',
      ...fields,
    }),
  }
}

function aStep(
  defectId: string,
  step: string,
  signer: { name: string; path: string } | null = null,
) {
  return created('defect_steps', newId<'defect-step'>(), {
    defectId,
    step,
    takenAt: new Date().toISOString(),
    ...(signer ? { signerName: signer.name, signaturePath: signer.path } : {}),
  })
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await admin.query<{ status: string }>(
    'select status from defects where id = $1',
    [id],
  )

  return String(rows[0]?.status)
}

let customer = ''
let home = ''
let wallbox = ''
let job = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-defects-'))
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

  customer = await post('/customers', { kind: 'private', name: 'Familie Weber' })
  home = await post('/sites', { customerId: customer, designation: 'Wohnhaus' })
  wallbox = await post('/installations', {
    siteId: home,
    kind: 'wallbox',
    designation: 'Wallbox Garage',
  })
  job = await post('/jobs', {
    customerId: customer,
    siteId: home,
    installationId: wallbox,
    kind: 'project',
    designation: 'Wallbox Garage montieren',
  })
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('a defect recorded on a device (#311)', () => {
  it('goes out with the sync together with its photo, reported by whoever sent it', async () => {
    await http()
      .put(`/files/${hashOf(photo)}`)
      .set('x-test-identity', technician())
      .set('Content-Type', 'application/octet-stream')
      .set('X-Media-Type', 'image/png')
      .send(photo)
      .expect(200)

    const defect = aDefect({})
    const attachment = newId<'attachment'>()
    const sent = await pushVia(app, technician(), [
      defect.operation,
      created('attachments', attachment, { jobId: job, defectId: defect.id, title: 'Halter' }),
      created('attachment_versions', newId<'attachment-version'>(), {
        attachmentId: attachment,
        sha256: hashOf(photo),
        fileName: 'halter.png',
        mediaType: 'image/png',
        sizeBytes: photo.byteLength,
      }),
    ])

    expect(sent.receipts.map((receipt) => receipt.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
    ])

    const { rows } = await admin.query(
      `select d.status, d.created_by, d.job_id, d.installation_id, a.defect_id
         from defects d join attachments a on a.defect_id = d.id where d.id = $1`,
      [defect.id],
    )

    expect(rows).toEqual([
      {
        status: 'reported',
        created_by: 'test',
        job_id: job,
        installation_id: wallbox,
        defect_id: defect.id,
      },
    ])
  })

  it('says what is wrong and hangs on a job or an installation', async () => {
    const empty = await pushVia(app, technician(), [aDefect({ description: ' ' }).operation], 400)
    expect(empty.message).toContain('Ein Mangel braucht eine Beschreibung.')

    const nowhere = await pushVia(
      app,
      technician(),
      [aDefect({ jobId: null, installationId: null }).operation],
      400,
    )
    expect(nowhere.message).toContain('Ein Mangel hängt an einem Auftrag oder an einer Anlage.')

    const badDay = await pushVia(
      app,
      technician(),
      [aDefect({ remedyDueOn: '30.02.2027' }).operation],
      400,
    )
    expect(badDay.message).toContain('Die Frist des Kunden ist ein Tag')
  })

  it('keeps its photo among the files of its job or installation', async () => {
    const defect = aDefect({})
    await pushVia(app, technician(), [defect.operation])

    const elsewhere = await pushVia(
      app,
      office(),
      [
        created('attachments', newId<'attachment'>(), {
          customerId: customer,
          defectId: defect.id,
          title: 'Foto',
        }),
      ],
      409,
    )

    expect(elsewhere.message).toBe(
      'Ein Foto eines Mangels liegt bei den Dateien seines Auftrags oder seiner Anlage.',
    )
  })

  it('belongs to the business it was recorded in', async () => {
    const defect = aDefect({})
    await pushVia(app, technician(), [defect.operation])

    const pulled = async (who: string) => {
      const answer = await http().get('/sync?since=0').set('x-test-identity', who).expect(200)
      const changes = (answer.body as { changes: { entity: string; rows: { id: string }[] }[] })
        .changes

      return changes.find((change) => change.entity === 'defects')?.rows.map((row) => row.id) ?? []
    }

    expect(await pulled(office())).toContain(defect.id)
    expect(await pulled(office(south.id))).not.toContain(defect.id)

    // And a step from the other business finds no defect to take it on.
    const across = await pushVia(app, technician(south.id), [aStep(defect.id, 'in_progress')])
    expect(across.receipts.map((receipt) => [receipt.outcome, receipt.reason])).toEqual([
      ['conflict', 'record_missing'],
    ])
    expect(await statusOf(defect.id)).toBe('reported')
  })
})

describe('the steps of a defect (#311)', () => {
  it('follow one another, each with who took it and when, in progress may be skipped', async () => {
    const defect = aDefect({})
    await pushVia(app, technician(), [defect.operation])

    await pushVia(app, technician(), [aStep(defect.id, 'resolved')])
    expect(await statusOf(defect.id)).toBe('resolved')

    // The remedy did not hold.
    await pushVia(app, technician(), [aStep(defect.id, 'in_progress')])
    expect(await statusOf(defect.id)).toBe('in_progress')

    const { rows } = await admin.query(
      'select step, created_by from defect_steps where defect_id = $1 order by taken_at, id',
      [defect.id],
    )
    expect(rows).toEqual([
      { step: 'resolved', created_by: 'test' },
      { step: 'in_progress', created_by: 'test' },
    ])
  })

  it('are refused where they do not follow', async () => {
    const defect = aDefect({})
    await pushVia(app, technician(), [defect.operation])

    const accepted = await pushVia(
      app,
      technician(),
      [aStep(defect.id, 'accepted', { name: 'Petra Weber', path: signature })],
      409,
    )
    expect(accepted.message).toBe('Dieser Schritt folgt nicht auf den Stand des Mangels.')
    expect(await statusOf(defect.id)).toBe('reported')
  })

  it('end with the acceptance, which carries the name and signature of the customer', async () => {
    const defect = aDefect({})
    await pushVia(app, technician(), [defect.operation, aStep(defect.id, 'resolved')])

    const unsigned = await pushVia(app, technician(), [aStep(defect.id, 'accepted')], 400)
    expect(unsigned.message).toContain('Die Abnahme braucht die Unterschrift des Kunden.')

    await pushVia(app, technician(), [
      aStep(defect.id, 'accepted', { name: 'Petra Weber', path: signature }),
    ])
    expect(await statusOf(defect.id)).toBe('accepted')

    const after = await pushVia(app, technician(), [aStep(defect.id, 'in_progress')], 409)
    expect(after.message).toBe('Der Mangel ist abgenommen und ändert sich nicht mehr.')

    // And the defect itself no longer changes, whichever way in.
    await expect(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx.execute(`update defects set description = 'anders' where id = '${defect.id}'`),
      ),
    ).rejects.toMatchObject({ cause: { code: 'OG008' } })
  })

  it('are the only way the status of a defect moves', async () => {
    const defect = aDefect({})
    await pushVia(app, technician(), [defect.operation])

    await expect(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx.execute(`update defects set status = 'resolved' where id = '${defect.id}'`),
      ),
    ).rejects.toMatchObject({ cause: { code: 'OG013' } })
    expect(await statusOf(defect.id)).toBe('reported')
  })
})

describe('what may change about a defect (#311)', () => {
  it('its description, installation and deadline until it is accepted, corrected in the office', async () => {
    const defect = aDefect({})
    await pushVia(app, technician(), [defect.operation])

    const correction = changed('defects', defect.id, {
      description: {
        from: 'Halter des Ladekabels locker, ein Dübel ausgerissen.',
        to: 'Halter locker.',
      },
      remedyDueOn: { from: null, to: '2026-11-24' },
    })

    // Recorded on site, corrected in the office: the technician has no right on the job itself.
    const unentitled = await pushVia(app, technician(), [correction], 400)
    expect(unentitled.message).toContain('Aufträge bearbeiten darf dieser Zugang nicht.')

    const corrected = await pushVia(app, office(), [correction])
    expect(corrected.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const { rows } = await admin.query(
      'select description, remedy_due_on::text as due from defects where id = $1',
      [defect.id],
    )
    expect(rows).toEqual([{ description: 'Halter locker.', due: '2026-11-24' }])
  })

  it('it is removed only while it is reported', async () => {
    const early = aDefect({})
    await pushVia(app, technician(), [early.operation])
    const removed = await pushVia(app, office(), [deleted('defects', early.id)])
    expect(removed.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const late = aDefect({})
    await pushVia(app, technician(), [late.operation, aStep(late.id, 'in_progress')])
    const refused = await pushVia(app, office(), [deleted('defects', late.id)], 409)
    expect(refused.message).toBe(
      'Entfernen lässt sich nur ein Mangel, der noch gemeldet ist und nicht aus einer Abnahme kommt.',
    )
  })
})

describe('the reservations of a signed acceptance (#311)', () => {
  async function anAcceptance(values: Record<string, unknown>, status = 'signed') {
    const id = newId<'form-record'>()

    await admin.query(
      `insert into form_records (id, tenant_id, definition_key, definition_version, job_id, performed_on, status, values)
       values ($1, $2, 'acceptance', 1, $3, '2026-11-05', $4, $5)`,
      [id, north.id, job, status, JSON.stringify(values)],
    )

    return id
  }

  async function defectsOf(record: string) {
    const { rows } = await admin.query(
      `select acceptance_line as line, description, job_id, installation_id, status,
              to_char(reported_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as reported
         from defects where acceptance_record_id = $1 order by acceptance_line`,
      [record],
    )

    return rows
  }

  it('become defects at the job and its installation, one for each line that says something', async () => {
    const record = await anAcceptance({
      result: 'accepted_with_reservations',
      reservations: 'Abdeckung links verkratzt.\n\n  Schutzkappe fehlt.  \n',
    })

    expect(await defectsOf(record)).toEqual([
      {
        line: 1,
        description: 'Abdeckung links verkratzt.',
        job_id: job,
        installation_id: wallbox,
        status: 'reported',
        reported: '2026-11-05 00:00',
      },
      {
        line: 2,
        description: 'Schutzkappe fehlt.',
        job_id: job,
        installation_id: wallbox,
        status: 'reported',
        reported: '2026-11-05 00:00',
      },
    ])
  })

  it('wait for the signature, and are written once', async () => {
    const record = await anAcceptance(
      { result: 'refused', reservations: 'Wallbox lädt nicht.' },
      'draft',
    )
    expect(await defectsOf(record)).toEqual([])

    await admin.query("update form_records set status = 'signed' where id = $1", [record])
    expect((await defectsOf(record)).map((row) => row.description)).toEqual(['Wallbox lädt nicht.'])
  })

  it('stay, since they are the customer’s', async () => {
    const record = await anAcceptance({
      result: 'accepted_with_reservations',
      reservations: 'Kratzer.',
    })
    const [row] = (
      await admin.query<{ id: string }>('select id from defects where acceptance_record_id = $1', [
        record,
      ])
    ).rows

    const refused = await pushVia(app, office(), [deleted('defects', String(row?.id))], 409)
    expect(refused.message).toBe(
      'Entfernen lässt sich nur ein Mangel, der noch gemeldet ist und nicht aus einer Abnahme kommt.',
    )
  })
})

describe('the report of the defects of a job (#311)', () => {
  it('prints every defect with its steps, the signature of an acceptance and the photos', async () => {
    const reserved = await (async () => {
      const id = newId<'form-record'>()

      await admin.query(
        `insert into form_records (id, tenant_id, definition_key, definition_version, job_id, performed_on, status, values)
         values ($1, $2, 'acceptance', 1, $3, '2026-11-05', 'signed', $4)`,
        [
          id,
          north.id,
          job,
          JSON.stringify({
            result: 'accepted_with_reservations',
            building_work: true,
            vob_agreed: false,
            reservations: 'Typenschild fehlt.',
          }),
        ],
      )

      return id
    })()
    const [fromAcceptance] = (
      await admin.query<{ id: string }>('select id from defects where acceptance_record_id = $1', [
        reserved,
      ])
    ).rows

    await pushVia(app, technician(), [
      aStep(String(fromAcceptance?.id), 'resolved'),
      aStep(String(fromAcceptance?.id), 'accepted', { name: 'Petra Weber', path: signature }),
    ])

    const complaint = aDefect({
      description: 'Wallbox bricht das Laden ab.',
      reportedAt: '2027-03-12T08:14:00.000Z',
    })
    await pushVia(app, office(), [complaint.operation])

    printed.length = 0
    await http()
      .get(`/jobs/${job}/defect-report`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = printed.map((job) => job.html).join('')

    expect(html).toContain('Mängelbericht')
    expect(html).toContain('Typenschild fehlt.')
    expect(html).toContain('Vorbehalt der Abnahme vom 05.11.2026')
    expect(html).toContain('Gemeldet: aus der Abnahme, 05.11.2026')
    expect(html).toContain('Abgenommen: Petra Weber')
    expect(html).toContain(`d="${signature}"`)
    expect(html).toContain('Wallbox bricht das Laden ab.')
    expect(html).toContain('In der Gewährleistung bis 05.11.2031')
    // The photo of the first test, bound into the page.
    expect(html).toContain(`data:image/png;base64,${photo.toString('base64')}`)

    await http()
      .get(`/jobs/${job}/defect-report`)
      .set('x-test-identity', office(south.id))
      .expect(404)
  })
})
