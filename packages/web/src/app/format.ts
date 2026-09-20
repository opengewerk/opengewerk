import type { RecordState } from '@opengewerk/domain'

import { maybeText } from '../sync/fields.js'

/**
 * Numbers and dates the way they are written in Germany, and nowhere else in
 * the application.
 *
 * The formatters are built once. `Intl.NumberFormat` is expensive to
 * construct and cheap to use, and a table of four hundred rows builds one per
 * cell if the call sits inside the render.
 *
 * The locale is fixed rather than taken from the browser. An amount is part of
 * a document that has to look the same to the person who wrote it and to the
 * tax office that reads it later, and a browser set to English would quietly
 * move the decimal separator in an invoice.
 */

const money = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
})

const quantity = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

const day = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
const dayAndTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

/** Cents into euros. The storage is integral, the display is not. */
export function euros(cents: number): string {
  return money.format(cents / 100)
}

/** Thousandths into a countable amount, as `quantityMilli` holds them. */
export function amount(milli: number): string {
  return quantity.format(milli / 1000)
}

export function date(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return ''
  }

  const at = new Date(value)

  return Number.isNaN(at.getTime()) ? '' : day.format(at)
}

export function moment(value: Date | string | null): string {
  if (value === null) {
    return ''
  }

  const at = typeof value === 'string' ? new Date(value) : value

  return Number.isNaN(at.getTime()) ? '' : dayAndTime.format(at)
}

/**
 * An address on one line, leaving out whatever is missing.
 *
 * Every part of an address is optional in the model except the country, which
 * is how a call out to a building with no house number is recorded at all.
 * Joining blindly would produce ", 68535" on those.
 */
export function addressLine(record: RecordState | null): string {
  if (!record) {
    return ''
  }

  const street = [maybeText(record, 'street'), maybeText(record, 'houseNumber')]
    .filter(Boolean)
    .join(' ')
  const town = [maybeText(record, 'postalCode'), maybeText(record, 'city')]
    .filter(Boolean)
    .join(' ')

  return [street, town].filter(Boolean).join(', ')
}

/**
 * How long ago something happened, in words.
 *
 * Used by the sync bar, where the exact second is noise and "vor einer
 * Minute" is the answer to the question somebody actually has.
 */
export function sinceThen(then: Date | null, now: Date = new Date()): string {
  if (!then) {
    return 'noch nie'
  }

  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))

  if (seconds < 60) {
    return 'gerade eben'
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return `vor ${String(minutes)} Minute${minutes === 1 ? '' : 'n'}`
  }

  const hours = Math.round(minutes / 60)

  if (hours < 24) {
    return `vor ${String(hours)} Stunde${hours === 1 ? '' : 'n'}`
  }

  return `am ${day.format(then)}`
}
