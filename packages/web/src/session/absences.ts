import type {
  AbsenceKind,
  AbsenceState,
  FederalState,
  Holiday,
  IsoDate,
  LeaveYear,
  LocalHoliday,
} from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Leave and sickness (#288) and the public holidays they count with, as the
 * server hands them out. Every count is the server's, from `domain`; a screen
 * only shows it.
 */

export interface AbsenceView {
  readonly id: string
  readonly personId: string
  readonly kind: AbsenceKind
  readonly state: AbsenceState
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
  readonly note: string | null
  readonly answer: string | null
  readonly decidedAt: string | null
  readonly workingHalfDays: number
  readonly leaveHalfDays: number | null
  readonly sickHalfDays: number
  readonly holidays: number
}

export interface RequestView extends AbsenceView {
  readonly name: string
  readonly restAfterHalfDays: number
  readonly alsoAway: readonly {
    readonly name: string
    readonly firstDay: IsoDate
    readonly lastDay: IsoDate
  }[]
}

export interface AbsenceOverview {
  readonly year: number
  readonly state: FederalState | null
  readonly people: readonly {
    readonly id: string
    readonly name: string
    readonly leave: LeaveYear
    readonly awayToday: { readonly kind: AbsenceKind; readonly lastDay: IsoDate } | null
  }[]
  readonly requests: readonly RequestView[]
}

export interface PersonYear {
  readonly person: {
    readonly id: string
    readonly name: string
    readonly joinedOn: IsoDate | null
    readonly leftOn: IsoDate | null
  }
  readonly year: number
  readonly state: FederalState | null
  readonly leave: LeaveYear
  readonly restBefore: number
  readonly absences: readonly AbsenceView[]
}

/** The days of an absence as a form sends them. */
export interface AbsenceDays {
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
  readonly note?: string | null
}

export interface HolidayView {
  readonly state: FederalState | null
  readonly local: readonly string[]
  readonly shown: FederalState | null
  readonly options: readonly (LocalHoliday & { readonly on: IsoDate | null })[]
  readonly holidays: readonly Holiday[]
}

/** Everything the screens of absences read, so that a change makes all of them read again. */
export const absencesKey = ['absences'] as const

const json = (body: unknown) => ({ body: JSON.stringify(body) })

export function absenceOverview(year: number): Promise<AbsenceOverview> {
  return request<AbsenceOverview>(`/absences?year=${String(year)}`)
}

export function personYear(personId: string, year: number): Promise<PersonYear> {
  return request<PersonYear>(
    `/absences/people/${encodeURIComponent(personId)}?year=${String(year)}`,
  )
}

export function ownYear(year: number): Promise<PersonYear | null> {
  return request<PersonYear | null>(`/absences/mine?year=${String(year)}`)
}

export function enterAbsence(
  personId: string,
  kind: AbsenceKind,
  days: AbsenceDays,
): Promise<AbsenceView> {
  return request<AbsenceView>('/absences', { method: 'POST', ...json({ personId, kind, ...days }) })
}

export function changeAbsence(id: string, days: AbsenceDays): Promise<AbsenceView> {
  return request<AbsenceView>(`/absences/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    ...json(days),
  })
}

export function removeAbsence(id: string): Promise<void> {
  return request<void>(`/absences/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function approveRequest(id: string): Promise<AbsenceView> {
  return request<AbsenceView>(`/absences/${encodeURIComponent(id)}/approve`, { method: 'POST' })
}

export function rejectRequest(id: string, answer: string): Promise<AbsenceView> {
  return request<AbsenceView>(`/absences/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    ...json({ answer }),
  })
}

export function setEntitlement(
  personId: string,
  year: number,
  halves: { readonly entitledHalfDays: number; readonly carriedHalfDays: number },
): Promise<unknown> {
  return request<unknown>(
    `/absences/people/${encodeURIComponent(personId)}/entitlements/${String(year)}`,
    {
      method: 'PUT',
      ...json(halves),
    },
  )
}

export function askForLeave(days: AbsenceDays): Promise<AbsenceView> {
  return request<AbsenceView>('/absences/mine', { method: 'POST', ...json(days) })
}

export function takeBackRequest(id: string): Promise<void> {
  return request<void>(`/absences/mine/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function holidaySettings(year: number, state?: FederalState): Promise<HolidayView> {
  return request<HolidayView>(
    `/holidays?year=${String(year)}${state === undefined ? '' : `&state=${state}`}`,
  )
}

export function setHolidaySettings(
  state: FederalState,
  local: readonly string[],
): Promise<unknown> {
  return request<unknown>('/holidays', { method: 'PUT', ...json({ state, local }) })
}

/** How a span would count, before it is saved. */
export interface DayCount {
  readonly workingHalfDays: number
  readonly leaveHalfDays: number | null
  readonly holidays: number
  readonly restAfterHalfDays: number
}

function spanQuery(days: Omit<AbsenceDays, 'note'>): string {
  return new URLSearchParams({
    firstDay: days.firstDay,
    lastDay: days.lastDay,
    startsAtNoon: String(days.startsAtNoon),
    endsAtNoon: String(days.endsAtNoon),
  }).toString()
}

export function daysForPerson(
  personId: string,
  kind: AbsenceKind,
  days: Omit<AbsenceDays, 'note'>,
): Promise<DayCount> {
  return request<DayCount>(
    `/absences/people/${encodeURIComponent(personId)}/days?${spanQuery(days)}&kind=${kind}`,
  )
}

export function daysForMe(days: Omit<AbsenceDays, 'note'>): Promise<DayCount> {
  return request<DayCount>(`/absences/mine/days?${spanQuery(days)}`)
}
