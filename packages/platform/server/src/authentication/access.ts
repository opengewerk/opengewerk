import type { TenantTransaction } from '../database/database.js'

/**
 * What an application says about the people in its tenants, where the
 * authentication would otherwise have to know its roles and its words.
 *
 * The mechanism is the foundation's and the same for every application of the
 * organisation (ADR 0010): accounts on the instance, memberships per tenant,
 * and a session that works in one tenant at a time. Which roles there are,
 * which of them leads a tenant and which may not work without a second factor
 * is the application's to say, and so is every sentence that calls a tenant or
 * a role by the name its people know it by.
 *
 * Handed in as an argument wherever it is needed, and to the controllers
 * under `ACCESS_RULES`. There is no register anywhere that an application
 * writes itself into: two applications in one process, as in a test, would
 * otherwise read each other's roles.
 */
export interface AccessRules<Role extends string = string> {
  /**
   * The roles a membership or an invitation may name. A list for now; they
   * become rows of a tenant together with the catalogue of rights.
   */
  readonly roles: readonly Role[]
  /**
   * The role that leads a tenant. The first account of an instance gets it
   * and nothing else, because it is the role that hands out the others. ADR
   * 0006 hangs the second factor on such a role, so the first thing the new
   * account meets is the screen that sets one up.
   */
  readonly leadingRole: Role
  /**
   * Whether somebody with these roles works only with a second factor. On
   * the role and not on a setting (ADR 0006): a switch somebody can turn off
   * is not a requirement.
   */
  requiresSecondFactor(roles: readonly Role[]): boolean
  /**
   * What is wrong with a name for a tenant, as a sentence for the screen, or
   * null. The first run asks the same question as the screen that changes the
   * name later, so that no name comes in through one door that the other
   * would refuse.
   */
  tenantNameProblem(name: string): string | null
  /**
   * What else the first account of an instance becomes, beyond the leader of
   * its tenant. Called in the transaction of the first run, outside any
   * tenant and before the step into the new one, so that whatever it writes
   * is there together with the account or not at all.
   */
  readonly firstAccount?: (tx: TenantTransaction, userId: string) => Promise<void>
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
  }
}

/** The rules of the application, for the controllers of the authentication. */
export const ACCESS_RULES = Symbol('AccessRules')
