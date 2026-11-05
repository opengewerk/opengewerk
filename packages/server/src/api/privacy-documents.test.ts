import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { berlinClock, type TenantId } from '@opengewerk/domain'
import {
  Database,
  newId,
  type PrintJob,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { processingRecordActivities, processingRecordSettings } from '../database/schema/index.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The record of the processing and the three documents on data protection
 * (#319): what whoever leads writes for the record, and nobody else; the
 * record naming only what the business uses; the measures with part A of the
 * template and part B of the instance; the deletion concept with what the
 * business set; and the recipients of the record in the answer to a request
 * for access (#318).
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

function person(userId: string, roles: string[], tenantId: TenantId = north) {
  return JSON.stringify({ userId, tenantId, roles })
}

const owner = person('lena', ['owner'])
const office = person('bruno', ['office'])
const southOwner = person('sven', ['owner'], south)

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

/** The message of whatever a statement of the application threw, the database's included. */
async function refusedWith(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause

    return String(cause?.message ?? (error as Error).message)
  }

  return 'went through'
}

/** What the stand-in renderer was given, newest last. */
const printed: PrintJob[] = []
let rendererThere = true

const standIn: Renderer = (job) => {
  if (!rendererThere) {
    return Promise.reject(new RendererUnavailableError('Der Renderer antwortet nicht.'))
  }

  printed.push(job)

  return Promise.resolve(new TextEncoder().encode(`%PDF-1.7 Datenschutz ${String(printed.length)}`))
}

interface ActivityShown {
  readonly key: string
  readonly purpose: string | null
  readonly legalBasis: string | null
  readonly recipients: string | null
  readonly proposedPurpose: string
  readonly unused: string | null
}

interface RecordShown {
  readonly controller: string | null
  readonly proposedController: string
  readonly officer: string | null
  readonly outside: string | null
  readonly activities: readonly ActivityShown[]
  readonly changed: { readonly on: string; readonly by: string | null } | null
  readonly leads: boolean
}

function activityOf(shown: RecordShown, key: string): ActivityShown {
  const found = shown.activities.find((activity) => activity.key === key)

  if (found === undefined) {
    throw new Error(`No activity ${key}.`)
  }

  return found
}

/** A document printed now, and the HTML it was made of. */
async function printedDocument(kind: string, who = owner) {
  const answer = await http()
    .get(`/privacy/documents/${kind}`)
    .set('x-test-identity', who)
    .buffer(true)
    .parse(binary)
    .expect(200)

  expect(answer.headers['content-type']).toBe('application/pdf')

  return { answer, html: (printed.at(-1) as PrintJob).html }
}

function keepActivity(key: string, body: object, who = owner) {
  return http().put(`/privacy/record/activities/${key}`).set('x-test-identity', who).send(body)
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])
  await admin.query(
    `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor) values
       ($1, 'owner', 'Inhaber', '{}', true, false), ($1, 'office', 'Büro', '{}', false, false),
       ($2, 'owner', 'Inhaber', '{}', true, false)`,
    [north, south],
  )
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('lena', 'Lena Leitung', 'lena@example.de'), ('bruno', 'Bruno Büro', 'bruno@example.de'),
       ('sven', 'Sven Süd', 'sven@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'lena', '{owner}'), ($1, 'bruno', '{office}'), ($2, 'sven', '{owner}')`,
    [north, south],
  )
  await admin.query(
    `insert into letterheads (tenant_id, company_name, street, house_number, postal_code, city, phone, email, managing_directors)
     values ($1, 'Elektro Nord GmbH', 'Hauptstraße', '103', '68535', 'Edingen-Neckarhausen', '06203 40455', 'info@nord.example', 'Lena Leitung')`,
    [north],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  rendererThere = true
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from processing_record_activities; delete from processing_record_settings;
     delete from access_requests; delete from deadlines; delete from deadline_settings;
     delete from erasure_automations; delete from erasures; delete from mail_outbox;
     delete from prospects; delete from customers; delete from people; delete from mail_settings;
     commit;`,
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the record of the processing', () => {
  it('proposes what the letterhead says, and says why an activity is not used', async () => {
    const shown = (await http().get('/privacy/record').set('x-test-identity', office).expect(200))
      .body as RecordShown

    expect(shown.controller).toBeNull()
    expect(shown.proposedController).toBe(
      'Elektro Nord GmbH, Hauptstraße 103, 68535 Edingen-Neckarhausen\nvertreten durch Lena Leitung, info@nord.example, 06203 40455',
    )
    expect(shown.leads).toBe(false)
    expect(activityOf(shown, 'customers').unused).toBeNull()
    expect(activityOf(shown, 'prospects').unused).toBe('noch kein Lead erfasst')
    expect(activityOf(shown, 'mail').unused).toBe('kein eigener Mailserver eingerichtet')

    await admin.query(
      `insert into prospects (tenant_id, name, source, last_contact_on) values ($1, 'Café Rosengarten', 'website', '2026-11-02')`,
      [north],
    )

    const after = (await http().get('/privacy/record').set('x-test-identity', owner).expect(200))
      .body as RecordShown

    expect(after.leads).toBe(true)
    expect(activityOf(after, 'prospects').unused).toBeNull()
  })

  it('is written only by whoever leads the business, and the database holds it so', async () => {
    const refused = await http()
      .put('/privacy/record')
      .set('x-test-identity', office)
      .send({ controller: 'Bruno Büro' })
      .expect(403)

    expect(refusal(refused)).toBe(
      'Was das Verzeichnis der Verarbeitungstätigkeiten sagt, schreibt nur, wer den Betrieb führt.',
    )
    expect(
      await refusedWith(
        database.forTenant({ tenantId: north, userId: 'bruno' }, (tx) =>
          tx.insert(processingRecordSettings).values({ tenantId: north, controller: 'Bruno Büro' }),
        ),
      ),
    ).toContain('row-level security')
    expect(
      await refusedWith(
        database.forTenant({ tenantId: north, userId: 'bruno' }, (tx) =>
          tx
            .insert(processingRecordActivities)
            .values({ tenantId: north, activity: 'mail', recipients: 'Bruno Büro' }),
        ),
      ),
    ).toContain('row-level security')
    expect(
      refusal(await keepActivity('mail', { recipients: 'Mailo GmbH' }, office).expect(403)),
    ).toBe(
      'Was das Verzeichnis der Verarbeitungstätigkeiten sagt, schreibt nur, wer den Betrieb führt.',
    )

    const kept = (
      await http()
        .put('/privacy/record')
        .set('x-test-identity', owner)
        .send({ controller: '  Elektro Nord GmbH\r\nLindenweg 4  ', officer: '', outside: 'DATEV' })
        .expect(200)
    ).body as RecordShown

    expect(kept).toMatchObject({
      controller: 'Elektro Nord GmbH\nLindenweg 4',
      officer: null,
      outside: 'DATEV',
    })
    expect(kept.changed).toEqual({ on: berlinClock(new Date()).day, by: 'Lena Leitung' })

    // What the office may not write it may not change either.
    expect(
      await refusedWith(
        database
          .forTenant({ tenantId: north, userId: 'bruno' }, (tx) =>
            tx.update(processingRecordSettings).set({ controller: 'Bruno Büro' }).returning(),
          )
          .then((rows) => {
            throw new Error(`${String(rows.length)} rows`)
          }),
      ),
    ).toBe('0 rows')

    const logged = await admin.query<{ reason: string; user_id: string }>(
      `select distinct reason, user_id from audit_entries where table_name = 'processing_record_settings'`,
    )

    expect(logged.rows).toEqual([{ reason: 'privacy.record', user_id: 'lena' }])
  })

  it('confirms purpose and legal basis together, and takes them back to the proposal', async () => {
    expect(refusal(await keepActivity('mail', { purpose: 'Mails' }).expect(400))).toBe(
      'Zweck und Rechtsgrundlage gehören zusammen: beide, oder keines für den Vorschlag der Anwendung.',
    )
    await keepActivity('nothing', { purpose: 'a', legalBasis: 'b' }).expect(404)
    expect(refusal(await keepActivity('mail', { recipients: 'x'.repeat(2001) }).expect(400))).toBe(
      '„Empfänger“: höchstens 2.000 Zeichen.',
    )

    const confirmed = (
      await keepActivity('mail', {
        purpose: 'Mails an Kunden',
        legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
        recipients: 'Mailo GmbH, Frankfurt',
      }).expect(200)
    ).body as RecordShown

    expect(activityOf(confirmed, 'mail')).toMatchObject({
      purpose: 'Mails an Kunden',
      legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
      recipients: 'Mailo GmbH, Frankfurt',
    })

    const back = (
      await keepActivity('mail', {
        purpose: '',
        legalBasis: ' ',
        recipients: 'Mailo GmbH, Frankfurt',
      }).expect(200)
    ).body as RecordShown

    expect(activityOf(back, 'mail')).toMatchObject({
      purpose: null,
      legalBasis: null,
      recipients: 'Mailo GmbH, Frankfurt',
    })
  })

  it('stays in its business', async () => {
    await http()
      .put('/privacy/record')
      .set('x-test-identity', owner)
      .send({ controller: 'Elektro Nord GmbH', officer: 'Datenschutz Nord' })
      .expect(200)

    const south = (
      await http().get('/privacy/record').set('x-test-identity', southOwner).expect(200)
    ).body as RecordShown

    expect(south).toMatchObject({
      controller: null,
      officer: null,
      proposedController: 'Elektro Süd GmbH',
    })
  })
})

describe('the documents on data protection', () => {
  it('are summed up for their cards before one is downloaded', async () => {
    const before = await http().get('/privacy/documents').set('x-test-identity', office).expect(200)

    expect(before.body).toMatchObject({
      record: {
        controller:
          'Elektro Nord GmbH, Hauptstraße 103, 68535 Edingen-Neckarhausen (aus dem Briefkopf)',
        officer: null,
        used: 8,
        confirmed: 0,
        unused: 7,
      },
      measures: { changedOn: null, subprocessors: 0 },
      deletion: { kinds: 6, automatic: [], prospectMonths: 12, customerMonths: 36 },
    })

    await http()
      .put('/privacy/record')
      .set('x-test-identity', owner)
      .send({ controller: 'Elektro Nord GmbH\nLindenweg 4', officer: 'Dr. Datenschutz\nMannheim' })
      .expect(200)
    await keepActivity('customers', { purpose: 'Kunden', legalBasis: 'Art. 6' }).expect(200)

    const after = await http().get('/privacy/documents').set('x-test-identity', office).expect(200)

    expect(after.body).toMatchObject({
      record: { controller: 'Elektro Nord GmbH', officer: 'Dr. Datenschutz', confirmed: 1 },
    })
  })

  it('print the record with only what the business uses, and what the owner typed as text', async () => {
    await http()
      .put('/privacy/record')
      .set('x-test-identity', owner)
      .send({
        controller: 'Elektro <b>Nord</b> **GmbH**',
        outside: '# Lohn bei DATEV\nSteuerberatung',
      })
      .expect(200)

    const { answer, html } = await printedDocument('record')

    expect(String(answer.headers['content-disposition'])).toContain(
      encodeURIComponent('Verzeichnis der Verarbeitungstätigkeiten Elektro Nord GmbH'),
    )
    expect(html).toContain('Verzeichnis der Verarbeitungstätigkeiten')
    expect(html).toContain('Kunden, Ansprechpartner und Verlauf')
    expect(html).not.toContain('Leads und Vertrieb')
    expect(html).not.toContain('Benachrichtigungen auf Geräten')
    expect(html).toContain('Elektro &lt;b&gt;Nord&lt;/b&gt; **GmbH**')
    expect(html).not.toContain('<strong>GmbH</strong>')
    expect(html).toContain('# Lohn bei DATEV')
    expect(html).toContain('(Vorschlag der Anwendung, nicht bestätigt)')

    await admin.query(
      `insert into prospects (tenant_id, name, source, last_contact_on) values ($1, 'Café Rosengarten', 'website', '2026-11-02')`,
      [north],
    )

    expect((await printedDocument('record')).html).toContain('Leads und Vertrieb')
  })

  it('print the measures with part A of the template and part B of the instance', async () => {
    const { html } = await printedDocument('measures', office)

    expect(html).toContain('A.1 Anmeldung')
    expect(html).toContain('hier sind sie noch nicht ausgefüllt')
    expect(html).toContain('Teil B: Was der Auftragsverarbeiter beim Betrieb sicherstellt')
    expect(html).not.toContain('{{')
  })

  it('print the deletion concept with the months and kinds the business set', async () => {
    await admin.query(
      `insert into deadline_settings (tenant_id, kind, interval_months) values ($1, 'privacy.prospect_erasure', 18)`,
      [north],
    )
    await admin.query(
      `begin; set local app.user_id = 'lena';
       insert into erasure_automations (tenant_id, kind, created_by) values ('${north}', 'sickness', 'lena');
       commit;`,
    )

    const { html } = await printedDocument('deletion')

    expect(html).toContain('18 Monate nach dem letzten Kontakt')
    expect(html).toContain('36 Monate nach dem letzten Kontakt')
    expect(html.split('von selbst, im Namen dessen, der es eingeschaltet hat')).toHaveLength(2)
    expect(html).toContain('§ 147')
  })

  it('answer 404 for a document there is none of, and 503 without the renderer', async () => {
    await http().get('/privacy/documents/contract').set('x-test-identity', owner).expect(404)

    rendererThere = false

    await http().get('/privacy/documents/record').set('x-test-identity', owner).expect(503)
  })
})

describe('the answer to a request for access', () => {
  it('names the recipients the record has for what concerns the person, and no others', async () => {
    const customer = newId<'customer'>()

    await admin.query(
      `insert into mail_settings (tenant_id, host, port, security, from_address) values ($1, 'mail.example.de', 587, 'starttls', 'buero@nord.example')`,
      [north],
    )
    await admin.query(
      `begin; set local app.user_id = 'lena';
       insert into customers (id, tenant_id, kind, name) values ('${customer}', '${north}', 'private', 'Martina Seidel');
       insert into people (tenant_id, name, user_id, joined_on) values ('${north}', 'Bruno Büro', 'bruno', '2024-01-01');
       commit;`,
    )
    await keepActivity('mail', { recipients: 'Mailo GmbH, Frankfurt' }).expect(200)
    await keepActivity('staff', { recipients: 'Lohnbüro Meyer' }).expect(200)

    const recorded = await http()
      .post('/privacy/access-requests')
      .set('x-test-identity', owner)
      .send({
        subject: 'customer',
        subjectId: customer,
        receivedOn: berlinClock(new Date()).day,
        channel: 'email',
      })
      .expect(201)

    await http()
      .post(
        `/privacy/access-requests/${(recorded.body as { request: { id: string } }).request.id}/report`,
      )
      .set('x-test-identity', owner)
      .buffer(true)
      .parse(binary)
      .expect(201)

    const html = (printed.at(-1) as PrintJob).html

    expect(html).toContain(
      'Nach dem Verzeichnis der Verarbeitungstätigkeiten des Betriebs gehen Daten an: Mailo GmbH, Frankfurt.',
    )
    expect(html).not.toContain('Lohnbüro Meyer')
  })
})
