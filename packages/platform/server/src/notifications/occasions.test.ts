import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probeMailOutbox, probePush, probeSecrets } from '../database/probe-schema.js'
import { mailOutboxStore } from '../mail/outbox.js'
import { mailServers } from '../mail/server-settings.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import type { MailTransport, OutgoingMail } from '../mail/transport.js'
import { runMailCycle } from '../mail/worker.js'
import { pushStore } from '../push/outbox.js'
import { aBrowser, recordingPost, testVapid } from '../push/test-browser.js'
import { runPushCycle } from '../push/worker.js'
import { secretStore } from '../secrets/store.js'
import { type Occasions, occasionsOf } from './occasions.js'

/**
 * The mechanism that turns an occasion into a message for mail and push, on
 * occasions no real application has: in the probe application a parcel waits
 * at the desk and a visit is announced (#23). The occasions say what is due,
 * whom a message goes to and what it says; the mechanism writes once per
 * cause, asks first whether there is still something to tell, and runs both
 * jobs over the same table.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }

const origin = 'https://probewerk.example.de'

/** The notifications of the probe application. */
type ProbeNotification =
  | { readonly kind: 'parcel_waiting'; readonly parcel: string }
  | { readonly kind: 'visit_announced'; readonly visitor: string }

/** What the occasions of the probe application are handed beside the moment: the desk they speak for. */
interface ProbeExtra {
  readonly desk: string
}

/** The parcels at the desk, each for Lena; picked up ones are told to nobody. */
let parcels: Map<string, { readonly pickedUp: boolean }>
/** The visits announced at the gate, raised for mail only. */
let visits: string[]
/** Which raiser was asked, in order: the occasion and the channel. */
let asked: string[]

const mailbox = mailOutboxStore(probeMailOutbox)
const devices = pushStore(probePush)

const occasions: Occasions<ProbeNotification, ProbeExtra> = occasionsOf<
  ProbeNotification,
  ProbeExtra
>({
  parcel_waiting: {
    causeOf: (notification) => `parcel:${notification.parcel}`,
    raise: {
      mail: async () => {
        asked.push('parcel_waiting:mail')

        return [...parcels]
          .filter(([, parcel]) => !parcel.pickedUp)
          .map(([parcel]) => ({ kind: 'parcel_waiting' as const, parcel }))
      },
      push: async () => {
        asked.push('parcel_waiting:push')

        return [...parcels]
          .filter(([, parcel]) => !parcel.pickedUp)
          .map(([parcel]) => ({ kind: 'parcel_waiting' as const, parcel }))
      },
    },
    mail: async (database, tenantId, notification, writing) => {
      if (parcels.get(notification.parcel)?.pickedUp !== false) {
        return []
      }

      const written = await database.forTenant({ tenantId, reason: 'notification' }, (tx) =>
        tx
          .insert(probeMailOutbox)
          .values({
            tenantId,
            kind: 'parcel_waiting',
            cause: occasions.causeOf(notification),
            parcelNumber: notification.parcel,
            senderName: writing.desk,
            recipientAddress: 'lena@example.de',
            subject: 'Ein Paket wartet',
            body: `Am ${writing.desk} wartet das Paket ${notification.parcel}: ${writing.origin}/pakete`,
          })
          .onConflictDoNothing({ target: [probeMailOutbox.tenantId, probeMailOutbox.cause] })
          .returning({ id: probeMailOutbox.id }),
      )

      return written.map((row) => row.id)
    },
    push: async (database, tenantId, notification, writing) => {
      if (parcels.get(notification.parcel)?.pickedUp !== false) {
        return []
      }

      return devices.write(
        database,
        tenantId,
        {
          kind: 'parcel_waiting',
          cause: occasions.causeOf(notification),
          userId: 'lena',
          text: { title: 'Ein Paket wartet', body: `Am ${writing.desk} wartet ein Paket.` },
          urls: { front: '/pakete', back: '/pakete' },
          expiresAt: new Date(writing.now.getTime() + 3_600_000),
        },
        writing.now,
      )
    },
  },
  visit_announced: {
    causeOf: (notification) => `visit:${notification.visitor}`,
    raise: {
      mail: async () => {
        asked.push('visit_announced:mail')

        return visits.map((visitor) => ({ kind: 'visit_announced' as const, visitor }))
      },
    },
    mail: async (database, tenantId, notification, writing) => {
      const written = await database.forTenant({ tenantId, reason: 'notification' }, (tx) =>
        tx
          .insert(probeMailOutbox)
          .values({
            tenantId,
            kind: 'visit_announced',
            cause: occasions.causeOf(notification),
            senderName: writing.desk,
            recipientAddress: 'lena@example.de',
            subject: 'Besuch',
            body: `${notification.visitor} hat sich angemeldet.`,
          })
          .onConflictDoNothing({ target: [probeMailOutbox.tenantId, probeMailOutbox.cause] })
          .returning({ id: probeMailOutbox.id }),
      )

      return written.map((row) => row.id)
    },
  },
})

const servers = mailServers({
  secrets: secretStore(probeSecrets),
  purpose: 'mailbox',
  signatureProblem: () => null,
  sentences: {
    notConfigured: 'Dieser Mandant hat keinen Mailserver.',
    noneToRemove: 'Dieser Mandant hat keinen Mailserver, der sich entfernen ließe.',
    senderName: 'Den Namen davor nimmt die Probe aus ihren Stammdaten.',
  },
})

let foundation: ProbeFoundation
let admin: Pool
let database: Database

function recording() {
  const sent: OutgoingMail[] = []
  const transport: MailTransport = {
    send: (mail) => {
      sent.push(mail)

      return Promise.resolve()
    },
    verify: () => Promise.resolve(),
    close: () => undefined,
  }

  return { transport, sent }
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north])
  await admin.query(
    "insert into auth_users (id, name, email) values ('lena', 'Lena', 'lena@example.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'lena', '{lead}')",
    [north.id],
  )
  await aMailServer(admin, north.id, { from: 'empfang@nord.example.de' })
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
}, 60_000)

beforeEach(async () => {
  parcels = new Map()
  visits = []
  asked = []
  await admin.query('delete from mail_outbox')
  await admin.query('delete from push_outbox')
  await admin.query('delete from push_subscriptions')
  await admin.query('delete from auth_sessions')
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

/** A device of Lena's, signed in. */
async function aDevice() {
  const browser = aBrowser()
  const session = `session-lena-${newId()}`

  await admin.query(
    `insert into auth_sessions (id, token, user_id, expires_at, active_tenant_id, created_at, updated_at)
       values ($1, $1, 'lena', '2038-01-01', $2, now(), now())`,
    [session, north.id],
  )
  await database.forTenant({ tenantId: north.id }, (tx) =>
    tx.insert(probePush.pushSubscriptions).values({
      tenantId: north.id,
      userId: 'lena',
      sessionId: session,
      entry: 'front',
      label: 'Chrome auf Windows',
      endpoint: `https://push.example.com/lena/${newId()}`,
      ...browser.keys,
    }),
  )

  return browser
}

describe('an occasion the application raises by itself', () => {
  it('reaches its person by mail and by push, both jobs running over the same table', async () => {
    const browser = await aDevice()
    parcels.set('P-0042', { pickedUp: false })
    const post = recording()
    const service = recordingPost()

    const mailed = await runMailCycle({
      database,
      servers,
      outbox: mailbox,
      connect: () => post.transport,
      key: testKey,
      raise: occasions.raiseMail(database, { origin, desk: 'Empfang' }),
      sentences: { passwordUnreadable: () => '', tenantFailed: () => '' },
    })
    const pushed = await runPushCycle({
      database,
      vapid: testVapid(),
      post: service.post,
      store: devices,
      raise: occasions.raisePush(database, { desk: 'Empfang' }),
      sentences: { tenantFailed: () => '' },
    })

    expect(mailed).toMatchObject({ written: 1, sent: 1 })
    expect(post.sent[0]?.text).toBe(`Am Empfang wartet das Paket P-0042: ${origin}/pakete`)
    expect(pushed).toMatchObject({ written: 1, sent: 1 })
    expect(browser.read(service.posted[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      body: 'Am Empfang wartet ein Paket.',
      tag: 'parcel:P-0042',
    })
  })

  it('is raised by each job only for its own channel', async () => {
    visits.push('Herr Gast')
    const post = recording()

    await runPushCycle({
      database,
      vapid: testVapid(),
      post: recordingPost().post,
      store: devices,
      raise: occasions.raisePush(database, { desk: 'Empfang' }),
      sentences: { tenantFailed: () => '' },
    })

    expect(asked).toEqual([])

    await aDevice()
    await runPushCycle({
      database,
      vapid: testVapid(),
      post: recordingPost().post,
      store: devices,
      raise: occasions.raisePush(database, { desk: 'Empfang' }),
      sentences: { tenantFailed: () => '' },
    })

    expect(asked).toEqual(['parcel_waiting:push'])

    asked.length = 0
    await runMailCycle({
      database,
      servers,
      outbox: mailbox,
      connect: () => post.transport,
      key: testKey,
      raise: occasions.raiseMail(database, { origin, desk: 'Empfang' }),
      sentences: { passwordUnreadable: () => '', tenantFailed: () => '' },
    })

    expect(asked).toEqual(['parcel_waiting:mail', 'visit_announced:mail'])
    expect(post.sent.map((mail) => mail.text)).toEqual(['Herr Gast hat sich angemeldet.'])
  })

  it('is told to nobody once it no longer applies', async () => {
    await aDevice()
    parcels.set('P-0042', { pickedUp: false })
    const raised = { kind: 'parcel_waiting' as const, parcel: 'P-0042' }
    parcels.set('P-0042', { pickedUp: true })

    expect(
      await occasions.mail(database, north.id, raised, {
        origin,
        desk: 'Empfang',
        now: new Date(),
      }),
    ).toEqual([])
    expect(
      await occasions.push(database, north.id, raised, { desk: 'Empfang', now: new Date() }),
    ).toEqual([])
  })
})

describe('an occasion a route raises', () => {
  it('is written by mail once for its cause, and in a channel it has no writer for not at all', async () => {
    await aDevice()
    const visit = { kind: 'visit_announced' as const, visitor: 'Herr Gast' }
    const writing = { origin, desk: 'Empfang', now: new Date() }

    expect(await occasions.mail(database, north.id, visit, writing)).toHaveLength(1)
    expect(await occasions.mail(database, north.id, visit, writing)).toEqual([])
    expect(
      await occasions.push(database, north.id, visit, { desk: 'Empfang', now: new Date() }),
    ).toEqual([])
    expect(occasions.causeOf(visit)).toBe('visit:Herr Gast')
  })

  it('is refused when the application has no occasion of its kind', async () => {
    const stranger = { kind: 'invoice_overdue', visitor: 'x' } as unknown as ProbeNotification

    await expect(
      occasions.mail(database, north.id, stranger, { origin, desk: 'Empfang', now: new Date() }),
    ).rejects.toThrow('There is no occasion of the kind invoice_overdue.')
  })
})
