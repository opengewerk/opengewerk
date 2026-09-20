import type { Identity, RoleKey, TenantId } from '@opengewerk/domain'

import type { IdentitySource, SignedInUser } from './identity.js'

/**
 * The stand in for the authentication, and it lives in a file of its own
 * rather than in the server: it reads the identity straight out of a header,
 * which is exactly what a real one must never do. The server ships without any
 * implementation, so it cannot start until a genuine one is handed in.
 *
 * It is here rather than copied into each test file because there were four
 * copies of it by the time the authentication arrived, and a fifth would have
 * been written the next time somebody added a controller test. One copy also
 * means one place to change when the interface grows again.
 */
export const testIdentities: IdentitySource = {
  identify: async (request: unknown) => {
    const header = headerOf(request)

    return header ? (JSON.parse(header) as Identity) : null
  },

  /**
   * The same header, read for the half of it that a route before the choice of
   * business needs. A test that wants somebody signed in but in no company
   * sends an identity without a tenant.
   */
  authenticate: async (request: unknown): Promise<SignedInUser | null> => {
    const header = headerOf(request)

    if (!header) {
      return null
    }

    const identity = JSON.parse(header) as Identity

    return { userId: identity.userId, sessionId: `test-session-${identity.userId}` }
  },
}

/** An identity source that recognises nobody, for the tests that want none. */
export const noIdentities: IdentitySource = {
  identify: async () => null,
  authenticate: async () => null,
}

/** The header value for somebody in one business with these roles. */
export function as(tenantId: TenantId, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId: 'test', tenantId, roles } satisfies Identity)
}

function headerOf(request: unknown): string | undefined {
  return (request as { headers?: Record<string, string> }).headers?.['x-test-identity']
}
