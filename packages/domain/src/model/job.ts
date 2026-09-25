import type { CustomerId, Id, InstallationId, JobId, SiteId, Synced } from './identifier.js'

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
  /**
   * The finished job this one follows up (#170): the wallbox after the meter
   * cabinet, a repair after the handover. Not the parent: a sub job belongs to
   * its project and runs with it, a follow-up is a job of its own with its own
   * documents, and one column for both would turn every follow-up into a part
   * of the job before it. Set when the job is created and fixed from then on.
   */
  readonly predecessorJobId: JobId | null
  readonly kind: JobKind
  readonly status: JobStatus
  /**
   * Drawn from the job number range when the job is created (#145), on the
   * server and only there: a job created without a network gets it with the
   * next sync and has none until then. Null as well for a job created before
   * the numbering existed.
   */
  readonly number: string | null
  readonly designation: string
  readonly description: string | null
  /**
   * When the job was completed or cancelled (#140), written by the database
   * when the status goes there and emptied when it is taken up again. A
   * device of a technician keeps a closed job for `closedJobsStayDays` after
   * it, then lets it go.
   */
  readonly closedAt: Date | null
}

/**
 * How long a closed job stays on the device of a technician assigned to it
 * (#140): long enough to look something up after the handover, not so long
 * that a lost telephone carries every job of the year.
 */
export const closedJobsStayDays = 30

/**
 * A person on a job (#140), assigned in the office. What the device of that
 * person holds follows from these rows, unless the person may see the whole
 * business (`job.read.all`). Made and removed on the server; a device reads
 * them and writes none. Removed means marked deleted, so that every device
 * learns it.
 */
export interface JobAssignment extends Synced {
  readonly id: Id<'job-assignment'>
  readonly jobId: JobId
  readonly userId: string
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
 * `jobProgressStatuses`, and nothing else.
 *
 * This is the part of a job a technician may write (`job.progress`). Which
 * customer it is for, where it is, what it is called and what is to be done
 * stays with whoever holds `job.write`, and a change that touches any of that
 * as well needs that right, however small the rest of it is. What happened on
 * site is a note of its own (`JobNote`, #220), not the description: until
 * then a note written on site replaced what the office had put down as the
 * job. An empty change reports nothing and is not progress either.
 */
export function isJobProgress(changes: readonly FieldChange[]): boolean {
  return (
    changes.length > 0 &&
    changes.every(
      (change) =>
        change.field === 'status' && jobProgressStatuses.some((status) => status === change.to),
    )
  )
}

/** A job as a follow-up is judged against it: whose it is and where it stands. */
export interface PredecessorFacts {
  readonly customerId: string
  readonly status: JobStatus
}

/**
 * What is wrong with following up this job, as a sentence, or null (#170).
 *
 * A follow-up comes after a job that is finished, for the same customer, and
 * no job follows itself. Work that is added while a job is still running is
 * not a follow-up but a change to the order, which is for phase 4. One
 * function for the form in the office, the sync on the server and its routes,
 * so all three refuse the same thing with the same words.
 */
export function followUpProblem(
  job: { readonly id: string; readonly customerId: string },
  predecessor: PredecessorFacts & { readonly id: string },
): string | null {
  if (predecessor.id === job.id) {
    return 'Ein Auftrag ist nicht sein eigener Vorgänger.'
  }

  if (predecessor.status !== 'completed') {
    return 'Ein Folgeauftrag schließt an einen abgeschlossenen Auftrag an.'
  }

  if (predecessor.customerId !== job.customerId) {
    return 'Ein Folgeauftrag ist für denselben Kunden wie der Auftrag davor.'
  }

  return null
}
