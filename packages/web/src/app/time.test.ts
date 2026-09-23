import 'fake-indexeddb/auto'

import type { RecordState } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { SyncClient } from '../sync/client.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { entriesOf, instantOf, parseStopwatch, recordEntry } from './time.js'

describe('a clock time typed on site', () => {
  it('is read as the time on a wall in Germany, summer and winter', () => {
    expect(instantOf('2026-01-15', '08:00')).toBe('2026-01-15T07:00:00.000Z')
    expect(instantOf('2026-07-15', '08:00')).toBe('2026-07-15T06:00:00.000Z')
  })

  it('holds on the two nights the clocks change', () => {
    // Summer time begins at two in the morning, which becomes three.
    expect(instantOf('2026-03-29', '03:30')).toBe('2026-03-29T01:30:00.000Z')
    expect(instantOf('2026-03-29', '01:30')).toBe('2026-03-29T00:30:00.000Z')
    // And ends at three, which becomes two again; the earlier half-past-two
    // is still summer time.
    expect(instantOf('2026-10-25', '01:30')).toBe('2026-10-24T23:30:00.000Z')
    expect(instantOf('2026-10-25', '04:00')).toBe('2026-10-25T03:00:00.000Z')
  })

  it('is nothing when the day or the clock is not one', () => {
    expect(instantOf('', '08:00')).toBeNull()
    expect(instantOf('2026-01-15', '8')).toBeNull()
  })
})

describe('a stopwatch kept on a shared device', () => {
  const stored = JSON.stringify({
    kind: 'work',
    jobId: 'j-1',
    userId: 'u-1',
    startedAt: '2026-09-21T05:00:00.000Z',
    place: null,
    resume: null,
  })

  it('belongs to the person who started it', () => {
    expect(parseStopwatch(stored, 'u-1')).toMatchObject({ kind: 'work', jobId: 'j-1' })
    expect(parseStopwatch(stored, 'u-2')).toBeNull()
    expect(parseStopwatch(stored, null)).toBeNull()
  })

  it('is nothing when it is not one this build wrote', () => {
    expect(parseStopwatch('{"kind":"nap"}', 'u-1')).toBeNull()
    expect(parseStopwatch('kaputt', 'u-1')).toBeNull()
  })
})

describe('the entries of a person', () => {
  it('are their own and the ones not sent yet, and nobody is nothing', () => {
    const entries: RecordState[] = [
      { id: 'a', userId: 'u-1' },
      { id: 'b', userId: 'u-2' },
      { id: 'c' },
    ]

    expect(entriesOf(entries, 'u-1').map((entry) => entry['id'])).toEqual(['a', 'c'])
    expect(entriesOf(entries, null)).toEqual([])
  })
})

describe('an entry typed by hand', () => {
  it('is refused before the outbox when a correction has no reason or the times run backwards', async () => {
    const client = await SyncClient.start({
      store: await openLocalStore('zeiten-von-hand'),
      transport: new TestServer(),
      writer: new TestServer(),
      deviceId: 'geraet',
      entities: ['time_entries'],
      onSignedOut: () => {},
    })
    const entry = {
      kind: 'work' as const,
      jobId: null,
      startedAt: '2026-09-21T05:00:00.000Z',
      endedAt: '2026-09-21T09:00:00.000Z',
      note: null,
    }

    expect(await recordEntry(client, entry, 'e-1')).toBe('Eine Korrektur braucht einen Grund.')
    expect(await recordEntry(client, { ...entry, endedAt: '2026-09-21T04:00:00.000Z' })).toBe(
      'Das Ende liegt nicht nach dem Beginn.',
    )
    expect(client.status().pending).toBe(0)
    expect(await recordEntry(client, entry)).toMatchObject({ outcome: 'queued' })
    expect(client.status().pending).toBe(1)

    client.stop()
  })
})
