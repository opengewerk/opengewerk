import { request } from '@opengewerk/platform-web/sync'

/**
 * The address of one's own calendar (#291): whether there is one, a new one,
 * and the end of it. With a network only; the calendar itself is fetched by
 * the calendar app, not by OpenGewerk.
 */

/** Since when the person has an address, or null for none. */
export interface OwnCalendar {
  readonly since: string | null
}

/** A new address, which the server shows this once. */
export interface MadeCalendar {
  readonly address: string
  readonly since: string
}

export const ownCalendarKey = ['calendar', 'feed'] as const

export function ownCalendar(): Promise<OwnCalendar> {
  return request<OwnCalendar>('/calendar/feed')
}

export function makeCalendar(): Promise<MadeCalendar> {
  return request<MadeCalendar>('/calendar/feed', { method: 'POST', body: '{}' })
}

export function endCalendar(): Promise<unknown> {
  return request('/calendar/feed', { method: 'DELETE' })
}
