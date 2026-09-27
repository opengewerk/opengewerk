import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { IsoDate } from '../model/identifier.js'
import { addDays } from '../rules/payment.js'
import { coreDeadlineKinds } from './core.js'
import {
  actionsSentence,
  type DeadlineKind,
  deadlineRegistry,
  defaultResponsibleLabel,
  DeadlineRegistryError,
  intervalOf,
  intervalProblem,
  kindProblems,
  leadOf,
  leadProblem,
  remindOn,
  sourceWords,
  taskTitleOf,
} from './deadline.js'

const followUp: DeadlineKind = {
  key: 'quote.follow_up',
  trade: null,
  title: 'Wiedervorlage eines Angebots',
  about: 'Ein offenes Angebot kommt wieder vor.',
  source: 'quote',
  intervalDays: 14,
  leadDays: 0,
  responsible: 'source',
  actions: ['task'],
  taskTitle: 'Angebot {quelle} nachfassen',
}

describe('the kinds of the core', () => {
  it('pass the registry', () => {
    expect(() => deadlineRegistry(coreDeadlineKinds)).not.toThrow()
  })

  it('know no trade', () => {
    // The core names no kind of any trade (ADR 0008): the kinds of Elektro
    // come from its package, and so will those of every other.
    for (const kind of coreDeadlineKinds) {
      expect(kind.trade).toBeNull()
      expect(kind.key.startsWith('elektro.')).toBe(false)
    }
  })

  it('bring the follow-up of an open quote, two weeks after it went out', () => {
    const kind = deadlineRegistry(coreDeadlineKinds).kind('quote.follow_up')

    expect(kind).toMatchObject({
      source: 'quote',
      intervalDays: 14,
      leadDays: 0,
      actions: ['task'],
    })
  })
})

describe('the registry', () => {
  it('puts the kinds of a trade package next to those of the core', () => {
    const trade: DeadlineKind = {
      ...followUp,
      key: 'elektro.probe',
      trade: 'elektro',
      title: 'Probe',
    }

    const registry = deadlineRegistry([...coreDeadlineKinds, trade])

    expect(registry.kind('elektro.probe')?.trade).toBe('elektro')
    expect(registry.kinds.map((kind) => kind.key)).toContain('quote.follow_up')
  })

  it('refuses two kinds with one key', () => {
    expect(() => deadlineRegistry([followUp, followUp])).toThrow(DeadlineRegistryError)
  })

  it('refuses a trade kind whose key does not name the trade', () => {
    expect(kindProblems({ ...followUp, key: 'probe.kind', trade: 'elektro' })).toHaveLength(1)
  })

  it('refuses a key without a dot, an unknown action and a task title without the source', () => {
    expect(kindProblems({ ...followUp, key: 'followup' })).toHaveLength(1)
    expect(
      kindProblems({ ...followUp, actions: ['task', 'fax' as never] }).some((problem) =>
        problem.includes('fax'),
      ),
    ).toBe(true)
    expect(kindProblems({ ...followUp, taskTitle: 'Nachfassen' })).toHaveLength(1)
  })

  it('refuses a kind that does nothing', () => {
    expect(kindProblems({ ...followUp, actions: [] })).toHaveLength(1)
  })

  it('refuses a lead or an interval out of bounds', () => {
    expect(kindProblems({ ...followUp, leadDays: -1 })).toHaveLength(1)
    expect(kindProblems({ ...followUp, intervalDays: 0 })).toHaveLength(1)
  })
})

describe('the lead and the interval', () => {
  it('take the deadline first, then the business, then the kind', () => {
    const setting = { kind: followUp.key, leadDays: 3, intervalDays: 21, responsibleUserId: null }

    expect(leadOf(followUp, null, null)).toBe(0)
    expect(leadOf(followUp, setting, null)).toBe(3)
    expect(leadOf(followUp, setting, 7)).toBe(7)
    // Zero is a lead of its own, not "nothing set".
    expect(leadOf(followUp, setting, 0)).toBe(0)
    expect(intervalOf(followUp, null)).toBe(14)
    expect(intervalOf(followUp, setting)).toBe(21)
  })

  it('has no interval where the source names the day', () => {
    const named = { ...followUp, intervalDays: null }

    expect(
      intervalOf(named, {
        kind: named.key,
        leadDays: null,
        intervalDays: 30,
        responsibleUserId: null,
      }),
    ).toBeNull()
  })

  it('says what is wrong with a number', () => {
    expect(leadProblem(0)).toBeNull()
    expect(leadProblem(365)).toBeNull()
    expect(leadProblem(366)).toContain('365')
    expect(leadProblem(1.5)).toContain('ganze Zahl')
    expect(intervalProblem(1)).toBeNull()
    expect(intervalProblem(0)).toContain('mindestens 1')
  })

  it('reminds its lead before the day it is due, across a month and a year', () => {
    expect(remindOn('2026-10-03' as IsoDate, 5)).toBe('2026-09-28')
    expect(remindOn('2027-01-10' as IsoDate, 20)).toBe('2026-12-21')
    expect(remindOn('2026-10-03' as IsoDate, 0)).toBe('2026-10-03')
  })

  it('always lands the lead back on the due day', () => {
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

describe('the task a deadline makes', () => {
  it('names its source', () => {
    expect(taskTitleOf(followUp, 'A-2026-0091')).toBe('Angebot A-2026-0091 nachfassen')
  })
})

describe('the words of the settings', () => {
  it('name the default person of a kind', () => {
    expect(defaultResponsibleLabel(followUp)).toBe('Wer das Angebot festgeschrieben hat')
    expect(defaultResponsibleLabel({ ...followUp, responsible: 'owner' })).toBe('Der Inhaber')
  })

  it('say what a kind does in one sentence', () => {
    expect(actionsSentence(['task'])).toBe(
      'Bei Fälligkeit: eine Aufgabe für die verantwortliche Person.',
    )
    expect(actionsSentence(['task', 'reminder'])).toBe(
      'Bei Fälligkeit: eine Aufgabe und eine Erinnerung per E-Mail und Push für die verantwortliche Person.',
    )
    expect(actionsSentence(['service_job'])).toBe('Bei Fälligkeit: ein Serviceauftrag im Entwurf.')
    expect(actionsSentence(['task', 'service_job', 'status'])).toBe(
      'Bei Fälligkeit: eine Aufgabe, ein Serviceauftrag im Entwurf und ein neuer Stand an der Quelle für die verantwortliche Person.',
    )
  })

  it('have words for every source', () => {
    expect(sourceWords.quote.interval.label).toBe('Wiedervorlage nach')
  })
})
