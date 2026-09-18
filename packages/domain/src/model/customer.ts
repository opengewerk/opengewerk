import type { Address } from './address.js'
import type { CustomerId, IsoDate, TenantOwned } from './identifier.js'

/**
 * The four kinds the concept distinguishes. They differ in how a job reaches
 * them: a property management company orders for buildings it does not own,
 * and a general contractor passes the work on.
 */
export const customerKinds = [
  'private',
  'business',
  'property_management',
  'general_contractor',
] as const

export type CustomerKind = (typeof customerKinds)[number]

export interface Customer extends TenantOwned, Address {
  readonly id: CustomerId
  readonly kind: CustomerKind
  /** Company name, or the family name of a private customer. */
  readonly name: string
  readonly email: string | null
  readonly phone: string | null

  // Tax attributes. They decide how a document has to be written, which is why
  // they sit on the customer and not in some settings screen. The rules that
  // read them live in the rule engine, never here.

  /** VAT identification number, `DE123456789`. */
  readonly vatId: string | null
  /**
   * The customer is a business for VAT purposes. Drives the electronic
   * invoicing obligation, which is not the same question as `kind`: a sole
   * trader can be a private customer for one job and a business for the next.
   */
  readonly isBusiness: boolean
  /** Receives construction work under section 13b UStG, so VAT reverses. */
  readonly isConstructionServiceRecipient: boolean
  /** Exemption certificate under section 48b EStG, with its expiry date. */
  readonly taxExemptionCertificateNumber: string | null
  readonly taxExemptionValidUntil: IsoDate | null

  readonly notes: string | null
}
