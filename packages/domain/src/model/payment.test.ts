import { describe, expect, it } from 'vitest'

import type { IsoDate } from './identifier.js'
import { paymentProblem, receivesPayments } from './payment.js'

const today = '2026-09-24' as IsoDate

describe('a payment as it is typed (#189)', () => {
  it('is whole cents over nothing on a day that has been', () => {
    expect(paymentProblem({ amountCents: 238_000, receivedOn: '2026-09-24' }, today)).toBeNull()
    expect(paymentProblem({ amountCents: 1, receivedOn: '2026-01-02' }, today)).toBeNull()
  })

  it('is refused for an amount of nothing, below it, or in fractions of a cent', () => {
    for (const amountCents of [0, -500, 12.5, '100', null]) {
      expect(paymentProblem({ amountCents, receivedOn: '2026-09-01' }, today)).toBe(
        'Der Betrag ist ein Betrag in Euro und Cent über null.',
      )
    }
  })

  it('is refused on a day that is none, or one still to come', () => {
    expect(paymentProblem({ amountCents: 100, receivedOn: '2026-02-30' }, today)).toBe(
      'Der Tag des Eingangs ist kein Datum.',
    )
    expect(paymentProblem({ amountCents: 100, receivedOn: '24.09.2026' }, today)).toBe(
      'Der Tag des Eingangs ist kein Datum.',
    )
    expect(paymentProblem({ amountCents: 100, receivedOn: '2026-09-25' }, today)).toBe(
      'Ein Eingang liegt nicht in der Zukunft.',
    )
  })
})

describe('what a payment is recorded on', () => {
  it('is an invoice that asks for money, and nothing that gives back', () => {
    expect(receivesPayments('progress_invoice')).toBe(true)
    expect(receivesPayments('final_invoice')).toBe(true)
    expect(receivesPayments('cancellation_invoice')).toBe(false)
    expect(receivesPayments('quote')).toBe(false)
  })
})
