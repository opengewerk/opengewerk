import type { DueErasure, Erasure, ErasureAutomation, ErasureKind } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The deletion concept (#317) as the server keeps it: nothing of it goes to a
 * device, so it is asked with a connection.
 */

export interface PrivacyOverview {
  readonly due: readonly DueErasure[]
  readonly erasures: readonly Erasure[]
  readonly automations: readonly ErasureAutomation[]
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
