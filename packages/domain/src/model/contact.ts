import {
  type ContactParentProblem,
  type ContactPerson,
  contactRules,
} from '@opengewerk/platform-domain'
import type { CustomerId, SiteId } from './identifier.js'
import type { SupplierId } from './supplier.js'

/**
 * A person to talk to. Hangs off a customer (site manager, accounting), off a
 * single site (tenant, caretaker) or, since #296, off a supplier (the desk
 * that takes orders): off exactly one of them, never off none.
 *
 * Who a contact is and how to reach them is the foundation's
 * (opengewerk-haustechnik#85); what one hangs on here is this application's.
 */
export interface Contact extends ContactPerson {
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly supplierId: SupplierId | null
}

/**
 * The rules of the contacts of this application, as the foundation makes them
 * from its three parents and its two sentences: one object for the forms, the
 * routes and the sync, so that all of them read the rule the check
 * `contacts_belong_to_one_parent` holds in the database the same way.
 */
export const tradeContacts = contactRules({
  parents: ['customerId', 'siteId', 'supplierId'],
  parentText: {
    none: 'Ein Kontakt gehört zu einem Kunden, einem Objekt oder einem Lieferanten, dieser zu keinem davon.',
    several:
      'Ein Kontakt gehört zu einem Kunden, einem Objekt oder einem Lieferanten, nicht zu mehreren zugleich.',
  },
})

/**
 * Whether a contact hangs on exactly one customer, site or supplier, judged
 * from the three fields as they stand; null when it does. An empty string
 * counts as empty, the way a form hands over a field nobody filled in.
 */
export function contactParentProblem(contact: {
  readonly customerId?: unknown
  readonly siteId?: unknown
  readonly supplierId?: unknown
}): ContactParentProblem | null {
  return tradeContacts.parentProblem(contact)
}

/** The sentence for each, as a form shows it and the sync refuses with it. */
export const contactParentText = tradeContacts.parentText
