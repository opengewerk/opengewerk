import { permissionCatalogue, shippedRoles, type TenantId } from '@opengewerk/domain'

import type { TenantChoice } from './session.js'

/**
 * A business as `/auth/tenants` answers it for somebody who holds these of
 * the roles a business starts with: what the server resolves from the rows of
 * the business, with the names it gives the roles and what they add up to.
 *
 * For the tests of the screens, which stand in for the server. A key that is
 * none of the three gives nothing, as on the server. A test about a business
 * that changed what a role may do says so with `rights`, and then the roles
 * and the rights are allowed to disagree: the screens ask the rights.
 */
export function aTenantChoice(
  roles: readonly string[],
  over: Partial<Omit<TenantChoice, 'id'>> & { readonly id?: string } = {},
): TenantChoice {
  const held = shippedRoles.filter((role) => roles.includes(role.key))
  const sum = permissionCatalogue.sumOf(held)

  return {
    name: 'Elektro Nord GmbH',
    roles,
    roleLabels: held.map((role) => role.label),
    rights: sum.rights,
    secondFactor: sum.secondFactor,
    ...over,
    id: (over.id ?? 't-1') as TenantId,
  }
}
