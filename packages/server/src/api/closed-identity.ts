import type { IdentitySource } from './identity.js'

/**
 * The identity source an instance runs with until the authentication is
 * built: it recognises nobody, so every route behind the guard answers 401.
 *
 * This is not the stand in that was rejected when the guard was written. That
 * one would have let everybody through, and a server that starts open is
 * worse than one that does not start. This one lets nobody through, which
 * makes it the safe end of the same choice and is what allows an instance to
 * be started, migrated and measured before there is anywhere to log in.
 *
 * It stays useful afterwards. An operator who wants an instance up and
 * reachable but closed to everyone, during a restore or a migration window,
 * sets no identity source and gets exactly that.
 */
export class ClosedIdentitySource implements IdentitySource {
  async identify(): Promise<null> {
    return null
  }

  /**
   * Closed means closed. Signing in is refused as well, otherwise an operator
   * who switched this on during a restore would still have people getting as
   * far as the company chooser and finding half an application.
   */
  async authenticate(): Promise<null> {
    return null
  }
}
