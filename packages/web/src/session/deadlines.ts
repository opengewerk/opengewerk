import type {
  DeadlineAction,
  DeadlineResponsible,
  DeadlineSource,
  DeadlineStatus,
  IsoDate,
} from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * The deadlines of the business (#283), read and changed straight at the
 * routes like the settings. A deadline is worked out on the server from what
 * the devices sent, so there is nothing about one a device carries into a
 * cellar; the tasks a deadline makes travel as every task does.
 */

export interface DeadlinePerson {
  readonly userId: string
  readonly name: string
}

/** One deadline as the list "Fristen" reads it. */
export interface DeadlineView {
  readonly id: string
  readonly kind: string
  readonly kindTitle: string
  readonly trade: string | null
  readonly status: DeadlineStatus
  readonly anchorOn: IsoDate
  readonly dueOn: IsoDate
  readonly remindOn: IsoDate
  readonly leadDays: number
  readonly ownLeadDays: number | null
  readonly responsible: DeadlinePerson | null
  readonly ownResponsibleUserId: string | null
  readonly source: {
    readonly label: string
    readonly documentId: string | null
    readonly installationId: string | null
  }
  readonly customer: { readonly id: string; readonly name: string } | null
  readonly siteId: string | null
  readonly jobId: string | null
  readonly remindedFor: IsoDate | null
  readonly remindedAt: string | null
  readonly taskId: string | null
  readonly closedAt: string | null
  readonly closedBy: DeadlinePerson | null
}

/** A kind with what the business has set for it. */
export interface DeadlineKindView {
  readonly key: string
  readonly title: string
  readonly about: string
  readonly trade: string | null
  readonly source: DeadlineSource
  readonly actions: readonly DeadlineAction[]
  readonly responsible: DeadlineResponsible
  readonly intervalDays: number | null
  readonly leadDays: number
  readonly setting: {
    readonly intervalDays: number | null
    readonly leadDays: number | null
    readonly responsibleUserId: string | null
  }
}

/** The chips of the list: a state, or all of them. */
export type DeadlineFilter = DeadlineStatus | 'all'

export function deadlineList(status: DeadlineFilter): Promise<readonly DeadlineView[]> {
  return request<readonly DeadlineView[]>(`/deadlines?status=${status}`)
}

export function deadlineKinds(): Promise<readonly DeadlineKindView[]> {
  return request<readonly DeadlineKindView[]>('/deadlines/kinds')
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

export function deadlineSettings(): Promise<readonly DeadlineKindView[]> {
  return request<readonly DeadlineKindView[]>('/settings/deadlines')
}

/** What the business sets for a kind; null is the kind's own value. */
export interface DeadlineSettingChange {
  readonly leadDays: number | null
  readonly intervalDays: number | null
  readonly responsibleUserId: string | null
}

export function setDeadlineSetting(
  kind: string,
  setting: DeadlineSettingChange,
): Promise<DeadlineKindView> {
  return request<DeadlineKindView>(`/settings/deadlines/${kind}`, {
    method: 'PUT',
    body: JSON.stringify(setting),
  })
}
