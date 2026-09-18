import type { Address } from './address.js'
import type { CustomerId, SiteId, Synced } from './identifier.js'

/**
 * A building, an estate, a location. One customer can have many: the property
 * management company with forty buildings is the case the model is cut for.
 * Everything that happens on site hangs off here, so the history stays with
 * the building even when the customer changes.
 */
export interface Site extends Synced, Address {
  readonly id: SiteId
  readonly customerId: CustomerId
  /** What the people on site call it: `Haus 3`, `Lager Nord`. */
  readonly designation: string
  readonly notes: string | null
}
