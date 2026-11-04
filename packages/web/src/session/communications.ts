import type {
  CallDirection,
  Communication,
  CommunicationKind,
  HistoryItem,
} from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The history at a customer and at a site (#313) as the server keeps it: it
 * goes to no device, so it is asked with a connection.
 */

export type HistorySubject = { readonly customerId: string } | { readonly siteId: string }

export const historyKey = (subject: HistorySubject) => ['communications', subject] as const

export function history(subject: HistorySubject): Promise<readonly HistoryItem[]> {
  const query = new URLSearchParams(subject as Record<string, string>).toString()

  return request<readonly HistoryItem[]>(`/communications?${query}`)
}

export interface CommunicationValues {
  readonly customerId: string
  readonly siteId: string | null
  readonly kind: CommunicationKind
  readonly direction: CallDirection | null
  readonly counterpart: string | null
  readonly text: string
  readonly happenedAt: string
}

/** Writes a note or a call down; it is not changed afterwards. */
export function writeCommunication(values: CommunicationValues): Promise<Communication> {
  return request<Communication>('/communications', { method: 'POST', body: JSON.stringify(values) })
}
