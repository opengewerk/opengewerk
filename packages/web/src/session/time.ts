import { request } from '../sync/transport.js'
import type { Assignee } from './tasks.js'

/**
 * One's own answer to recording one's place with one's working time (#76).
 * Asked of the server and never kept on the device: without a connection
 * nothing is known, and nothing known is no consent.
 */
export interface LocationConsentAnswer {
  readonly given: boolean
  readonly since: string | null
}

export function locationConsent(): Promise<LocationConsentAnswer> {
  return request<LocationConsentAnswer>('/time/consent')
}

export function answerLocationConsent(given: boolean): Promise<LocationConsentAnswer> {
  return request<LocationConsentAnswer>('/time/consent', {
    method: 'PUT',
    body: JSON.stringify({ given }),
  })
}

/**
 * The people of the business by name, for whoever reads the time of the
 * others. The entries name a person by key; the names never travel through the
 * sync, so they come from here while there is a connection.
 */
export function timePeople(): Promise<readonly Assignee[]> {
  return request<readonly Assignee[]>('/time/people')
}
