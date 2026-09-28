import type { Address } from './address.js'
import type { Id, Synced } from './identifier.js'

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
  readonly email: string | null
  readonly phone: string | null
  readonly notes: string | null
}

/** The longest a name or a customer number may be, as the forms and the routes hold it. */
export const supplierLimits = {
  name: 200,
  customerNumber: 40,
} as const

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

  const number = supplier['customerNumber']

  if (typeof number === 'string' && number.trim().length > supplierLimits.customerNumber) {
    problems['customerNumber'] =
      `Eine Kundennummer hat höchstens ${String(supplierLimits.customerNumber)} Zeichen.`
  }

  return problems
}
