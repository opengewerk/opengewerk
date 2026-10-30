/**
 * What the authentication tells an account by mail, and how it gets it said.
 *
 * It sends nothing itself. An account belongs to the instance and every mail
 * server to a tenant, so which server a message goes through, and whether it
 * waits in an outbox, is decided by whoever sends mail in the application.
 * What is here is the two moments a message is due, as functions an
 * application hands in. Left out, as on a closed instance, nothing is sent
 * and everything else goes on as it does.
 */

/** Who asked for a new password, as better-auth hands them over. */
export interface ResetRequester {
  readonly id: string
  readonly email: string
  readonly name: string
}

/**
 * Sends the link to a new password, or does nothing when there is nobody to
 * send it through.
 *
 * Never awaited by the route that asked. A request for an address that exists
 * would otherwise take as long as a mail server takes, and one for an address
 * that does not would not, and the difference would say which addresses have
 * an account here.
 */
export type PasswordResetMail = (requester: ResetRequester, token: string) => Promise<void>

/** How long a link to a new password works, in seconds. */
export const passwordResetLifetime = 60 * 60

/** The account a passkey was added to, as better-auth hands it over. */
export interface PasskeyOwner {
  readonly id: string
  readonly email: string
  readonly name: string
}

/**
 * Tells an account that a passkey was added to it, or does nothing when
 * nothing sends mail for it.
 *
 * Awaited before the registration answers: a passkey nobody could be told of
 * does not stay, see `createAuthentication`.
 */
export type PasskeyNotice = (
  owner: PasskeyOwner,
  passkey: { readonly id: string; readonly name: string },
) => Promise<void>

/**
 * Tells an account that it has a new set of recovery codes
 * (opengewerk-haustechnik#360), or does nothing when nothing sends mail for
 * it. The codes are a way past the second factor for good, and a new set
 * ends the old one; whoever made it without being the person should not go
 * unnoticed.
 *
 * Not awaited by the route. The new codes are kept by then and shown once,
 * and a mail server that is down this minute must not cost the person the
 * only time they see them.
 */
export type RecoveryCodesNotice = (owner: PasskeyOwner) => Promise<void>

/** What became of the second factor of an account: the app set up, or every one taken away. */
export type SecondFactorChange = 'app' | 'reset'

/**
 * Tells an account that its second factor changed (N6 of the security audit),
 * or does nothing when nothing sends mail for it: the app was set up, and a
 * password had been enough for that, or whoever leads its tenant took every
 * second factor away. Neither should go unnoticed by the person.
 *
 * Not awaited, like the notice of new recovery codes: the change is done and
 * written into the log by then.
 */
export type SecondFactorNotice = (owner: PasskeyOwner, change: SecondFactorChange) => Promise<void>

/** Where the link that confirms an address leads (opengewerk#754), the page of the gate that reads its token. */
export const addressPath = '/adresse'

/**
 * The mails about the address of an account (N28 of the security audit,
 * opengewerk#754), bound to the mail server of the instance.
 *
 * A new address holds only once the link in a mail to it was opened, so
 * `ready` is asked before anything waits for one, and `confirmation` is
 * awaited and throws when the mail server refuses: a link nobody received
 * leaves nothing waiting. `changed` goes to the address an account had and
 * is not awaited; the change is done by then.
 */
export interface AddressMail {
  ready(): Promise<boolean>
  confirmation(
    to: { readonly name: string; readonly email: string },
    facts: { readonly change: boolean; readonly token: string; readonly expiresAt: Date },
  ): Promise<void>
  changed(to: { readonly name: string; readonly email: string }, address: string): Promise<void>
}
