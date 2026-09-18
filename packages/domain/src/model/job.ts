import type { CustomerId, InstallationId, JobId, SiteId, TenantOwned } from './identifier.js'

/**
 * A job is either a project or a service call. The concept keeps them apart
 * because they reach the business differently: a project is planned and split
 * into parts, a service call comes in by phone and has to be on a screen
 * thirty seconds later.
 */
export const jobKinds = ['project', 'service'] as const

export type JobKind = (typeof jobKinds)[number]

export const jobStatuses = ['draft', 'active', 'completed', 'cancelled'] as const

export type JobStatus = (typeof jobStatuses)[number]

export interface Job extends TenantOwned {
  readonly id: JobId
  readonly customerId: CustomerId
  readonly siteId: SiteId | null
  readonly installationId: InstallationId | null
  /** A large site is split into sub jobs, one per trade or section. */
  readonly parentJobId: JobId | null
  readonly kind: JobKind
  readonly status: JobStatus
  /** Assigned by the number range when the job is created; see its own issue. */
  readonly number: string | null
  readonly designation: string
  readonly description: string | null
}
