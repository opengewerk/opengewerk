import type { ContactId, CustomerId, SiteId, TenantOwned } from './identifier.js'

/**
 * A person to talk to. Hangs off a customer (site manager, accounting) or off
 * a single site (tenant, caretaker), never off both, and never off neither.
 */
export interface Contact extends TenantOwned {
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
