import type { TenantId } from './identifier.js'
import type { TenantIdentity } from './identity.js'

/**
 * What somebody may do in a tenant, as the foundation sees it (ADR 0010).
 *
 * Two things are kept apart here. Which rights there are is the application's
 * list, its catalogue, and a string to the foundation. Which of them somebody
 * holds is data: a tenant has roles, each a row with the rights it gives, and
 * a membership names roles. The rights a request carries are what the roles of
 * its membership add up to at that moment, and every question about what
 * somebody may do is asked of those: by the guard in front of a route, by the
 * sync, and by a screen that decides which entries to offer.
 */

/**
 * The rights the foundation asks for on the routes that are its own: seeing
 * who works in a tenant, and changing it.
 *
 * Rights of the foundation, because the routes are. Every application carries
 * both in its catalogue; a catalogue without them is refused when it is made.
 */
export const accessRights = {
  read: 'membership.read',
  write: 'membership.write',
} as const

export type AccessRight = (typeof accessRights)[keyof typeof accessRights]

/**
 * A role as a tenant holds it: the key a membership names, the name a screen
 * calls it by, the rights it gives, and the two things about it that are not
 * rights.
 *
 * Those two are flags of the role and not entries of its rights on purpose.
 * What must not be possible to switch off, that a tenant keeps somebody who
 * leads it and that such a role works only with a second factor, would
 * otherwise hang on a right a role can lose.
 */
export interface RoleDefinition<Right extends string = string> {
  /** What a membership names. Stands once in a tenant. */
  readonly key: string
  /** What a screen calls the role, in the words of the tenant's people. */
  readonly label: string
  readonly rights: readonly Right[]
  /**
   * Whether this role leads the tenant. Whoever leads administers who works
   * in it, whatever the rights of the role say, and the last one who leads
   * and can still get in neither loses the role nor is shut out.
   */
  readonly leads: boolean
  /** Whether somebody with this role works only with a second factor. */
  readonly secondFactor: boolean
}

/** What the roles of one membership add up to. */
export interface RoleSum<Right extends string = string> {
  /** In the order of the catalogue, each once. */
  readonly rights: readonly Right[]
  readonly leads: boolean
  readonly secondFactor: boolean
}

/**
 * Who is asking, in which tenant, and what they may do there.
 *
 * The rights are resolved when the identity is, from the membership and the
 * roles of the tenant as they stand at that moment, and travel with it. So a
 * right taken away takes effect with the next request, and nobody further in
 * has to know how somebody came by a right in order to ask whether they hold
 * it.
 */
export interface MemberIdentity<Right extends string = string> extends TenantIdentity {
  /** The keys of the roles the membership names. */
  readonly roles: readonly string[]
  readonly rights: readonly Right[]
}

/**
 * One of the tenants somebody may work in, as the server tells a screen.
 *
 * It carries what the roles of the membership add up to at the moment of
 * asking, resolved on the server from the rows of that tenant, the same way
 * the identity of a request is. A screen decides by these rights which
 * entries to offer, so that it and the guard cannot come to two answers about
 * a role a tenant has changed. The answer allows nothing by itself: every
 * request is decided again where it arrives.
 */
export interface TenantChoice<Right extends string = string> {
  readonly id: TenantId
  readonly name: string
  /** The keys the membership names. */
  readonly roles: readonly string[]
  /**
   * What the tenant calls the roles it has a row for, in the order it made
   * them. A key without a row is not a role and has no name.
   */
  readonly roleLabels: readonly string[]
  /** In the order of the catalogue, each once. */
  readonly rights: readonly Right[]
  /** Whether one of the roles works only with a second factor. */
  readonly secondFactor: boolean
}

/** The rights of one application, and the questions asked of them. */
export interface RightsCatalogue<Right extends string> {
  readonly rights: readonly Right[]
  /** Whether a string, out of a row or a request, is a right of this application. */
  isRight(value: string): value is Right
  /**
   * What these roles add up to. A right a row holds and the catalogue does
   * not know gives nothing: it is one of a newer or an older version, and
   * guessing what it meant would hand out something nobody decided on.
   */
  sumOf(roles: readonly Pick<RoleDefinition, 'rights' | 'leads' | 'secondFactor'>[]): RoleSum<Right>
  /** Whether somebody holds a right. The one question, wherever it is asked. */
  isAllowed(identity: Pick<MemberIdentity, 'rights'>, right: Right): boolean
}

/**
 * The catalogue of an application, made once from the list of its rights.
 *
 * Nothing registers itself anywhere: an application makes its catalogue and
 * hands it to whatever needs one. Two applications in one process, as in a
 * test, then never read each other's rights.
 */
export function rightsCatalogue<const Right extends string>(
  rights: readonly Right[],
): RightsCatalogue<Right> {
  const known = new Set<string>(rights)

  if (known.size !== rights.length) {
    const twice = rights.filter((right, position) => rights.indexOf(right) !== position)

    throw new Error(`A right stands twice in the catalogue: ${[...new Set(twice)].join(', ')}`)
  }

  const missing = Object.values(accessRights).filter((right) => !known.has(right))

  if (missing.length > 0) {
    // The routes that say who works in a tenant ask for these. Without them
    // in the catalogue no role could hold them, and those routes would refuse
    // everybody.
    throw new Error(`The catalogue lacks the rights of the foundation: ${missing.join(', ')}`)
  }

  const administering = new Set<string>(Object.values(accessRights))

  return {
    rights,
    isRight: (value): value is Right => known.has(value),
    sumOf(roles) {
      const leads = roles.some((role) => role.leads)
      const held = new Set(roles.flatMap((role) => role.rights))

      return {
        // Whoever leads administers who works in the tenant, whatever the row
        // of the role says. That is what keeps a tenant from locking itself
        // out by editing the one role that could let it back in.
        rights: rights.filter((right) => held.has(right) || (leads && administering.has(right))),
        leads,
        secondFactor: roles.some((role) => role.secondFactor),
      }
    },
    isAllowed: (identity, right) => identity.rights.includes(right),
  }
}
