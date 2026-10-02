import type { RecordState } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

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

/**
 * Which value of an access a screen shows: when it was set, and whether it
 * still opens. A value shown on a screen is kept with this and counts only
 * while the access still has it, so that a value changed meanwhile is hidden
 * again and never shown as the current one, one that cannot be read any more
 * gives way to saying so, and a new one appears only after a new tap, which
 * is a new showing (Greptile on #445).
 */
export function valueStampOf(access: RecordState): string {
  const setAt = typeof access['valueSetAt'] === 'string' ? access['valueSetAt'] : ''
  const state = typeof access['valueState'] === 'string' ? access['valueState'] : ''

  return `${setAt}:${state}`
}

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
