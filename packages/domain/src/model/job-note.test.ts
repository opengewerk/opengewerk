import { describe, expect, it } from 'vitest'

import { syncPolicies } from '../sync/policy.js'
import { jobNoteProblem, longestJobNote, noteTimeProblem } from './job-note.js'

describe('a note from the site (#220)', () => {
  it('says something, and not more than a text in a form may', () => {
    expect(jobNoteProblem('Zähler getauscht, Plombe fehlt noch.')).toBeNull()
    expect(jobNoteProblem('')).toBe('Eine Notiz braucht einen Text.')
    expect(jobNoteProblem('   \n ')).toBe('Eine Notiz braucht einen Text.')
    expect(jobNoteProblem(null)).toBe('Eine Notiz braucht einen Text.')
    expect(jobNoteProblem('x'.repeat(longestJobNote))).toBeNull()
    expect(jobNoteProblem('x'.repeat(longestJobNote + 1))).toBe(
      'Eine Notiz hat höchstens 4000 Zeichen.',
    )
  })

  it('carries the moment it was written, by the clock of the device', () => {
    expect(noteTimeProblem('2026-09-25T10:42:00.000Z')).toBeNull()
    expect(noteTimeProblem(new Date('2026-09-25T10:42:00Z'))).toBeNull()
    expect(noteTimeProblem('gestern')).toBe(
      'Eine Notiz braucht die Uhrzeit, zu der sie geschrieben wurde.',
    )
    expect(noteTimeProblem(undefined)).toBe(
      'Eine Notiz braucht die Uhrzeit, zu der sie geschrieben wurde.',
    )
  })

  it('is written on a device and never changed, with its author the server writes', () => {
    expect(syncPolicies['job_notes']).toEqual({
      create: true,
      change: 'never',
      reserved: ['createdBy'],
    })
  })
})
