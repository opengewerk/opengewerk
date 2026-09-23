import type { ContactId, CustomerId, SiteId, Synced } from './identifier.js'

/**
 * A person to talk to. Hangs off a customer (site manager, accounting) or off
 * a single site (tenant, caretaker), never off both, and never off neither.
 */
export interface Contact extends Synced {
  readonly id: ContactId
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly givenName: string | null
  readonly familyName: string
  /** Free text such as `Bauleiter` or `Hausmeister`, not a fixed list. */
  readonly role: string | null
  readonly email: string | null
  readonly phone: string | null
}

/** The two ways a contact can miss the one place the model gives it. */
export type ContactParentProblem = 'none' | 'both'

/**
 * Whether a contact hangs on exactly one customer or one site, judged from
 * the two fields as they stand; null when it does.
 *
 * One function for a form, the sync and any route to come, so that all of them
 * read the rule the check `contacts_belong_to_customer_or_site` holds in the
 * database the same way. An empty string counts as empty, the way a form hands
 * over a field nobody filled in.
 */
export function contactParentProblem(contact: {
  readonly customerId?: unknown
  readonly siteId?: unknown
}): ContactParentProblem | null {
  const onCustomer = named(contact.customerId)
  const onSite = named(contact.siteId)

  if (onCustomer && onSite) {
    return 'both'
  }

  return onCustomer || onSite ? null : 'none'
}

function named(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/** The sentence for each, as a form shows it and the sync refuses with it. */
export const contactParentText: Readonly<Record<ContactParentProblem, string>> = {
  none: 'Ein Kontakt gehört zu einem Kunden oder zu einem Objekt, dieser zu keinem von beiden.',
  both: 'Ein Kontakt gehört zu einem Kunden oder zu einem Objekt, nicht zu beiden zugleich.',
}
