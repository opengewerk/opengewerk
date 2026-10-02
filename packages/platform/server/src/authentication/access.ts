import type { RightsCatalogue, RoleDefinition } from '@opengewerk/platform-domain'

import type { InstanceSentences } from '../instance/sentences.js'

/**
 * What an application says about the people in its tenants, where the
 * authentication would otherwise have to know its rights and its words.
 *
 * The mechanism is the foundation's and the same for every application of the
 * organisation (ADR 0010): accounts on the instance, memberships per tenant,
 * roles as rows of a tenant, and a session that works in one tenant at a
 * time. Which rights there are and which roles a tenant starts with is the
 * application's to say, and so is every sentence that calls a tenant or a
 * role by the name its people know it by.
 *
 * Handed in as an argument wherever it is needed, and to the controllers
 * under `ACCESS_RULES`. There is no register anywhere that an application
 * writes itself into: two applications in one process, as in a test, would
 * otherwise read each other's rights.
 */
export interface AccessRules<Right extends string = string> {
  /**
   * The rights of the application. The roles of a tenant are read through
   * it: what a role gives is what its row holds and this list knows.
   */
  readonly catalogue: RightsCatalogue<Right>
  /**
   * The roles a tenant starts with, written as rows when it comes into being
   * (`writeRoles`). The tenant's own from then on: what somebody may do is
   * read from its rows and no longer from this list.
   *
   * At least one of them leads. The first account of a tenant gets the first
   * that does, and nothing else, because it is the role that hands out the
   * others. ADR 0006 hangs the second factor on such a role, so the first
   * thing the new account meets is the screen that sets one up.
   */
  readonly shippedRoles: readonly RoleDefinition<Right>[]
  /**
   * What is wrong with a name for a tenant, as a sentence for the screen, or
   * null. The first run asks the same question as the screen that changes the
   * name later, so that no name comes in through one door that the other
   * would refuse.
   */
  tenantNameProblem(name: string): string | null
  readonly sentences: AccessSentences
}

/**
 * The sentences of the authentication that name a tenant or a role, in the
 * words of the application. Everything else it says is the same for every
 * application and stands where it is said.
 */
export interface AccessSentences {
  /**
   * Signed in, and no tenant chosen yet. A sentence of its own because the
   * way out is different: not "sign in" but "choose where to work".
   */
  readonly noTenantChosen: string
  /**
   * One answer for a tenant that does not exist, one this person is not part
   * of and one they are shut out of. Telling the three apart would turn the
   * choice into a way of finding out which tenants are on an instance.
   */
  readonly noAccessToTenant: string
  /** A membership that is blocked, and who can lift that. */
  readonly blockedInTenant: string
  /** An invitation for an address that already works in the tenant. */
  readonly alreadyWorksHere: string
  /**
   * One answer for an account that is not in this tenant and one that is not
   * on the instance at all. Telling them apart would turn the administration
   * into a way of asking who has an account here.
   */
  readonly notAMember: string
  /** A session that is not working in this tenant, or is not there at all. */
  readonly noSuchSessionHere: string
  /**
   * The refusal that keeps a tenant from locking itself out: the leading role
   * is not taken from the last one who holds it and can still get in, and
   * that person is not shut out.
   */
  readonly lastLead: string
  /**
   * The three ends of a one time link that can no longer be used, each with
   * where to ask for a new one: used, called back, run out.
   */
  readonly unusableLink: {
    readonly redeemed: string
    readonly revoked: string
    readonly expired: string
  }
  /**
   * A new passkey that could not be written into the logs of the tenants of
   * its account, and was taken back for it.
   */
  readonly passkeyNotRecorded: string
  /** What the command that puts somebody into a tenant says on the terminal. */
  readonly addStaff: {
    /** How it is called, the first line of its help. */
    readonly usage: string
    /** An account that came into being with the command. */
    added(email: string, tenantId: string, roles: readonly string[]): string
    /** An account that was on the instance already, and keeps its password. */
    kept(email: string, tenantId: string, roles: readonly string[]): string
    /** Said after either, when the roles given need a second factor. */
    readonly secondFactor: string
    /** A tenant the instance does not have, by the key the command was given. */
    noSuchTenant(tenantId: string): string
  }
  /** The area of the instance, where a sentence names whoever runs it or a tenant. */
  readonly instance: InstanceSentences
}

/** The rules of the application, for the controllers of the authentication. */
export const ACCESS_RULES = Symbol('AccessRules')
