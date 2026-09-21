import type { Address } from './address.js'
import type { FileId, LetterheadId, TenantOwned } from './identifier.js'

/**
 * What a business puts at the top and the bottom of every document it sends.
 *
 * One per business, and it belongs to the settings rather than to a document:
 * nobody types their bank details into an invoice. The template that shapes a
 * document lives in the repository, and what a business contributes is what
 * is true about itself. That is the cut the issue made, and it leaves no
 * editor for templates to build.
 *
 * Nothing here carries a period of validity, unlike the tax parameters, and it
 * does not need one. A document takes a copy of all of this at the moment it
 * is issued, so a business that moves writes its next invoice from the new
 * address and leaves every earlier one where it was.
 *
 * Every field may be empty while nothing has been issued. Which of them an
 * invoice cannot do without is decided by `missingDetails`, at the moment it
 * matters and with a sentence saying which one.
 */
export interface Letterhead extends TenantOwned, Address {
  readonly id: LetterheadId
  /**
   * The name the business trades under, in full. Section 14 (4) number 1 UStG
   * asks for the complete name, which for a sole trader includes a first and a
   * family name. Empty means the name the business was set up with.
   */
  readonly companyName: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly website: string | null
  /** Steuernummer, as the tax office issued it. */
  readonly taxNumber: string | null
  /** Umsatzsteuer-Identifikationsnummer, `DE123456789`. */
  readonly vatId: string | null
  readonly iban: string | null
  readonly bic: string | null
  readonly bankName: string | null
  /** Registergericht, for a business in the commercial register. */
  readonly registerCourt: string | null
  /** Handelsregisternummer, `HRB 12345`. */
  readonly registerNumber: string | null
  /**
   * Who represents the business, as it has to appear on its letters: the
   * managing directors of a GmbH, the owner of an e. K. Free text, because
   * the legal forms say it in different words.
   */
  readonly managingDirectors: string | null
  readonly logoFileId: FileId | null
}

/**
 * The fields a business writes, in the order the settings screen shows them.
 * The server reads a body through this list and nothing else.
 */
export const letterheadFields = [
  'companyName',
  'street',
  'houseNumber',
  'postalCode',
  'city',
  'country',
  'phone',
  'email',
  'website',
  'taxNumber',
  'vatId',
  'iban',
  'bic',
  'bankName',
  'registerCourt',
  'registerNumber',
  'managingDirectors',
] as const

export type LetterheadField = (typeof letterheadFields)[number]

/**
 * The media types a logo may have.
 *
 * PNG and JPEG and nothing else. SVG would print the sharpest, and it is also
 * a document that can carry script: shown on the settings screen from the
 * application's own address, it would run there with the owner's session. The
 * renderer would be safe, the browser would not, and a logo is not worth a way
 * past the content security policy.
 */
export const logoMediaTypes = ['image/png', 'image/jpeg'] as const

export type LogoMediaType = (typeof logoMediaTypes)[number]

/** The largest logo the store takes, in bytes. A logo is not a photo. */
export const largestLogoBytes = 1_000_000

/**
 * Whether an IBAN adds up, by the check digits every IBAN carries (ISO 13616,
 * modulo 97). It does not say the account exists, only that nothing was
 * mistyped, and a mistyped IBAN in a letterhead is printed on every invoice
 * until a customer's transfer bounces.
 *
 * Spaces are ignored, because an IBAN is usually typed in groups of four.
 */
export function ibanIsValid(value: string): boolean {
  const compact = value.replaceAll(/\s+/g, '').toUpperCase()

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
    return false
  }

  // The first four characters move to the end, letters become numbers from
  // ten upwards, and the whole is taken modulo 97 piece by piece, because it
  // is far longer than a number JavaScript can hold exactly.
  const rearranged = compact.slice(4) + compact.slice(0, 4)
  let remainder = 0

  for (const character of rearranged) {
    const digits = /\d/.test(character) ? character : String(character.charCodeAt(0) - 55)

    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }

  return remainder === 1
}
