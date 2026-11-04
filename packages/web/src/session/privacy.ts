import type {
  DueErasure,
  Erasure,
  ErasureAutomation,
  ErasureKind,
  ErasureRequestChannel,
  ErasureRequestView,
  IsoDate,
} from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The deletion concept (#317, #845) as the server keeps it: nothing of it
 * goes to a device, so it is asked with a connection.
 */

export interface PrivacyOverview {
  /** Null for somebody who may not read the records of the kinds that are due. */
  readonly due: readonly DueErasure[] | null
  readonly erasures: readonly Erasure[]
  readonly automations: readonly ErasureAutomation[]
  /** The requests for deletion that run; null for somebody who may not read customers. */
  readonly requests: readonly ErasureRequestView[] | null
  /** Whether the person asking leads the business, and so may delete and switch. */
  readonly leads: boolean
}

export const privacyKey = ['privacy'] as const

export function privacyOverview(): Promise<PrivacyOverview> {
  return request<PrivacyOverview>('/privacy')
}

/** Deletes the records of a kind the office confirmed, all of them or none. */
export function erase(kind: ErasureKind, ids: readonly string[]): Promise<readonly Erasure[]> {
  return request<readonly Erasure[]>('/privacy/erasures', {
    method: 'POST',
    body: JSON.stringify({ kind, ids }),
  })
}

/** Switches a kind to go by itself, or back to proposals. */
export function switchAutomation(
  kind: ErasureKind,
  on: boolean,
): Promise<readonly ErasureAutomation[]> {
  return request<readonly ErasureAutomation[]>(`/privacy/automations/${kind}`, {
    method: on ? 'PUT' : 'DELETE',
  })
}

/** The key the request of a customer is kept under; under `privacyKey`, so that it goes with it. */
export function erasureRequestKey(customerId: string) {
  return [...privacyKey, 'request', customerId] as const
}

/** The request that runs for a customer, or null (#845). */
export async function runningErasureRequest(
  customerId: string,
): Promise<ErasureRequestView | null> {
  const answer = await request<{ readonly running: ErasureRequestView | null }>(
    `/privacy/requests?customerId=${encodeURIComponent(customerId)}`,
  )

  return answer.running
}

/** Records a request of a customer to be deleted (#845). */
export function recordErasureRequest(values: {
  readonly customerId: string
  readonly receivedOn: IsoDate
  readonly channel: ErasureRequestChannel
}): Promise<ErasureRequestView> {
  return request<ErasureRequestView>('/privacy/requests', {
    method: 'POST',
    body: JSON.stringify(values),
  })
}

/** Answers an open request by restricting its customer (#845). */
export function restrictOnRequest(requestId: string): Promise<ErasureRequestView> {
  return request<ErasureRequestView>(`/privacy/requests/${requestId}/restriction`, {
    method: 'POST',
  })
}
