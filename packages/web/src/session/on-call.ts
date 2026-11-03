import { request } from '@opengewerk/platform-web/sync'

/**
 * The on-call plan (#293) as the office keeps it, at the routes of the
 * server: a device reads the times of its person through the sync and writes
 * none.
 */

export interface OnCallShift {
  readonly id: string
  readonly userId: string
  readonly startsAt: string
  readonly endsAt: string
  readonly note: string | null
}

export interface OnCallValues {
  readonly userId: string
  readonly startsAt: string
  readonly endsAt: string
  readonly note: string | null
}

export const onCallKey = ['on-call-shifts'] as const

export function onCallShifts(from: string, to: string): Promise<readonly OnCallShift[]> {
  return request<readonly OnCallShift[]>(
    `/on-call-shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  )
}

export function createOnCallShift(values: OnCallValues): Promise<OnCallShift> {
  return request<OnCallShift>('/on-call-shifts', { method: 'POST', body: JSON.stringify(values) })
}

export function changeOnCallShift(id: string, values: OnCallValues): Promise<OnCallShift> {
  return request<OnCallShift>(`/on-call-shifts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  })
}

export function removeOnCallShift(id: string): Promise<unknown> {
  return request(`/on-call-shifts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function swapOnCallShifts(id: string, other: string): Promise<unknown> {
  return request(`/on-call-shifts/${encodeURIComponent(id)}/swap`, {
    method: 'POST',
    body: JSON.stringify({ with: other }),
  })
}
