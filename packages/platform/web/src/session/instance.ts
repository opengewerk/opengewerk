import type {
  InstanceAccess,
  InstanceLogPage,
  InstanceMailServerState,
  InstanceMailServerView,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
  SmtpSecurity,
  TenantId,
} from '@opengewerk/platform-domain'
import { queryOptions } from '@tanstack/react-query'

import { request } from '../sync/transport.js'

/**
 * The instance as the person signed in may touch it: whether they run it.
 *
 * Read straight at the route. Nothing of the instance travels to a device: it
 * belongs to no tenant, and it is looked after at a desk.
 */
export function instanceAccess(): Promise<InstanceAccess> {
  return request<InstanceAccess>('/instance/access')
}

/**
 * Whether the person runs the instance, for the entry under the name and the
 * door of its area. Asked once the account is known and kept for a few
 * minutes: the answer changes when somebody else who runs the instance names
 * or removes a person, and the routes of the area ask again on every request
 * anyway.
 */
export const instanceAccessQuery = queryOptions({
  queryKey: ['instance-access'],
  queryFn: instanceAccess,
  staleTime: 5 * 60_000,
  retry: false,
})

/*
 * The area of the instance, for whoever runs it: what holds for every tenant
 * on it, who runs it, its log, and the tenants on it. Read straight at the
 * routes like everything else of the instance.
 */

export function instanceSettings(): Promise<InstanceSettingsView> {
  return request<InstanceSettingsView>('/instance/settings')
}

export function saveInstanceSettings(change: {
  readonly mailInternalHosts?: readonly string[]
  readonly backupTime?: string
}): Promise<InstanceSettingsView> {
  return request<InstanceSettingsView>('/instance/settings', {
    method: 'PUT',
    body: JSON.stringify(change),
  })
}

/**
 * The mail server of the instance, through which a mail to an account goes
 * out (opengewerk-haustechnik#81). Never with its password: whether there is
 * one, and whether it still opens, is all that comes back.
 */
export function instanceMailServer(): Promise<InstanceMailServerState> {
  return request<InstanceMailServerState>('/instance/mail-server')
}

/** The settings as the form sends them. A password is sent only when one was typed. */
export interface InstanceMailServerInput {
  readonly host: string
  /** Null for the port that goes with the kind of connection. */
  readonly port: number | null
  readonly security: SmtpSecurity
  readonly username: string | null
  readonly password?: string
  readonly fromAddress: string
}

/** What asking the mail server found. */
export type InstanceMailServerCheck =
  | { readonly outcome: 'ready' }
  | { readonly outcome: 'refused' | 'unreachable'; readonly reason: string }

export function saveInstanceMailServer(input: InstanceMailServerInput): Promise<{
  readonly server: InstanceMailServerView
  readonly check: InstanceMailServerCheck
}> {
  return request('/instance/mail-server', { method: 'PUT', body: JSON.stringify(input) })
}

export function checkInstanceMailServer(
  input: InstanceMailServerInput,
): Promise<InstanceMailServerCheck> {
  return request<InstanceMailServerCheck>('/instance/mail-server/check', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function removeInstanceMailServer(): Promise<void> {
  await request('/instance/mail-server', { method: 'DELETE' })
}

export function operators(): Promise<readonly OperatorView[]> {
  return request<readonly OperatorView[]>('/instance/operators')
}

export function appointOperator(email: string): Promise<OperatorView> {
  return request<OperatorView>('/instance/operators', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function removeOperator(userId: string): Promise<void> {
  await request(`/instance/operators/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export function instanceLog(before: string | null): Promise<InstanceLogPage> {
  return request<InstanceLogPage>(
    before === null ? '/instance/log' : `/instance/log?before=${encodeURIComponent(before)}`,
  )
}

export function instanceTenants(): Promise<readonly InstanceTenantView[]> {
  return request<readonly InstanceTenantView[]>('/instance/tenants')
}

/** What whoever runs the instance hands on after making a tenant for somebody else: the link, once. */
export interface CreatedForSomebody {
  readonly tenantId: TenantId
  readonly token: string
  readonly expiresAt: string
}

/** A tenant for somebody else, who is invited to lead it. */
export function createTenantFor(wanted: {
  readonly name: string
  readonly leadName: string
  readonly leadEmail: string
}): Promise<CreatedForSomebody> {
  return request<CreatedForSomebody>('/instance/tenants', {
    method: 'POST',
    body: JSON.stringify({
      name: wanted.name,
      leadName: wanted.leadName,
      leadEmail: wanted.leadEmail,
    }),
  })
}
