import type {
  InstanceAccess,
  InstanceLogPage,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
  TenantId,
} from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * The area of the instance (#188) and further businesses (#142), read straight
 * at the routes like the settings. Nothing of it travels to a device: it
 * belongs to the instance and not to a business, and it is looked after in the
 * office.
 */

/** Whether the person signed in runs the instance, for the entry under the name. */
export function instanceAccess(): Promise<InstanceAccess> {
  return request<InstanceAccess>('/instance/access')
}

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

/** What the operator hands on after creating a business for somebody else: the link, once. */
export interface CreatedForSomebody {
  readonly tenantId: TenantId
  readonly token: string
  readonly expiresAt: string
}

export function createTenantFor(wanted: {
  readonly name: string
  readonly ownerName: string
  readonly ownerEmail: string
}): Promise<CreatedForSomebody> {
  return request<CreatedForSomebody>('/instance/tenants', {
    method: 'POST',
    body: JSON.stringify(wanted),
  })
}

/** A further business for the owner asking, who is its owner at once (#142). */
export function createOwnTenant(
  name: string,
): Promise<{ readonly tenantId: TenantId; readonly name: string }> {
  return request<{ tenantId: TenantId; name: string }>('/tenants', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}
