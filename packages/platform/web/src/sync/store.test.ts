import 'fake-indexeddb/auto'

import type { Operation, OperationId } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { openLocalStore, waitingIn } from './store.js'

/**
 * Whose changes a device sends (opengewerk-haustechnik#31).
 *
 * The server takes the person from the session that sends, and an operation
 * names only its device. A change somebody wrote and could not send before
 * their session ended would otherwise go out under whoever signs in next on
 * the same device, with that person's name and rights on it.
 */

let counter = 0

function aTenant(): string {
  return `owners${String((counter += 1))}`
}

function aNote(id: string, text: string): Operation {
  return {
    id: id as unknown as OperationId,
    entity: 'notes',
    recordId: `n-${id}`,
    kind: 'create',
    baseVersion: null,
    patches: [{ field: 'text', from: null, to: text }],
    recordedAt: new Date('2026-10-04T08:00:00Z'),
    deviceId: 'device',
  }
}

const photo = { sha256: 'a'.repeat(64), bytes: new ArrayBuffer(8), mediaType: 'image/jpeg' }

describe('the outbox of a device with more than one person', () => {
  it('sends a change only for the person it was recorded for, and counts every one', async () => {
    const tenant = aTenant()
    const anna = await openLocalStore(tenant, 'anna')

    await anna.queue(aNote('op-anna', 'Leiter im Flur'))
    await anna.keepFile(photo, true)
    anna.close()

    // Ben signs in on the same device after Anna's session ran out.
    const ben = await openLocalStore(tenant, 'ben')

    expect(await ben.readOutbox()).toEqual([])
    expect(await ben.waitingFiles()).toEqual([])
    expect(await ben.countWaitingFiles()).toBe(0)

    await ben.queue(aNote('op-ben', 'Tür klemmt'))

    expect((await ben.readOutbox()).map((operation) => operation.id)).toEqual(['op-ben'])
    ben.close()

    // Signing out counts what would be lost, whoever wrote it.
    expect(await waitingIn(tenant)).toBe(3)

    // Anna is back: hers go out, as they were queued and with nothing added.
    const back = await openLocalStore(tenant, 'anna')

    expect(await back.readOutbox()).toEqual([aNote('op-anna', 'Leiter im Flur')])
    expect((await back.waitingFiles()).map((file) => file.sha256)).toEqual([photo.sha256])
    expect(await back.countWaitingFiles()).toBe(1)
    back.close()
  })

  it('goes to whoever opens it next, for a change from before the person was kept', async () => {
    const tenant = aTenant()
    const before = await openLocalStore(tenant)

    await before.queue(aNote('op-before', 'Zählerstand fehlt'))
    before.close()

    const ben = await openLocalStore(tenant, 'ben')

    expect((await ben.readOutbox()).map((operation) => operation.id)).toEqual(['op-before'])
    ben.close()
  })
})
