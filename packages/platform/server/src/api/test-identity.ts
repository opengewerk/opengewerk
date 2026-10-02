import type { MemberIdentity } from '@opengewerk/platform-domain'

import type { IdentitySource, SignedInUser } from './identity.js'

// The stand in for the authentication in a test, and it is part of the kit
// rather than of the server: it reads the identity straight out of a header,
// which is exactly what a real one must never do. A server ships without any
// implementation, so it cannot start until a genuine one is handed in.

/** The header a test names its identity in. */
export const testIdentityHeader = 'x-test-identity'

function headerOf(request: unknown): string | undefined {
  return (request as { headers?: Record<string, string> }).headers?.[testIdentityHeader]
}

/**
 * An identity source that believes what the header says.
 *
 * The header carries the identity of the application as JSON, the rights it
 * holds included; this hands it on as it is. Which rights a role of a test
 * stands for is the application's to say when it writes the header.
 */
export function headerIdentities<Who extends MemberIdentity>(): IdentitySource<Who> {
  return {
    identify: async (request: unknown) => {
      const header = headerOf(request)

      return header ? (JSON.parse(header) as Who) : null
    },

    /**
     * The same header, read for the half of it that a route before the choice
     * of tenant needs. A test that wants somebody signed in but in no tenant
     * sends an identity without one.
     */
    authenticate: async (request: unknown): Promise<SignedInUser | null> => {
      const header = headerOf(request)

      if (!header) {
        return null
      }

      const identity = JSON.parse(header) as Who

      return { userId: identity.userId, sessionId: `test-session-${identity.userId}` }
    },
  }
}

/** An identity source that recognises nobody, for the tests that want none. */
export const noIdentities: IdentitySource<never> = {
  identify: async () => null,
  authenticate: async () => null,
}
