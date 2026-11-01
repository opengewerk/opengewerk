import { describe, expect, it } from 'vitest'

import {
  qualificationCheck,
  qualificationKindProblems,
  qualificationLimits,
  qualificationProblems,
  qualificationStanding,
} from './qualification.js'

/**
 * The qualifications as a building block of the foundation (ADR 0012): what
 * a kind and a qualification have to carry, how one stands on a day, and
 * whether a person holds what a task requires.
 */

const held = (
  kindKey: string | null,
  validUntil: string | null,
  further: { ownKindId?: string | null; deletedAt?: Date | null } = {},
) => ({
  kindKey,
  ownKindId: further.ownKindId ?? null,
  validUntil,
  deletedAt: further.deletedAt ?? null,
})

describe('how a qualification stands', () => {
  it('holds through its last day, is near its end within the lead, and has run out after it', () => {
    expect(qualificationStanding({ validUntil: null }, '2026-10-17', 60)).toBe('valid')
    expect(qualificationStanding({ validUntil: '2027-03-31' }, '2026-10-17', 60)).toBe('valid')
    expect(qualificationStanding({ validUntil: '2026-12-16' }, '2026-10-17', 60)).toBe('expiring')
    expect(qualificationStanding({ validUntil: '2026-10-17' }, '2026-10-17', 60)).toBe('expiring')
    expect(qualificationStanding({ validUntil: '2026-10-16' }, '2026-10-17', 60)).toBe('expired')
  })
})

describe('whether a person holds what a task requires', () => {
  it('is held by one qualification of the kind that holds, also beside one that ran out', () => {
    expect(
      qualificationCheck([held('elektro.skilled', '2027-01-01')], 'elektro.skilled', '2026-10-17'),
    ).toBe('held')
    expect(
      qualificationCheck(
        [held('elektro.skilled', '2025-01-01'), held('elektro.skilled', null)],
        'elektro.skilled',
        '2026-10-17',
      ),
    ).toBe('held')
    expect(
      qualificationCheck([held(null, null, { ownKindId: 'k-own' })], 'k-own', '2026-10-17'),
    ).toBe('held')
  })

  it('has run out where every one of the kind ended before the day', () => {
    expect(
      qualificationCheck([held('elektro.skilled', '2026-10-16')], 'elektro.skilled', '2026-10-17'),
    ).toBe('expired')
  })

  it('is missing without one of the kind, and a qualification taken out counts for nothing', () => {
    expect(
      qualificationCheck([held('elektro.instructed', null)], 'elektro.skilled', '2026-10-17'),
    ).toBe('missing')
    expect(
      qualificationCheck(
        [held('elektro.skilled', null, { deletedAt: new Date('2026-10-01T00:00:00Z') })],
        'elektro.skilled',
        '2026-10-17',
      ),
    ).toBe('missing')
    expect(qualificationCheck([], 'elektro.skilled', '2026-10-17')).toBe('missing')
  })
})

describe('a kind of the tenant own', () => {
  it('asks for a label within its bound and one of the levels a person holds', () => {
    expect(
      qualificationKindProblems({ label: 'Hygieneschulung', level: 'instructed_person' }),
    ).toEqual({})
    expect(qualificationKindProblems({ label: '  ', level: 'approved_body' })).toEqual({
      label: 'Die Bezeichnung fehlt.',
      level:
        'Die Stufe ist eine unterwiesene Person, eine Fachkraft oder eine zur Prüfung befähigte Person.',
    })
    expect(
      qualificationKindProblems({
        label: 'x'.repeat(qualificationLimits.kindLabel + 1),
        level: 'skilled_person',
      }),
    ).toEqual({ label: `Höchstens ${String(qualificationLimits.kindLabel)} Zeichen.` })
  })
})

describe('a qualification', () => {
  it('names a person and exactly one kind, a last day where it has one, and a note within its bound', () => {
    expect(
      qualificationProblems({
        personId: 'u-1',
        kindKey: 'elektro.skilled',
        validUntil: '2027-03-31',
      }),
    ).toEqual({})
    expect(
      qualificationProblems({ personId: 'u-1', ownKindId: 'k-own', validUntil: null }),
    ).toEqual({})
    expect(
      qualificationProblems({
        personId: '',
        kindKey: 'elektro.skilled',
        ownKindId: 'k-own',
        validUntil: '31.03.2027',
        note: 'x'.repeat(qualificationLimits.note + 1),
      }),
    ).toEqual({
      personId: 'Wählen Sie die Person.',
      kind: 'Wählen Sie die Art der Qualifikation.',
      validUntil: 'Gültig bis ist ein Tag, geschrieben 2026-10-03, oder leer.',
      note: `Höchstens ${String(qualificationLimits.note)} Zeichen.`,
    })
    expect(qualificationProblems({ personId: 'u-1' })).toEqual({
      kind: 'Wählen Sie die Art der Qualifikation.',
    })
    expect(
      qualificationProblems({ personId: 'u-1', kindKey: 'x', validUntil: '2026-02-30' }),
    ).toEqual({
      validUntil: 'Gültig bis ist ein Tag, geschrieben 2026-10-03, oder leer.',
    })
  })
})
