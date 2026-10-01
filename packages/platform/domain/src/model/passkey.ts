/**
 * Passkeys (#167, #248): a way to sign in without a password, confirmed on the
 * device with a fingerprint, a face or a PIN.
 *
 * A passkey belongs to an account and so to the instance, like the password,
 * and opens every business the account works in. Only one that was confirmed
 * on the device is taken, at registration and at every sign in; such a sign
 * in counts as the second factor, which is what ADR 0006 leaves open and
 * Moritz decided on 24.09.2026 (#190).
 */

/** How a session came to be: with the password, or with a passkey. */
export const signInMethods = ['password', 'passkey'] as const

export type SignInMethod = (typeof signInMethods)[number]

export function isSignInMethod(value: unknown): value is SignInMethod {
  return typeof value === 'string' && (signInMethods as readonly string[]).includes(value)
}

/**
 * Whether a session carries a second factor.
 *
 * With the password it does when the account has the app set up: better-auth
 * then asks for the code before there is a session at all. With a passkey it
 * always does, because only one confirmed on the device signs in, and that
 * confirmation is the second factor the password lacks. The server asks this
 * on every request of a role that needs it, the screen before offering the
 * setup of the app.
 */
export function hasSecondFactor(session: {
  readonly twoFactorEnabled: boolean | null | undefined
  readonly signInMethod: string | null | undefined
}): boolean {
  return session.twoFactorEnabled === true || session.signInMethod === 'passkey'
}

/** The longest name a passkey may be given, "Laptop Büro" and a good deal more. */
export const passkeyNameMaxLength = 60

/**
 * Why a name for a passkey is not one, or null when it is.
 *
 * Asked when a passkey is added and when it is renamed, by the screen before
 * sending and by the server before writing, with the same sentence. Spaces
 * around the name do not count; both store it trimmed.
 */
export function passkeyNameProblem(name: string): string | null {
  const trimmed = name.trim()

  if (trimmed === '') {
    return 'Der Passkey braucht einen Namen, damit er sich in der Liste von den anderen unterscheiden lässt.'
  }

  if (trimmed.length > passkeyNameMaxLength) {
    return `Der Name eines Passkeys hat höchstens ${String(passkeyNameMaxLength)} Zeichen.`
  }

  return null
}

/** One passkey of the signed in account, as "Konto" lists it. */
export interface PasskeyEntry {
  readonly id: string
  readonly name: string
  /** When it was added, ISO 8601. */
  readonly createdAt: string
  /** When it last signed in, ISO 8601, or null while it never has. */
  readonly lastUsedAt: string | null
  /**
   * Where the passkey is kept, "Windows Hello" or "Proton Pass", where the
   * authenticator says so. Many do not, and then this is null.
   */
  readonly provider: string | null
}
