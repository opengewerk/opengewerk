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
