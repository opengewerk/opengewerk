import type { DeadlineResponsible, DeadlineStatus, IsoDate } from '@opengewerk/platform-domain'

import { request } from '../sync/transport.js'

/**
 * The deadlines of a tenant (opengewerk-haustechnik#24), read and changed
 * straight at the routes of the foundation like the settings. A deadline is
 * worked out on the server from what the devices sent, so there is nothing
 * about one a device carries into a cellar.
 */

export interface DeadlinePerson {
  readonly userId: string
  readonly name: string
}

/**
 * One deadline as a list reads it: what every deadline says. An application
 * reads its own fields beside these, the records a deadline hangs on.
 */
export interface DeadlineView {
  readonly id: string
  readonly kind: string
  readonly kindTitle: string
  readonly status: DeadlineStatus
  readonly anchorOn: IsoDate
  readonly dueOn: IsoDate
  readonly remindOn: IsoDate
  readonly leadDays: number
  readonly ownLeadDays: number | null
  readonly responsible: DeadlinePerson | null
  readonly ownResponsibleUserId: string | null
  readonly source: { readonly label: string }
  readonly remindedFor: IsoDate | null
  readonly remindedAt: string | null
  readonly closedAt: string | null
  readonly closedBy: DeadlinePerson | null
}

/** A kind with what the tenant has set for it. */
export interface DeadlineKindView {
  readonly key: string
  readonly title: string
  readonly about: string
  readonly source: string
  readonly actions: readonly string[]
  readonly responsible: DeadlineResponsible
  readonly intervalDays: number | null
  readonly intervalMonths?: number | null
  readonly leadDays: number
  readonly setting: {
    readonly intervalDays: number | null
    readonly intervalMonths?: number | null
    readonly leadDays: number | null
    readonly responsibleUserId: string | null
  }
}

/** How the engine last went through the deadlines of the tenant. */
export interface DeadlineRunView {
  readonly succeededAt: string | null
  readonly failedAt: string | null
  readonly behind: boolean
}

/** The chips of the list: a state, or all of them. */
export type DeadlineFilter = DeadlineStatus | 'all'

/** How many deadlines the list asks for at a time. */
export const deadlinePageSize = 50

/**
 * What the list asks the server: a state, what it is narrowed by and which
 * page (opengewerk-haustechnik#104). The filters of the application go by
 * their names in the address; an empty value narrows nothing.
 */
export interface DeadlineQuestion {
  readonly status: DeadlineFilter
  readonly kind?: string
  readonly person?: string
  readonly search?: string
  /** Only the deadlines past their day: what a count of the late ones asks. */
  readonly late?: boolean
  readonly filters?: Readonly<Record<string, string>>
  readonly offset?: number
  readonly limit?: number
}

/**
 * One page of the list. `total` is null when the list is narrowed to one
 * person: it names no number for a person, how many deadlines somebody has
 * or how many of them are late.
 */
export interface DeadlinePageView<View extends DeadlineView = DeadlineView> {
  readonly rows: readonly View[]
  readonly total: number | null
  readonly more: boolean
}

/** The address of one page: the state first, then whatever narrows it, then the page. */
export function deadlinePagePath(question: DeadlineQuestion): string {
  const query = new URLSearchParams({ status: question.status })

  for (const [name, value] of [
    ['kind', question.kind],
    ['person', question.person],
    ['search', question.search?.trim()],
    ['late', question.late ? 'true' : undefined],
    ...Object.entries(question.filters ?? {}),
  ] as const) {
    if (value !== undefined && value !== '') {
      query.set(name, value)
    }
  }

  if (question.offset !== undefined && question.offset > 0) {
    query.set('offset', String(question.offset))
  }

  query.set('limit', String(question.limit ?? deadlinePageSize))

  return `/deadlines?${query.toString()}`
}

export function deadlinePage<View extends DeadlineView = DeadlineView>(
  question: DeadlineQuestion,
): Promise<DeadlinePageView<View>> {
  return request<DeadlinePageView<View>>(deadlinePagePath(question))
}

export function deadlineKinds<Kind extends DeadlineKindView = DeadlineKindView>(): Promise<
  readonly Kind[]
> {
  return request<readonly Kind[]>('/deadlines/kinds')
}

export function deadlineRun(): Promise<DeadlineRunView> {
  return request<DeadlineRunView>('/deadlines/run')
}

/** A lead or a person of its own; null gives it back to the kind. */
export interface DeadlineChange {
  readonly leadDays?: number | null
  readonly responsibleUserId?: string | null
}

export function changeDeadline(
  id: string,
  change: DeadlineChange,
): Promise<{ readonly id: string }> {
  return request(`/deadlines/${id}`, { method: 'PATCH', body: JSON.stringify(change) })
}

export function markDeadlineDone(id: string): Promise<{ readonly id: string }> {
  return request(`/deadlines/${id}/done`, { method: 'POST' })
}

export function reopenDeadline(id: string): Promise<{ readonly id: string }> {
  return request(`/deadlines/${id}/reopen`, { method: 'POST' })
}

export function deadlineSettings<Kind extends DeadlineKindView = DeadlineKindView>(): Promise<
  readonly Kind[]
> {
  return request<readonly Kind[]>('/settings/deadlines')
}

/**
 * What the tenant sets for a kind; null is the kind's own value. The interval
 * is sent in the unit the kind counts in, and only in that one.
 */
export type DeadlineSettingChange = {
  readonly leadDays: number | null
  readonly responsibleUserId: string | null
} & ({ readonly intervalDays: number | null } | { readonly intervalMonths: number | null })

export function setDeadlineSetting<Kind extends DeadlineKindView = DeadlineKindView>(
  kind: string,
  setting: DeadlineSettingChange,
): Promise<Kind> {
  return request<Kind>(`/settings/deadlines/${kind}`, {
    method: 'PUT',
    body: JSON.stringify(setting),
  })
}
