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
