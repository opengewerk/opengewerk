import type { IsoDate, Synced, TaskStatus } from '@opengewerk/platform-domain'
import type { CustomerId, JobId, SiteId, TaskId } from './identifier.js'

// Open or done: the states of a task are the foundation's since
// opengewerk-haustechnik#124 (`taskStatuses` there), the same two this table
// was made with.

/**
 * Something one person has to do by a day.
 *
 * Section 2 of the concept moves tasks out of the CRM into the functions that
 * run through everything, and that is the point of this record: it is not a
 * feature of the customer screen. It hangs on whatever it is about, a
 * customer, a site or a job, or on nothing at all, and it shows there as well
 * as in the list of whoever has to do it.
 *
 * The links are independent of each other. A task written at a job carries the
 * job and, with it, the customer and the site, so that it also turns up where
 * somebody looks for the customer; one written at a customer carries only the
 * customer.
 */
export interface Task extends Synced {
  readonly id: TaskId
  readonly title: string
  readonly notes: string | null
  /** The day it has to be done by. */
  readonly dueOn: IsoDate
  /**
   * Who answers for it: a user of the instance who works in this business. The
   * database holds it to a membership of the same tenant, so a task cannot be
   * handed to somebody next door.
   */
  readonly assigneeUserId: string
  readonly status: TaskStatus
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
  /**
   * Who wrote it, or null when no person did. The deadline engine of phase 2
   * creates tasks as well, and a task without an author is its way in: it
   * writes the same row as everybody else and needs no second path.
   */
  readonly createdBy: string | null
}
