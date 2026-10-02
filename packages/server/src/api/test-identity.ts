import { type Identity, permissionsOfRoles, type RoleKey, type TenantId } from '@opengewerk/domain'
import { headerIdentities } from '@opengewerk/platform-server/testing'

import type { IdentitySource } from './identity.js'

// The stand in for the authentication is the foundation's (ADR 0010): it reads
// an identity out of a header, which is exactly what a real one must never do.
// Here is the one thing this application adds, the header for somebody with
// its roles.

export { noIdentities } from '@opengewerk/platform-server/testing'

/**
 * Somebody as a test names them: who, in which business, with which of the
 * three roles a business starts with. The rights follow from the roles.
 */
export type Somebody = Omit<Identity, 'rights' | 'roles'> & { readonly roles: readonly RoleKey[] }

const believed = headerIdentities<Identity>()

/**
 * Believes the header `x-test-identity`, with the roles of this application
 * in it.
 *
 * A header names roles and no rights. A real session reads the rights from
 * the rows of the business; here they are what those of the three shipped
 * roles add up to as the code defines them, which is the same for a business
 * that has the roles it started with. `roles.test.ts` holds the rows against
 * that definition. A header that carries rights of its own is taken at its
 * word.
 */
export const testIdentities: IdentitySource = {
  identify: async (request) => {
    const identity = await believed.identify(request)

    if (identity === null || Array.isArray(identity.rights)) {
      return identity
    }

    return { ...identity, rights: [...permissionsOfRoles(identity.roles as readonly RoleKey[])] }
  },
  authenticate: (request) => believed.authenticate(request),
}

/** The header value for somebody in one business with these roles. */
export function as(tenantId: TenantId, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId: 'test', tenantId, roles } satisfies Somebody)
}
