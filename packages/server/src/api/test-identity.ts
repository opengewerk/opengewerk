import type { Identity, RoleKey, TenantId } from '@opengewerk/domain'
import { headerIdentities } from '@opengewerk/platform-server/testing'

// The stand in for the authentication is the foundation's (ADR 0010): it reads
// an identity out of a header, which is exactly what a real one must never do.
// Here is the one thing this application adds, the header for somebody with
// its roles.

export { noIdentities } from '@opengewerk/platform-server/testing'

/** Believes the header `x-test-identity`, with the roles of this application in it. */
export const testIdentities = headerIdentities<Identity>()

/** The header value for somebody in one business with these roles. */
export function as(tenantId: TenantId, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId: 'test', tenantId, roles } satisfies Identity)
}
