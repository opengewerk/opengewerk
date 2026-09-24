import type { CustomerId, InstallationId, JobId, SiteId, Synced } from './identifier.js'

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

export interface Job extends Synced {
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

/**
 * The statuses that move a job forward (#128): taking it up and finishing it,
 * and taking a finished one up again when that happened by mistake.
 * Cancelling is not among them and neither is sending a job back to draft;
 * both are decisions about the order, not reports from the site.
 */
export const jobProgressStatuses: readonly JobStatus[] = ['active', 'completed']

/** One change to one field, as an outbox operation carries it. */
interface FieldChange {
  readonly field: string
  readonly to: unknown
}

/**
 * Whether a change to a job only reports its progress: a status from
 * `jobProgressStatuses`, the note about what happened, or both.
 *
 * This is the part of a job a technician may write (`job.progress`). Which
 * customer it is for, where it is and what it is called stays with whoever
 * holds `job.write`, and a change that touches any of that as well needs that
 * right, however small the rest of it is. An empty change reports nothing and
 * is not progress either.
 */
export function isJobProgress(changes: readonly FieldChange[]): boolean {
  return (
    changes.length > 0 &&
    changes.every(
      (change) =>
        change.field === 'description' ||
        (change.field === 'status' && jobProgressStatuses.some((status) => status === change.to)),
    )
  )
}
