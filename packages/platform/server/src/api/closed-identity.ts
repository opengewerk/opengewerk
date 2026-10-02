import type { IdentitySource } from './identity.js'

/**
 * The identity source of a closed instance: it recognises nobody, so every
 * route behind the guard answers 401.
 *
 * This is not a stand in that lets everybody through; a server that starts
 * open is worse than one that does not start. This one lets nobody through,
 * which is the safe end of the same choice and is what allows an instance to
 * be started, migrated and measured before there is anywhere to sign in.
 *
 * Whoever runs an instance and wants it up and reachable but closed to
 * everyone, during a restore or a migration window, gets exactly that.
 */
export class ClosedIdentitySource implements IdentitySource {
  async identify(): Promise<null> {
    return null
  }

  /**
   * Closed means closed. Signing in is refused as well, otherwise somebody who
   * switched this on during a restore would still have people getting as far
   * as the chooser of tenants and finding half an application.
   */
  async authenticate(): Promise<null> {
    return null
  }
}
