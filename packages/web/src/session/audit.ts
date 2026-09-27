import type { AuditChainReport, AuditPage } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * The change log of the business (#285), read straight at the routes like the
 * settings. Nothing of it travels to a device: it is the owner's, and it is
 * read in the office.
 */

/** What the log is narrowed to. An empty value is no filter. */
export interface AuditFilterView {
  /** First and last day, ISO. */
  readonly since: string
  readonly until: string
  readonly person: string
  /** The kind of record, as the table is named. */
  readonly table: string
  /** One record with its parts, together with `table`. */
  readonly record: string
}

export const noAuditFilter: AuditFilterView = {
  since: '',
  until: '',
  person: '',
  table: '',
  record: '',
}

/** Somebody who has worked in this business, for the filter. */
export interface AuditPersonView {
  readonly userId: string
  readonly name: string
}

export function auditChanges(filter: AuditFilterView, before: number | null): Promise<AuditPage> {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(filter)) {
    if (value !== '') {
      query.set(key, value)
    }
  }

  if (before !== null) {
    query.set('before', String(before))
  }

  const said = query.toString()

  return request<AuditPage>(`/audit/changes${said === '' ? '' : `?${said}`}`)
}

export function auditChain(): Promise<AuditChainReport> {
  return request<AuditChainReport>('/audit/chain')
}

export function auditPeople(): Promise<readonly AuditPersonView[]> {
  return request<readonly AuditPersonView[]>('/audit/people')
}
