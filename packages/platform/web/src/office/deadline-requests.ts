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

export function deadlineList<View extends DeadlineView = DeadlineView>(
  status: DeadlineFilter,
): Promise<readonly View[]> {
  return request<readonly View[]>(`/deadlines?status=${status}`)
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
