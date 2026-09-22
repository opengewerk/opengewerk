import { request } from '../sync/transport.js'

/**
 * One person of the business, as a task sees them: a name, and whether a new
 * task can still go to them.
 *
 * The tasks themselves travel through the sync. The people do not: they live
 * in the memberships and the accounts, which never go to a device, so their
 * names come from this route while there is a connection.
 */
export interface Assignee {
  readonly userId: string
  readonly name: string
  readonly active: boolean
}

export function assignees(): Promise<readonly Assignee[]> {
  return request<readonly Assignee[]>('/tasks/assignees')
}
