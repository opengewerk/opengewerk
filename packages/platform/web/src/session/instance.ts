import type { InstanceAccess } from '@opengewerk/platform-domain'
import { queryOptions } from '@tanstack/react-query'

import { request } from '../sync/transport.js'

/**
 * The instance as the person signed in may touch it: whether they run it.
 *
 * Read straight at the route. Nothing of the instance travels to a device: it
 * belongs to no tenant, and it is looked after at a desk.
 */
export function instanceAccess(): Promise<InstanceAccess> {
  return request<InstanceAccess>('/instance/access')
}

/**
 * Whether the person runs the instance, for the entry under the name and the
 * door of its area. Asked once the account is known and kept for a few
 * minutes: the answer changes when somebody else who runs the instance names
 * or removes a person, and the routes of the area ask again on every request
 * anyway.
 */
export const instanceAccessQuery = queryOptions({
  queryKey: ['instance-access'],
  queryFn: instanceAccess,
  staleTime: 5 * 60_000,
  retry: false,
})
