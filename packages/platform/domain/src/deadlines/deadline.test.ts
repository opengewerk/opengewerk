import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { addDays } from '../model/calendar.js'
import type { IsoDate } from '../model/identifier.js'
import {
  addInterval,
  type DeadlineCatalogue,
  type DeadlineKind,
  deadlineKindProblems,
  deadlineRegistry,
  DeadlineRegistryError,
  intervalMonthsProblem,
  intervalOf,
  intervalProblem,
  leadOf,
  leadProblem,
  remindOn,
} from './deadline.js'

/**
 * The kinds of an application nobody runs: at the desk of the probe
 * application a parcel waits to be picked up within a week, and a check of
 * the fire doors comes round every six months. The desk is a field the
 * application gives its kinds of its own, and a check of its own goes with
 * it.
 */
type ProbeSource = 'parcel' | 'door'
type ProbeAction = 'reminder' | 'note'

interface ProbeKind extends DeadlineKind<ProbeSource, ProbeAction> {
  readonly desk: string | null
}

const pickup: ProbeKind = {
  key: 'parcel.pickup',
  title: 'Abholung',
  about: 'Ein Paket am Empfang wird binnen einer Woche abgeholt.',
  source: 'parcel',
  intervalDays: 7,
  leadDays: 1,
  responsible: 'source',
  actions: ['reminder'],
  desk: null,
}

const doors: ProbeKind = {
  key: 'east.fire_doors',
  title: 'Prüfung der Brandschutztüren',
  about: 'Die Türen werden alle sechs Monate geprüft.',
  source: 'door',
  intervalDays: null,
  intervalMonths: 6,
  leadDays: 14,
  responsible: 'lead',
  actions: ['reminder', 'note'],
  desk: 'east',
}

const catalogue: DeadlineCatalogue<ProbeKind> = {
  sources: ['parcel', 'door'],
  actions: ['reminder', 'note'],
  problems: (kind) =>
    kind.desk !== null && !kind.key.startsWith(`${kind.desk}.`)
      ? [`${kind.key}: ein Typ vom Empfang ${kind.desk} beginnt mit "${kind.desk}.".`]
      : [],
}

function problemsOf(kind: Partial<ProbeKind>): readonly string[] {
  return deadlineKindProblems({ ...pickup, ...kind } as ProbeKind, catalogue)
}

describe('the registry', () => {
  it('takes the kinds of an application and keeps the fields it gives them', () => {
    const registry = deadlineRegistry([pickup, doors], catalogue)

    expect(registry.kinds.map((kind) => kind.key)).toEqual(['parcel.pickup', 'east.fire_doors'])
    expect(registry.kind('east.fire_doors')?.desk).toBe('east')
    expect(registry.kind('parcel.lost')).toBeNull()
  })

  it('refuses two kinds with one key, and says which', () => {
    expect(() => deadlineRegistry([pickup, pickup], catalogue)).toThrow(DeadlineRegistryError)
    expect(() => deadlineRegistry([pickup, pickup], catalogue)).toThrow('parcel.pickup')
  })

  it('refuses a key without a dot, a source and an action the application does not have', () => {
    expect(problemsOf({ key: 'pickup' })).toHaveLength(1)
    expect(problemsOf({ source: 'letter' as ProbeSource })).toEqual([
      'parcel.pickup: die Quelle letter gibt es nicht.',
    ])
    expect(problemsOf({ actions: ['reminder', 'fax' as ProbeAction] })).toEqual([
      'parcel.pickup: die Aktion fax gibt es nicht.',
    ])
  })

  it('refuses a kind that does nothing, and one that does a thing twice', () => {
    expect(problemsOf({ actions: [] })).toHaveLength(1)
    expect(problemsOf({ actions: ['reminder', 'reminder'] })).toHaveLength(1)
  })

  it('refuses a default person it does not know, and a kind without a title', () => {
    expect(problemsOf({ responsible: 'owner' as never })).toHaveLength(1)
    expect(problemsOf({ title: ' ' })).toHaveLength(1)
  })

  it('refuses a lead and an interval out of bounds, in days and in months', () => {
    expect(problemsOf({ leadDays: -1 })).toHaveLength(1)
    expect(problemsOf({ intervalDays: 0 })).toHaveLength(1)
    expect(problemsOf({ intervalDays: null, intervalMonths: 0 })).toHaveLength(1)
    expect(problemsOf({ intervalDays: null, intervalMonths: 601 })).toHaveLength(1)
    expect(problemsOf({ intervalDays: null, intervalMonths: 600 })).toEqual([])
  })

  it('refuses an interval in days and in months at once', () => {
    expect(problemsOf({ intervalDays: 7, intervalMonths: 1 })).toEqual([
      'parcel.pickup: die Frist zählt in Tagen oder in Monaten, nicht in beiden.',
    ])
  })

  it('adds what the application finds wrong with a kind', () => {
    expect(deadlineKindProblems({ ...doors, key: 'west.fire_doors' }, catalogue)).toEqual([
      'west.fire_doors: ein Typ vom Empfang east beginnt mit "east.".',
    ])
    expect(() => deadlineRegistry([{ ...doors, key: 'west.fire_doors' }], catalogue)).toThrow(
      DeadlineRegistryError,
    )
  })
})

describe('the interval', () => {
  const setting = {
    kind: pickup.key,
    leadDays: 3,
    intervalDays: 10,
    intervalMonths: 3,
    responsibleUserId: null,
  }

  it('is the one the tenant set for the kind, else the one of the kind, in its unit', () => {
    expect(intervalOf(pickup, null)).toEqual({ days: 7 })
    expect(intervalOf(pickup, setting)).toEqual({ days: 10 })
    expect(intervalOf(doors, null)).toEqual({ months: 6 })
    expect(intervalOf(doors, setting)).toEqual({ months: 3 })
  })

  it('is none where the source names the day, whatever the tenant set', () => {
    expect(intervalOf({ ...pickup, intervalDays: null }, setting)).toBeNull()
  })

  it('ends on its day, in days and in months', () => {
    expect(addInterval('2026-10-03' as IsoDate, { days: 7 })).toBe('2026-10-10')
    expect(addInterval('2026-08-31' as IsoDate, { months: 6 })).toBe('2027-02-28')
  })

  it('says what is wrong with a number', () => {
    expect(intervalProblem(1)).toBeNull()
    expect(intervalProblem(0)).toContain('mindestens 1')
    expect(intervalProblem(366)).toContain('365')
    expect(intervalMonthsProblem(12)).toBeNull()
    expect(intervalMonthsProblem(1.5)).toContain('ganze Zahl von Monaten')
    expect(intervalMonthsProblem(601)).toContain('600')
  })
})

describe('the lead', () => {
  it('is the one of the deadline first, then the one of the tenant, then the one of the kind', () => {
    const setting = {
      kind: pickup.key,
      leadDays: 3,
      intervalDays: null,
      intervalMonths: null,
      responsibleUserId: null,
    }

    expect(leadOf(pickup, null, null)).toBe(1)
    expect(leadOf(pickup, setting, null)).toBe(3)
    expect(leadOf(pickup, setting, 7)).toBe(7)
    // Zero is a lead of its own, not "nothing set".
    expect(leadOf(pickup, setting, 0)).toBe(0)
  })

  it('says what is wrong with a number', () => {
    expect(leadProblem(0)).toBeNull()
    expect(leadProblem(365)).toBeNull()
    expect(leadProblem(366)).toContain('365')
    expect(leadProblem(1.5)).toContain('ganze Zahl')
  })

  it('reminds its lead before the day it is due, across a month and a year', () => {
    expect(remindOn('2026-10-03' as IsoDate, 5)).toBe('2026-09-28')
    expect(remindOn('2027-01-10' as IsoDate, 20)).toBe('2026-12-21')
    expect(remindOn('2026-10-03' as IsoDate, 0)).toBe('2026-10-03')
  })

  it('always lands back on the due day', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2000-01-01T00:00:00Z'),
          max: new Date('2099-12-31T00:00:00Z'),
          noInvalidDate: true,
        }),
        fc.integer({ min: 0, max: 365 }),
        (day, lead) => {
          const due = day.toISOString().slice(0, 10) as IsoDate

          expect(addDays(remindOn(due, lead), lead)).toBe(due)
        },
      ),
    )
  })
})
