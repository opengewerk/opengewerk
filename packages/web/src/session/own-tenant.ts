import type { TenantId } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * A further business for the owner asking, who is its owner at once (#142).
 *
 * The route is this application's, behind its right `tenant.create`, which
 * is why the call stayed here when the area of the instance moved into the
 * foundation (ADR 0010).
 */
export function createOwnTenant(
  name: string,
): Promise<{ readonly tenantId: TenantId; readonly name: string }> {
  return request<{ tenantId: TenantId; name: string }>('/tenants', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}
