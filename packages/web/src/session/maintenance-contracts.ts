import type { MaintenanceContract } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The maintenance contracts of the business (#294), as the server keeps
 * them.
 *
 * Read and written straight at the route, like the funding programmes: the
 * office keeps them at a desk, and what reaches a device is the service job
 * each maintenance makes.
 */
export type MaintenanceContractEntry = Omit<MaintenanceContract, 'createdAt' | 'updatedAt'> & {
  readonly createdAt: string
  readonly updatedAt: string
}

/** What the form writes; the customer, the site and the number come from the quote and the server. */
export type MaintenanceContractValues = Pick<
  MaintenanceContract,
  | 'designation'
  | 'services'
  | 'installationIds'
  | 'startsOn'
  | 'firstVisitOn'
  | 'intervalMonths'
  | 'termMonths'
  | 'renewal'
  | 'renewalMonths'
  | 'noticeMonths'
  | 'priceKind'
  | 'flatCents'
  | 'paymentRhythm'
  | 'issueByItself'
>

/** Which contracts a card asks for: those of a customer, a site, an installation or a quote. */
export type ContractFilter =
  | { readonly customerId: string }
  | { readonly siteId: string }
  | { readonly installationId: string }
  | { readonly quoteId: string }

const path = '/maintenance-contracts'

export function maintenanceContracts(
  filter?: ContractFilter,
): Promise<readonly MaintenanceContractEntry[]> {
  const query = filter ? `?${new URLSearchParams(filter as Record<string, string>).toString()}` : ''

  return request<readonly MaintenanceContractEntry[]>(`${path}${query}`)
}

export function maintenanceContract(id: string): Promise<MaintenanceContractEntry> {
  return request<MaintenanceContractEntry>(`${path}/${encodeURIComponent(id)}`)
}

export function createMaintenanceContract(
  quoteId: string,
  values: MaintenanceContractValues,
): Promise<MaintenanceContractEntry> {
  return request<MaintenanceContractEntry>(path, {
    method: 'POST',
    body: JSON.stringify({ quoteId, ...values }),
  })
}

export function updateMaintenanceContract(
  id: string,
  values: Partial<MaintenanceContractValues>,
): Promise<MaintenanceContractEntry> {
  return request<MaintenanceContractEntry>(`${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  })
}

/** A notice that came in on a day; the server works out the day the contract ends. */
export function giveNotice(id: string, receivedOn: string): Promise<MaintenanceContractEntry> {
  return request<MaintenanceContractEntry>(`${path}/${encodeURIComponent(id)}/notice`, {
    method: 'POST',
    body: JSON.stringify({ receivedOn }),
  })
}

export function withdrawNotice(id: string): Promise<MaintenanceContractEntry> {
  return request<MaintenanceContractEntry>(`${path}/${encodeURIComponent(id)}/notice`, {
    method: 'DELETE',
  })
}

export function removeMaintenanceContract(id: string): Promise<unknown> {
  return request(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
