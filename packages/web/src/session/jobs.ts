import { request } from '../sync/transport.js'

/**
 * Sets who is on a job (#140), as the whole list: whoever is in it and was
 * not is added, whoever was and is not any more is taken off. At the route
 * and not through the outbox, because it decides what the device of each of
 * them holds, and the server asks whether each person works in the business.
 * The rows come down with the next exchange like any other.
 */
export function assignToJob(
  jobId: string,
  userIds: readonly string[],
): Promise<{ readonly userIds: readonly string[] }> {
  return request<{ readonly userIds: readonly string[] }>(
    `/jobs/${encodeURIComponent(jobId)}/assignees`,
    { method: 'PUT', body: JSON.stringify({ userIds }) },
  )
}
