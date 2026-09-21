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

const percentages = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })

/** A rate in basis points the way the printed document writes it: "19 %". */
export function percent(basisPoints: number): string {
  return `${percentages.format(basisPoints / 100)} %`
}

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

const twoPlaces = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Cents as a figure to edit: no currency sign, two places, the way it is typed. */
export function centsAsInput(cents: number): string {
  return twoPlaces.format(cents / 100)
}

/** The largest figure a column of the database holds, a signed 32 bit integer. */
export const largestStored = 2_147_483_647

/**
 * A number the way somebody in Germany types it, scaled to whole units of a
 * given size: thousandths for a quantity, cents for a price. Null when it is
 * not a number, has more places than the unit holds, or does not fit.
 *
 * A comma is the decimal separator, and then every dot is a thousands
 * separator: "1.234,5" is one thousand two hundred and thirty-four and a
 * half. Without a comma a single dot is read as a decimal point unless
 * exactly three digits follow it, because "2.5" is a slip on an English
 * keyboard and "1.234" is how a thousand is written here.
 *
 * Not `parseFloat`. It stops at the first character it does not know and
 * reads "1.234,56" as 1.234, which on an invoice is a price off by a factor
 * of a thousand.
 */
export function scaledNumber(input: string, places: number): number | null {
  // Spaces go, the no-break space a copied amount often carries among them,
  // which `\s` covers in JavaScript. So does a euro sign typed along.
  const compact = input.replaceAll(/[\s€]/g, '')

  if (!/^[+-]?[\d.,]+$/.test(compact) || (compact.match(/,/g)?.length ?? 0) > 1) {
    return null
  }

  const sign = compact.startsWith('-') ? -1 : 1
  const digits = compact.replace(/^[+-]/, '')
  const dots = digits.match(/\./g)?.length ?? 0

  const normal = digits.includes(',')
    ? digits.replaceAll('.', '').replace(',', '.')
    : dots === 1 && !/\.\d{3}$/.test(digits)
      ? digits
      : digits.replaceAll('.', '')

  const [whole = '', fraction = ''] = normal.split('.')

  if ((whole === '' && fraction === '') || fraction.length > places) {
    return null
  }

  const scaled = Number(whole || '0') * 10 ** places + Number(fraction.padEnd(places, '0'))

  if (!Number.isSafeInteger(scaled) || scaled > largestStored) {
    return null
  }

  // "-0" is zero, and a zero that prints with a minus sign is a question.
  return scaled === 0 ? 0 : sign * scaled
}

/** A quantity as typed, in thousandths. */
export function parseQuantity(input: string): number | null {
  return scaledNumber(input, 3)
}

/** An amount in euros as typed, in cents. */
export function parseEuros(input: string): number | null {
  return scaledNumber(input, 2)
}

/**
 * Today, in the time zone of the businesses this is written for. Not the
 * browser's clock read as UTC: shortly after midnight that is still
 * yesterday, and a document dated yesterday is a different document.
 */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now)
}
