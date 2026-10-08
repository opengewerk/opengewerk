import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probeMailOutbox } from '../database/probe-schema.js'
import {
  claimMinutes,
  mailOutboxStore,
  maximumAttempts,
  retryDelay,
  retryMinutes,
} from './outbox.js'
import { MailDeliveryError } from './transport.js'

/**
 * The outbox of the mail as the foundation keeps it, on the outbox of an
 * application that is nobody's: the probe application tells people about
 * parcels and visits, and keeps the number of a parcel in a column of its
 * own. Which kinds there are and what else a row carries is the
 * application's; when a message is due, how often it is tried and when it is
 * given up on is the same for every one.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const outbox = mailOutboxStore(probeMailOutbox)

let foundation: ProbeFoundation
let admin: Pool
let database: Database

const actor = (tenantId: TenantId = north.id) => ({ tenantId, reason: 'mail' })

/** A message about a parcel, written the way a cause writes it. */
async function aMessage(
  over: {
    readonly tenantId?: TenantId
    readonly cause?: string
    readonly nextAttemptAt?: Date
    readonly parcelNumber?: string
  } = {},
) {
  const tenantId = over.tenantId ?? north.id

  const [row] = await database.forTenant(actor(tenantId), (tx) =>
    tx
      .insert(probeMailOutbox)
      .values({
        tenantId,
        kind: 'parcel_waiting',
        cause: over.cause ?? `parcel:${newId<'parcel'>()}`,
        parcelNumber: over.parcelNumber ?? 'P-0001',
        senderName: 'Mandant Nord',
        recipientAddress: 'empfang@nord.example.de',
        subject: 'Ein Paket wartet',
        body: 'Am Empfang wartet ein Paket.',
        ...(over.nextAttemptAt ? { nextAttemptAt: over.nextAttemptAt } : {}),
      })
      .returning(),
  )

  if (!row) {
    throw new Error('No message was written.')
  }

  return row
}

async function stateOf(id: string) {
  const { rows } = await admin.query<{
    status: string
    attempts: number
    next_attempt_at: Date
    last_error: string | null
    sent_at: Date | null
  }>(
    'select status, attempts, next_attempt_at, last_error, sent_at from mail_outbox where id = $1',
    [id],
  )

  return rows[0]
}

const minutes = (count: number) => count * 60_000

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north, south])
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
}, 60_000)

beforeEach(async () => {
  await admin.query('delete from mail_outbox')
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('a message in the outbox', () => {
  it('is claimed when it is due, whole, with what the application keeps beside it', async () => {
    const now = new Date()
    const due = await aMessage({
      parcelNumber: 'P-0042',
      nextAttemptAt: new Date(now.getTime() - 1),
    })
    await aMessage({ nextAttemptAt: new Date(now.getTime() + minutes(1)) })

    const claimed = await database.forTenant(actor(), (tx) => outbox.claimDue(tx, now))

    expect(claimed.map((message) => message.id)).toEqual([due.id])
    expect(claimed[0]).toMatchObject({ kind: 'parcel_waiting', parcelNumber: 'P-0042' })
    expect(claimed[0]?.attempts).toBe(1)
    // Left alone for the length of a claim, so that a pass which dies between
    // claiming and sending loses nothing.
    expect(claimed[0]?.nextAttemptAt.getTime()).toBe(now.getTime() + minutes(claimMinutes))
  })

  it('is claimed oldest first, and no more than asked for', async () => {
    const now = new Date()
    const first = await aMessage({ nextAttemptAt: new Date(now.getTime() - minutes(3)) })
    const second = await aMessage({ nextAttemptAt: new Date(now.getTime() - minutes(2)) })
    await aMessage({ nextAttemptAt: new Date(now.getTime() - minutes(1)) })

    const claimed = await database.forTenant(actor(), (tx) => outbox.claimDue(tx, now, 2))

    expect(claimed.map((message) => message.id)).toEqual([first.id, second.id])
  })

  it('is claimed by one pass only, while the other passes it by without waiting', async () => {
    const now = new Date()
    const message = await aMessage({ nextAttemptAt: new Date(now.getTime() - 1) })

    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let claimedOnce = () => {}
    const firstHasClaimed = new Promise<void>((resolve) => {
      claimedOnce = resolve
    })

    const first = database.forTenant(actor(), async (tx) => {
      const rows = await outbox.claimDue(tx, now)
      claimedOnce()
      await held

      return rows
    })

    await firstHasClaimed

    // A pass that waited for the first would wait for as long as the first
    // stays open, and a slow mail server would hold up every other pass.
    const second = database.forTenant(actor(), (tx) => outbox.claimDue(tx, now))
    const waited = await Promise.race([
      second.then((rows) => rows.map((row) => row.id)),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 2_000)),
    ])

    release()
    await second

    expect(waited).toEqual([])
    expect((await first).map((row) => row.id)).toEqual([message.id])
  })

  it('is claimed only in its own tenant', async () => {
    const now = new Date()
    await aMessage({ tenantId: south.id, nextAttemptAt: new Date(now.getTime() - 1) })

    const claimed = await database.forTenant(actor(), (tx) => outbox.claimDue(tx, now))

    expect(claimed).toEqual([])
  })

  it('is sent once marked so, and its last error goes', async () => {
    const message = await aMessage()
    const now = new Date()
    await admin.query(`update mail_outbox set last_error = 'ETIMEDOUT: war weg' where id = $1`, [
      message.id,
    ])

    await database.forTenant(actor(), (tx) => outbox.markSent(tx, message.id, now))

    expect(await stateOf(message.id)).toMatchObject({
      status: 'sent',
      last_error: null,
      sent_at: now,
    })
  })
})

describe('a message that did not go out', () => {
  it('waits longer after every attempt, quick at first and then patient', () => {
    expect(retryMinutes).toEqual([1, 5, 15, 60, 180])
    expect([1, 2, 3, 4, 5, 6, 19].map(retryDelay)).toEqual([1, 5, 15, 60, 180, 180, 180])
  })

  it('is tried again after its wait, with the reason it failed', async () => {
    const message = await aMessage()
    const now = new Date()
    const failure = new MailDeliveryError('Verbindung abgebrochen', 'ECONNECTION', null)

    const outcome = await database.forTenant(actor(), (tx) =>
      outbox.markFailed(tx, { id: message.id, attempts: 3 }, failure, now),
    )

    expect(outcome).toBe('retry')
    expect(await stateOf(message.id)).toMatchObject({
      status: 'pending',
      last_error: 'ECONNECTION: Verbindung abgebrochen',
      next_attempt_at: new Date(now.getTime() + minutes(15)),
    })
  })

  it('is given up on after an answer that will not change, and stays with it', async () => {
    const message = await aMessage()
    const now = new Date()
    const refused = new MailDeliveryError('Postfach unbekannt', 'EENVELOPE', 550)

    const outcome = await database.forTenant(actor(), (tx) =>
      outbox.markFailed(tx, { id: message.id, attempts: 1 }, refused, now),
    )

    expect(outcome).toBe('failed')
    expect(await stateOf(message.id)).toMatchObject({
      status: 'failed',
      last_error: 'EENVELOPE: Postfach unbekannt',
    })
  })

  it('is given up on after the last attempt', async () => {
    const message = await aMessage()
    const failure = new MailDeliveryError('Zeit abgelaufen', 'ETIMEDOUT', null)

    const before = await database.forTenant(actor(), (tx) =>
      outbox.markFailed(tx, { id: message.id, attempts: maximumAttempts - 1 }, failure, new Date()),
    )
    const last = await database.forTenant(actor(), (tx) =>
      outbox.markFailed(tx, { id: message.id, attempts: maximumAttempts }, failure, new Date()),
    )

    expect([before, last]).toEqual(['retry', 'failed'])
  })

  it('keeps no more of a reason than fits', async () => {
    const message = await aMessage()
    const failure = new MailDeliveryError('x'.repeat(2_000), null, null)

    await database.forTenant(actor(), (tx) =>
      outbox.markFailed(tx, { id: message.id, attempts: 1 }, failure, new Date()),
    )

    expect((await stateOf(message.id))?.last_error).toHaveLength(1_000)
  })
})

describe('the messages of a tenant that removed its mail server', () => {
  it('are given up on while waiting, with the reason, and nothing else is touched', async () => {
    const waiting = await aMessage()
    const sent = await aMessage()
    const elsewhere = await aMessage({ tenantId: south.id })
    const now = new Date()
    await database.forTenant(actor(), (tx) => outbox.markSent(tx, sent.id, now))

    await database.forTenant(actor(), (tx) =>
      outbox.giveUpPending(tx, 'Der Mailserver wurde entfernt.', now),
    )

    expect(await stateOf(waiting.id)).toMatchObject({
      status: 'failed',
      last_error: 'Der Mailserver wurde entfernt.',
    })
    expect((await stateOf(sent.id))?.status).toBe('sent')
    expect((await stateOf(elsewhere.id))?.status).toBe('pending')
  })
})
