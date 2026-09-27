import type { PushEntry, PushOccasion } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * Push on one's own devices (#284), straight at its routes like the account:
 * a browser subscribes only while it is online, so there is nothing for the
 * outbox to carry.
 */

export interface PushOccasionView {
  readonly key: PushOccasion
  readonly label: string
  readonly about: string
  readonly on: boolean
}

export interface PushDeviceView {
  readonly id: string
  readonly label: string
  readonly entry: PushEntry
  readonly since: string
  readonly thisSession: boolean
}

export interface PushOverview {
  readonly available: boolean
  readonly publicKey: string | null
  readonly occasions: readonly PushOccasionView[]
  readonly devices: readonly PushDeviceView[]
}

export function pushOverview(): Promise<PushOverview> {
  return request<PushOverview>('/push')
}

/** What a browser hands over when it subscribes, as `PushSubscription.toJSON()` has it. */
export interface BrowserSubscription {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

export function subscribeDevice(
  subscription: BrowserSubscription,
  entry: PushEntry,
  label: string,
): Promise<{ readonly id: string }> {
  return request<{ readonly id: string }>('/push/subscription', {
    method: 'PUT',
    body: JSON.stringify({ ...subscription, entry, label }),
  })
}

export function unsubscribeDevice(id: string): Promise<{ readonly id: string }> {
  return request<{ readonly id: string }>(`/push/subscriptions/${id}`, { method: 'DELETE' })
}

export function setOccasion(
  occasion: PushOccasion,
  on: boolean,
): Promise<readonly PushOccasionView[]> {
  return request<readonly PushOccasionView[]>(`/push/occasions/${occasion}`, {
    method: 'PUT',
    body: JSON.stringify({ on }),
  })
}

export function sendTestPush(): Promise<{ readonly sent: number; readonly failed: number }> {
  return request<{ readonly sent: number; readonly failed: number }>('/push/test', {
    method: 'POST',
  })
}
