/**
 * A postal address, kept inline on whoever owns one. A customer has a billing
 * address, a site has the address the van drives to, and the two are often
 * different: a property management company sits in one city and its buildings
 * stand in another.
 */
export interface Address {
  readonly street: string | null
  readonly houseNumber: string | null
  readonly postalCode: string | null
  readonly city: string | null
  /** ISO 3166-1 alpha-2, `DE` unless stated otherwise. */
  readonly country: string
}

/**
 * The countries the office chooses from for an address (#144): Germany first,
 * then the countries of the European Economic Area, Switzerland and the United
 * Kingdom, the ones a business in Germany works for now and then.
 *
 * The country decides with whether a customer gets an e-invoice, and it is
 * printed on a document for anybody outside Germany. What a customer abroad
 * needs beyond that, a delivery into another member state, the check of a
 * VAT id or an export, is phase 3 in the concept and not here.
 */
export const countryChoices = [
  'DE',
  'AT',
  'BE',
  'BG',
  'CH',
  'CY',
  'CZ',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const

/**
 * What is wrong with the country of an address, as a sentence, or null.
 *
 * A code of ISO 3166-1, two capital letters, which is what the e-invoice
 * carries and what the database holds to. Not limited to `countryChoices`:
 * the choices are what the form offers, and an address written elsewhere may
 * name another country correctly.
 */
export function countryProblem(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value)
    ? null
    : 'Das Land steht als Ländercode aus zwei Großbuchstaben da, etwa DE.'
}
