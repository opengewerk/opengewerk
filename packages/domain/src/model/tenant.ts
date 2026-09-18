import type { TenantId } from './identifier.js'

/**
 * One company on an instance. Several of them can share a server: number
 * ranges, chart of accounts and branding are set per tenant (ADR 0006).
 */
export interface Tenant {
  readonly id: TenantId
  readonly name: string
  readonly createdAt: Date
  readonly updatedAt: Date
}
