import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { coreDeadlineKinds } from '../deadlines/core.js'
import {
  erasureKindOfDeadline,
  erasureKinds,
  erasureKindWords,
  erasureRequestProblem,
  mostErasuresAtOnce,
  prospectErasureLabel,
} from './erasure.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('a lead as the deletion names it', () => {
  it('says where it came from and when it was last in touch, and nothing about who', () => {
    expect(prospectErasureLabel({ source: 'email', lastContactOn: '2025-10-14' as IsoDate })).toBe(
      'Lead aus einer E-Mail, letzter Kontakt 14.10.2025',
    )
    expect(
      prospectErasureLabel({ source: 'referral', lastContactOn: '2025-10-02' as IsoDate }),
    ).toBe('Lead aus einer Empfehlung, letzter Kontakt 02.10.2025')
  })
})

describe('the kinds of erasure', () => {
  it('each have a kind of deadline that proposes them and deletes them when set to', () => {
    for (const kind of erasureKinds) {
      const deadline = coreDeadlineKinds.find(
        (entry) => entry.key === erasureKindWords[kind].deadline,
      )

      expect(deadline?.actions).toEqual(['erasure'])
      expect(deadline?.responsible).toBe('lead')
      expect(erasureKindOfDeadline(erasureKindWords[kind].deadline)).toBe(kind)
    }
  })

  it('are no other kind of deadline', () => {
    expect(erasureKindOfDeadline('quote.follow_up')).toBeNull()
    expect(coreDeadlineKinds.filter((kind) => kind.actions.includes('erasure')).length).toBe(
      erasureKinds.length,
    )
  })

  it('give a reason for the change log that the log takes', () => {
    for (const kind of erasureKinds) {
      const { reason } = erasureKindWords[kind]

      expect(reason).toBe(reason.trim())
      expect(reason.length).toBeGreaterThan(0)
      expect(reason.length).toBeLessThanOrEqual(500)
    }
  })
})

describe('a confirmation', () => {
  it('names a kind and the records that go', () => {
    expect(erasureRequestProblem({ kind: 'prospect', ids: [id(1), id(2)] })).toBeNull()
  })

  it('is refused for a kind the concept does not know', () => {
    expect(erasureRequestProblem({ kind: 'customer', ids: [id(1)] })).toContain('keine Art')
    expect(erasureRequestProblem(null)).toContain('keine Art')
  })

  it('is refused without a record, with too many, or with one that is no key', () => {
    expect(erasureRequestProblem({ kind: 'prospect', ids: [] })).toBe('Ausgewählt ist nichts.')
    expect(erasureRequestProblem({ kind: 'prospect' })).toBe('Ausgewählt ist nichts.')
    expect(
      erasureRequestProblem({
        kind: 'prospect',
        ids: Array.from({ length: mostErasuresAtOnce + 1 }, (_, n) => id(n)),
      }),
    ).toContain('höchstens')
    expect(erasureRequestProblem({ kind: 'prospect', ids: ['1 or 1=1'] })).toContain(
      'keine Kennung',
    )
  })

  it('is refused with a record twice, whatever the case of its letters', () => {
    const key = '0000000a-0000-4000-8000-000000000001'

    expect(erasureRequestProblem({ kind: 'prospect', ids: [key, key.toUpperCase()] })).toContain(
      'zweimal',
    )
  })
})
