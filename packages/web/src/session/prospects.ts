import type { Prospect } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The leads of the office (#312) as the server keeps them: they go to no
 * device, so every screen asks the server, with a connection.
 */

export type ProspectEntry = Prospect & {
  readonly createdAt: string
  readonly updatedAt: string
}

export type ProspectValues = Pick<
  Prospect,
  | 'kind'
  | 'name'
  | 'concern'
  | 'email'
  | 'phone'
  | 'street'
  | 'houseNumber'
  | 'postalCode'
  | 'city'
  | 'country'
  | 'source'
  | 'stage'
  | 'lastContactOn'
>

/** Where the site of a converted lead lies when it is not at the lead's address. */
export interface SiteAddress {
  readonly street: string | null
  readonly houseNumber: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly country: string
}

const path = '/prospects'

export const prospectsKey = ['prospects'] as const

export const prospectKey = (id: string) => ['prospects', id] as const

export function prospects(): Promise<readonly ProspectEntry[]> {
  return request<readonly ProspectEntry[]>(path)
}

export function prospect(id: string): Promise<ProspectEntry> {
  return request<ProspectEntry>(`${path}/${encodeURIComponent(id)}`)
}

export function createProspect(values: ProspectValues): Promise<ProspectEntry> {
  return request<ProspectEntry>(path, { method: 'POST', body: JSON.stringify(values) })
}

export function updateProspect(
  id: string,
  values: Partial<ProspectValues>,
): Promise<ProspectEntry> {
  return request<ProspectEntry>(`${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  })
}

export function removeProspect(id: string): Promise<unknown> {
  return request<unknown>(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Makes the customer and the site out of a lead, the site at another address when one is given. */
export function convertProspect(
  id: string,
  designation: string,
  address: SiteAddress | null,
): Promise<ProspectEntry> {
  return request<ProspectEntry>(`${path}/${encodeURIComponent(id)}/conversion`, {
    method: 'POST',
    body: JSON.stringify({ designation, address }),
  })
}
