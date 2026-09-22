import { describe, expect, it } from 'vitest'

import { paymentTermOf } from '../rules/payment.js'
import { documentKinds } from './document.js'
import {
  carriesDueDate,
  defaultPaymentTermDays,
  longestPaymentTermDays,
  paymentTermLabel,
  paymentTermProblem,
  paymentTermText,
  statesPaymentTerm,
} from './payment-term.js'

const owed = { grossCents: 119_000 }

describe('a payment term somebody enters', () => {
  it('is a whole number of days from zero to a year', () => {
    expect(paymentTermProblem(0)).toBeNull()
    expect(paymentTermProblem(defaultPaymentTermDays)).toBeNull()
    expect(paymentTermProblem(longestPaymentTermDays)).toBeNull()
  })

  it('is refused below zero, beyond a year, as a fraction and as anything but a number', () => {
    for (const wrong of [-1, longestPaymentTermDays + 1, 1400]) {
      expect(paymentTermProblem(wrong)).toBe(
        'Das Zahlungsziel liegt zwischen 0 und 365 Tagen, 0 heißt sofort zahlbar.',
      )
    }

    for (const wrong of [1.5, Number.NaN, '14', null, undefined]) {
      expect(paymentTermProblem(wrong)).toBe('Das Zahlungsziel ist eine ganze Zahl von Tagen.')
    }
  })

  it('is fourteen days before the business has set one', () => {
    expect(defaultPaymentTermDays).toBe(14)
  })
})

describe('which documents state a payment term', () => {
  it('is every kind that asks for money and the three the work is agreed on', () => {
    expect(documentKinds.filter(statesPaymentTerm)).toEqual([
      'cost_estimate',
      'quote',
      'order_confirmation',
      'progress_invoice',
      'partial_invoice',
      'final_invoice',
      'recurring_invoice',
    ])
  })

  it('gives a due date only to the kinds that ask for payment now', () => {
    expect(documentKinds.filter(carriesDueDate)).toEqual([
      'progress_invoice',
      'partial_invoice',
      'final_invoice',
      'recurring_invoice',
    ])
  })
})

describe('the payment term of a document', () => {
  it('turns into the day payment is due on an invoice, counted from its date', () => {
    expect(paymentTermOf('final_invoice', 14, '2026-09-22', owed)).toEqual({
      days: 14,
      dueOn: '2026-10-06',
    })
    // Across the end of a month and a year, without a time zone in the way.
    expect(paymentTermOf('progress_invoice', 30, '2026-12-15', owed)).toEqual({
      days: 30,
      dueOn: '2027-01-14',
    })
    expect(paymentTermOf('final_invoice', 0, '2026-09-22', owed)).toEqual({
      days: 0,
      dueOn: '2026-09-22',
    })
  })

  it('stays a number of days on a quote, whose invoice has no date yet', () => {
    expect(paymentTermOf('quote', 30, '2026-09-22', owed)).toEqual({ days: 30, dueOn: null })
    expect(paymentTermOf('order_confirmation', 14, '2026-09-22', owed)).toEqual({
      days: 14,
      dueOn: null,
    })
  })

  it('is not stated where nothing is asked for', () => {
    expect(paymentTermOf('time_and_material_report', 14, '2026-09-22', owed)).toBeNull()
    expect(paymentTermOf('cancellation_invoice', 14, '2026-09-22', owed)).toBeNull()
    expect(paymentTermOf('credit_note', 14, '2026-09-22', owed)).toBeNull()
    expect(paymentTermOf('delivery_note', 14, '2026-09-22', owed)).toBeNull()
    // A final invoice the progress invoices billed in full, and one that
    // comes out below zero.
    expect(paymentTermOf('final_invoice', 14, '2026-09-22', { grossCents: 0 })).toBeNull()
    expect(paymentTermOf('final_invoice', 14, '2026-09-22', { grossCents: -500 })).toBeNull()
  })
})

describe('what a document prints about its payment term', () => {
  it('names the day on an invoice', () => {
    expect(paymentTermText({ days: 14, dueOn: '2026-10-06' })).toBe(
      'Zahlbar ohne Abzug bis zum 06.10.2026.',
    )
    expect(paymentTermText({ days: 0, dueOn: '2026-09-22' })).toBe('Zahlbar sofort ohne Abzug.')
  })

  it('names the days after the invoice on a quote', () => {
    expect(paymentTermText({ days: 30, dueOn: null })).toBe(
      'Zahlungsbedingungen: zahlbar innerhalb von 30 Tagen nach Rechnungsstellung ohne Abzug.',
    )
    expect(paymentTermText({ days: 1, dueOn: null })).toBe(
      'Zahlungsbedingungen: zahlbar innerhalb von einem Tag nach Rechnungsstellung ohne Abzug.',
    )
    expect(paymentTermText({ days: 0, dueOn: null })).toBe(
      'Zahlungsbedingungen: zahlbar sofort nach Rechnungsstellung ohne Abzug.',
    )
  })

  it('says the days in the words of the screen', () => {
    expect(paymentTermLabel(14)).toBe('14 Tage')
    expect(paymentTermLabel(1)).toBe('1 Tag')
    expect(paymentTermLabel(0)).toBe('sofort')
  })
})
