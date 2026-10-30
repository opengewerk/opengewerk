import type { TaskBase } from '@opengewerk/platform-domain'
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
 *
 * Text, day, the person who answers for it, whether it is done and who wrote
 * it are the foundation's (`TaskBase`, #597); the person is a user of the
 * instance who works in this business, held there by the database. A note and
 * the three links are this application's.
 */
export interface Task extends TaskBase {
  readonly id: TaskId
  readonly notes: string | null
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
}
