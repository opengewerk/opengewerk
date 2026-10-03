import type { AuditChainReport, AuditPage, AuditPerson } from '@opengewerk/platform-domain'

import { request } from '../sync/transport.js'

/**
 * The change log of a tenant (ADR 0010), read straight at the routes like the
 * settings. Nothing of it travels to a device: it is for whoever may read it,
 * and it is read at a desk.
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

export function auditPeople(): Promise<readonly AuditPerson[]> {
  return request<readonly AuditPerson[]>('/audit/people')
}
