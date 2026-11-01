import type { AbsenceKind, Holiday, IsoDate } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The routes of the planning board (#290). The appointments themselves come
 * to every device through the sync; a change goes to these routes, with a
 * network, and only for the version the board read.
 */

/** Somebody with an access who is away: the kind only for whoever keeps absences. */
export interface BoardAbsence {
  readonly userId: string
  readonly kind: AbsenceKind | 'absent'
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
}

/** What the board shows beside the appointments, which no device holds. */
export interface BoardFacts {
  readonly absences: readonly BoardAbsence[]
  readonly holidays: readonly Holiday[]
}

export const boardKey = ['appointments', 'board'] as const

export function boardFacts(from: IsoDate, to: IsoDate): Promise<BoardFacts> {
  return request<BoardFacts>(`/appointments/board?from=${from}&to=${to}`)
}

/** An appointment as the form sends it, whole. */
export interface AppointmentBody {
  readonly jobId: string
  readonly startsAt: string
  readonly endsAt: string
  readonly note: string | null
  readonly rrule: string | null
  readonly exdates: readonly IsoDate[]
  readonly userIds: readonly string[]
}

export function createAppointment(body: AppointmentBody): Promise<unknown> {
  return request('/appointments', { method: 'POST', body: JSON.stringify(body) })
}

/** A change, with the version of the appointment the board read. */
export function changeAppointment(
  id: string,
  body: AppointmentBody,
  version: number,
): Promise<unknown> {
  return request(`/appointments/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...body, version }),
  })
}

export function removeAppointment(id: string, version: number): Promise<unknown> {
  return request(`/appointments/${encodeURIComponent(id)}?version=${String(version)}`, {
    method: 'DELETE',
  })
}

/** The person signed in confirms the version of an appointment they saw. */
export function confirmAppointment(id: string, revision: number): Promise<unknown> {
  return request(`/appointments/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ revision }),
  })
}
