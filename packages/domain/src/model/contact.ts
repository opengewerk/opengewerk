import type { Synced } from '@opengewerk/platform-domain'
import type { ContactId, CustomerId, SiteId } from './identifier.js'
import type { SupplierId } from './supplier.js'

/**
 * A person to talk to. Hangs off a customer (site manager, accounting), off a
 * single site (tenant, caretaker) or, since #296, off a supplier (the desk
 * that takes orders): off exactly one of them, never off none.
 */
export interface Contact extends Synced {
  readonly id: ContactId
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly supplierId: SupplierId | null
  readonly givenName: string | null
  readonly familyName: string
  /** Free text such as `Bauleiter` or `Hausmeister`, not a fixed list. */
  readonly role: string | null
  readonly email: string | null
  readonly phone: string | null
}

/** The two ways a contact can miss the one place the model gives it. */
export type ContactParentProblem = 'none' | 'several'

/**
 * Whether a contact hangs on exactly one customer, site or supplier, judged
 * from the three fields as they stand; null when it does.
 *
 * One function for a form, the sync and the routes, so that all of them read
 * the rule the check `contacts_belong_to_one_parent` holds in the database the
 * same way. An empty string counts as empty, the way a form hands over a field
 * nobody filled in.
 */
export function contactParentProblem(contact: {
  readonly customerId?: unknown
  readonly siteId?: unknown
  readonly supplierId?: unknown
}): ContactParentProblem | null {
  const parents = [contact.customerId, contact.siteId, contact.supplierId].filter(named).length

  if (parents > 1) {
    return 'several'
  }

  return parents === 1 ? null : 'none'
}

function named(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/** The sentence for each, as a form shows it and the sync refuses with it. */
export const contactParentText: Readonly<Record<ContactParentProblem, string>> = {
  none: 'Ein Kontakt gehört zu einem Kunden, einem Objekt oder einem Lieferanten, dieser zu keinem davon.',
  several:
    'Ein Kontakt gehört zu einem Kunden, einem Objekt oder einem Lieferanten, nicht zu mehreren zugleich.',
}
