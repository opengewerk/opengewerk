import { countryChoices, type RecordState } from '@opengewerk/domain'
import { maybeText } from '@opengewerk/platform-web/sync'

/**
 * The address of a customer or a site the way a letter from Germany writes
 * it, and the countries a form offers for one (#144).
 *
 * Numbers and dates are the foundation's (ADR 0010,
 * `@opengewerk/platform-web/format`). What is left here knows the fields of a
 * record of this application, and the list of countries its domain keeps.
 */

const regionNames = new Intl.DisplayNames(['de'], { type: 'region' })

/**
 * The German name of a country code, "Österreich" for `AT`, or the code
 * itself for one the browser has no name for.
 */
export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/**
 * The countries a form offers for an address (#144): Germany first, because
 * nearly every address is there, and the rest in the order of their German
 * names, which is the order somebody looks for them in.
 */
export const countryOptions: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'DE', label: countryName('DE') },
  ...countryChoices
    .filter((code) => code !== 'DE')
    .map((code) => ({ value: code, label: countryName(code) }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de')),
]

/**
 * An address on one line, leaving out whatever is missing.
 *
 * Every part of an address is optional in the model except the country, which
 * is how a call out to a building with no house number is recorded at all.
 * Joining blindly would produce ", 68535" on those. The country is named only
 * when it is not Germany, the way a letter from Germany writes it (#144).
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

  const country = maybeText(record, 'country')
  const abroad = country !== null && country !== 'DE' ? countryName(country) : null

  return [street, town, abroad].filter(Boolean).join(', ')
}
