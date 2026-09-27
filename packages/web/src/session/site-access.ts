import { request } from '../sync/transport.js'

/**
 * The ways into a site (#286), kept by the office at the routes of the site.
 * Their rows come through the sync without the value; the value comes only
 * from `reveal`, which asks for it on purpose and leaves a trace.
 */

export interface AccessInput {
  readonly designation: string
  readonly hint: string | null
  /** Empty keeps the value there is. */
  readonly value: string
}

export type Revealed =
  | { readonly state: 'readable'; readonly value: string }
  | { readonly state: 'unreadable' }
  | { readonly state: 'none' }

const base = (siteId: string) => `/sites/${encodeURIComponent(siteId)}/accesses`

export function createAccess(siteId: string, input: AccessInput): Promise<{ readonly id: string }> {
  return request(base(siteId), { method: 'POST', body: JSON.stringify(input) })
}

export function changeAccess(
  siteId: string,
  accessId: string,
  input: AccessInput,
): Promise<unknown> {
  return request(`${base(siteId)}/${encodeURIComponent(accessId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function removeAccess(siteId: string, accessId: string): Promise<unknown> {
  return request(`${base(siteId)}/${encodeURIComponent(accessId)}`, { method: 'DELETE' })
}

export function revealAccess(siteId: string, accessId: string): Promise<Revealed> {
  return request(`${base(siteId)}/${encodeURIComponent(accessId)}/reveal`, { method: 'POST' })
}
