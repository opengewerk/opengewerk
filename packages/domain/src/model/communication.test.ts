import { describe, expect, it } from 'vitest'

import {
  type Communication,
  communicationProblems,
  communicationTitle,
  type HistoryItem,
  historyOf,
} from './communication.js'
import type { CommunicationId, CustomerId } from './identifier.js'

const now = new Date('2026-11-04T10:00:00Z')

const call = {
  kind: 'call',
  direction: 'incoming',
  counterpart: 'Sabine Keller',
  text: 'Das Treppenhauslicht flackert wieder.',
  happenedAt: '2026-11-04T08:12:00Z',
}

describe('an entry in the history (#313)', () => {
  it('takes a call with its direction and a note without one', () => {
    expect(communicationProblems(call, now)).toEqual({})
    expect(
      communicationProblems(
        { kind: 'note', text: 'Schlüssel beim Hausmeister.', happenedAt: '2026-11-04T08:00:00Z' },
        now,
      ),
    ).toEqual({})
  })

  it('asks a call who called whom, and a note for neither direction nor counterpart', () => {
    expect(communicationProblems({ ...call, direction: null }, now)['direction']).toBe(
      'Wer wen angerufen hat, fehlt.',
    )
    const note = communicationProblems(
      { ...call, kind: 'note', direction: 'incoming', counterpart: 'Frau Keller' },
      now,
    )

    expect(note['direction']).toBe('Nur ein Anruf hat eine Richtung.')
    expect(note['counterpart']).toBe('Nur ein Anruf hat einen Gesprächspartner.')
  })

  it('needs a content of at most 5000 characters and a moment that has been', () => {
    expect(communicationProblems({ ...call, text: '  ' }, now)['text']).toBe(
      'Ein Eintrag braucht einen Inhalt.',
    )
    expect(communicationProblems({ ...call, text: 'x'.repeat(5001) }, now)['text']).toContain(
      '5000',
    )
    expect(
      communicationProblems({ ...call, happenedAt: '2026-11-04T11:00:00Z' }, now)['happenedAt'],
    ).toBe('Ein Eintrag hält fest, was war, nicht was kommt.')
    // A device a few minutes fast is still now.
    expect(communicationProblems({ ...call, happenedAt: '2026-11-04T10:03:00Z' }, now)).toEqual({})
    expect(communicationProblems({ ...call, happenedAt: 'gestern' }, now)['happenedAt']).toBe(
      'Wann es war, ist ein Zeitpunkt.',
    )
  })

  it('is called a note or a call with its direction', () => {
    expect(communicationTitle({ kind: 'note', direction: null })).toBe('Notiz')
    expect(communicationTitle({ kind: 'call', direction: 'incoming' })).toBe('Anruf, eingehend')
    expect(communicationTitle({ kind: 'call', direction: 'outgoing' })).toBe('Anruf, ausgehend')
  })
})

describe('the history (#313)', () => {
  const entry = (at: string): HistoryItem => ({
    type: 'entry',
    at,
    entry: {
      id: `e-${at}` as CommunicationId,
      customerId: 'c-1' as CustomerId,
      siteId: null,
      kind: 'note',
      direction: null,
      counterpart: null,
      text: 'Notiz',
      happenedAt: at,
      createdBy: 'britta',
    } satisfies Communication,
  })
  const appointment = (at: string, endsAt: string, series = false): HistoryItem => ({
    type: 'appointment',
    at,
    endsAt,
    id: `a-${at}`,
    jobId: 'j-1',
    jobDesignation: 'Störung Treppenhauslicht',
    siteId: null,
    userIds: ['jonas'],
    series,
  })

  it('puts the appointments still to come on top, the next first, and the rest newest first', () => {
    const next = appointment('2026-11-09T07:00:00Z', '2026-11-09T09:00:00Z')
    const later = appointment('2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z')
    // Running now: still to come until it ended.
    const running = appointment('2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z')
    const past = appointment('2026-10-28T07:00:00Z', '2026-10-28T10:30:00Z')
    const older = entry('2026-10-27T13:05:00Z')
    const newer = entry('2026-11-04T08:12:00Z')
    const history = historyOf([older, later, past, newer, next, running], now)

    expect(history.coming).toEqual([running, next, later])
    expect(history.past).toEqual([newer, past, older])
  })
})
