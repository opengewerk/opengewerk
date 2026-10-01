import type { Address } from './address.js'
import type { Id, Synced } from '@opengewerk/platform-domain'

export type SupplierId = Id<'supplier'>

/**
 * A supplier of the business (#296): where it is, the business's own customer
 * number there, and whom to ask, as contacts like those of a customer.
 *
 * Master data like a customer: on every device, created through the outbox,
 * changed only at its route. What it sells and for how much is not here but
 * on the article (`SupplierArticle`, `PurchasePrice`), and its prices only the
 * owner and the office read (decided on 27.09.2026).
 */
export interface Supplier extends Synced, Address {
  readonly id: SupplierId
  readonly name: string
  /** The business's customer number at the supplier, as an order names it. */
  readonly customerNumber: string | null
  /**
   * A few letters for the supplier (#297), which an import from DATANORM
   * appends to an article number the business already uses: "1042-HAN".
   */
  readonly shortCode: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly notes: string | null
}

/** The longest a name or a customer number may be, as the forms and the routes hold it. */
export const supplierLimits = {
  name: 200,
  customerNumber: 40,
  shortCode: 8,
} as const

/** Capitals and digits, as a short code stands behind a number. */
const shortCodeShape = /^[A-ZÄÖÜ0-9]+$/

/**
 * What is wrong with the fields of a supplier, by field, as the form shows it
 * and the routes and the sync refuse it. Only the fields present are judged,
 * so that a change of one field is not refused for another nobody touched.
 */
export function supplierProblems(
  supplier: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  if ('name' in supplier) {
    const name = supplier['name']

    if (typeof name !== 'string' || name.trim() === '') {
      problems['name'] = 'Ein Lieferant braucht einen Namen.'
    } else if (name.trim().length > supplierLimits.name) {
      problems['name'] = `Ein Name hat höchstens ${String(supplierLimits.name)} Zeichen.`
    }
  }

  const shortCode = supplier['shortCode']

  // No short code is null, as the check of the database says; an empty field
  // is turned into null by the form before it asks.
  if (
    typeof shortCode === 'string' &&
    (shortCode.length > supplierLimits.shortCode || !shortCodeShape.test(shortCode))
  ) {
    problems['shortCode'] =
      `Ein Kürzel hat bis zu ${String(supplierLimits.shortCode)} Großbuchstaben oder Ziffern.`
  }

  const number = supplier['customerNumber']

  if (typeof number === 'string' && number.trim().length > supplierLimits.customerNumber) {
    problems['customerNumber'] =
      `Eine Kundennummer hat höchstens ${String(supplierLimits.customerNumber)} Zeichen.`
  }

  return problems
}

/**
 * The short code an import appends when the supplier has none of its own:
 * the first three letters or digits of its name, in capitals, "HAN" for
 * "Hansa Elektrogroßhandel", or "LIEF" when the name has none.
 */
export function shortCodeFrom(name: string): string {
  const letters = name.toLocaleUpperCase('de').replace(/[^A-ZÄÖÜ0-9]/g, '')

  return letters.slice(0, 3) || 'LIEF'
}
