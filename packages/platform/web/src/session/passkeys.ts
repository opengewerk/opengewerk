import type { PasskeyEntry } from '@opengewerk/platform-domain'
import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser'

import { RequestRefused, request } from '../sync/transport.js'

/**
 * Passkeys (#167, #248): the list under "Konto", renaming and deleting one,
 * confirming again before adding one, adding it, and signing in with it.
 *
 * Adding and signing in go through better-auth's passkey plugin under
 * `/api/auth`, the rest through the server's own routes under `/auth`, which
 * write every change into the log of the tenants.
 */

const authentication = '/api/auth'

/** Whether this browser can hold a passkey at all. Without it, the buttons stay away. */
export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

export function passkeys(): Promise<readonly PasskeyEntry[]> {
  return request<readonly PasskeyEntry[]>('/auth/passkeys')
}

export async function renamePasskey(passkeyId: string, name: string): Promise<void> {
  await request(`/auth/passkeys/${encodeURIComponent(passkeyId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export async function removePasskey(passkeyId: string): Promise<void> {
  await request(`/auth/passkeys/${encodeURIComponent(passkeyId)}`, { method: 'DELETE' })
}

/**
 * Confirms again with the password and, where the account has the app, the
 * code (#167). Adding a passkey is only open for a few minutes after it.
 */
export async function reconfirm(password: string, code: string | null): Promise<void> {
  await request(`${authentication}/reconfirm`, {
    method: 'POST',
    body: JSON.stringify(code === null ? { password } : { password, code }),
  })
}

/**
 * Adds a passkey on this device: the server's options, the browser's question
 * for fingerprint, face or PIN, and the answer back with the name.
 */
export async function addPasskey(name: string): Promise<void> {
  const optionsJSON = await request<PublicKeyCredentialCreationOptionsJSON>(
    `${authentication}/passkey/generate-register-options`,
  )
  const response = await startRegistration({ optionsJSON })

  await request(`${authentication}/passkey/verify-registration`, {
    method: 'POST',
    body: JSON.stringify({ response, name: name.trim() }),
  })
}

/**
 * Signs in with a passkey, without an address: the browser offers the
 * passkeys it holds for this instance.
 *
 * The server takes only a sign in confirmed on the device, and says so to the
 * browser here as well: the plugin asks for the confirmation only where the
 * device offers it, and a security key without a PIN would then sign a
 * request the server refuses, with nobody asked for anything.
 */
export async function signInWithPasskey(): Promise<void> {
  const options = await request<PublicKeyCredentialRequestOptionsJSON>(
    `${authentication}/passkey/generate-authenticate-options`,
  )
  const response = await startAuthentication({
    optionsJSON: { ...options, userVerification: 'required' },
  })

  await request(`${authentication}/passkey/verify-authentication`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  })
}

/**
 * Refusals of better-auth's plugin, which speaks English, in the words of the
 * screen. One of them names the application, by the name it goes by.
 */
function pluginWords(name: string): Readonly<Record<string, string>> {
  return {
    CHALLENGE_NOT_FOUND:
      'Die Anfrage an den Browser ist abgelaufen. Bitte noch einmal von vorn, sie gilt fünf Minuten.',
    PASSKEY_NOT_FOUND: `Diesen Passkey kennt ${name} nicht, vielleicht wurde er gelöscht. Die Anmeldung mit dem Passwort geht weiter.`,
    AUTHENTICATION_FAILED: 'Die Anmeldung mit dem Passkey ging nicht durch.',
    FAILED_TO_VERIFY_REGISTRATION: 'Der Passkey ließ sich nicht prüfen und ist nicht angelegt.',
    SESSION_REQUIRED: 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.',
  }
}

/** Refusals of the browser, by their reason. */
const browserWords: Readonly<Partial<Record<WebAuthnError['code'], string>>> = {
  ERROR_CEREMONY_ABORTED: 'Abgebrochen, oder die Zeit am Gerät ist abgelaufen.',
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED:
    'Auf diesem Gerät liegt schon ein Passkey für dieses Konto.',
  // A passkey belongs to the first address the instance is set up with; under a
  // second one, or an IP address, the browser refuses it.
  ERROR_INVALID_DOMAIN:
    'Passkeys gehen nur unter der Hauptadresse dieser Instanz, nicht unter einer weiteren und nicht über eine IP-Adresse.',
  ERROR_INVALID_RP_ID:
    'Passkeys gehen nur unter der Hauptadresse dieser Instanz, nicht unter einer weiteren und nicht über eine IP-Adresse.',
  ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT:
    'Dieses Gerät kann nicht mit Fingerabdruck, Gesicht oder PIN bestätigen.',
  ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT:
    'Dieser Schlüssel kann keinen Passkey halten, der ohne E-Mail-Adresse anmeldet.',
}

/**
 * The refusals of this server around passkeys, which carry their sentence in
 * German. Everything else from under `/api/auth` is better-auth's, in English.
 */
const ownCodes: ReadonlySet<string> = new Set([
  'RECONFIRMATION_REQUIRED',
  'USER_VERIFICATION_REQUIRED',
  'INVALID_PASSWORD',
  'INVALID_CODE',
  'CODE_REQUIRED',
  'ACCOUNT_TEMPORARILY_LOCKED',
  'NO_PASSWORD',
  'TOTP_NOT_ENABLED',
  'PASSKEY_NAME_INVALID',
  'PASSKEY_WITHOUT_SESSION',
  'PASSKEY_NOT_RECORDED',
])

/**
 * What went wrong with a passkey, in a sentence for the screen. The server's
 * own refusals say it themselves; the plugin's and the browser's are
 * translated; anything else gets the fallback.
 *
 * The application says what it is called: one of the sentences names it,
 * and the name a person reads is the application's to give (ADR 0010).
 */
export function passkeyTrouble(
  error: unknown,
  fallback: string,
  application: { readonly name: string },
): string {
  if (error instanceof WebAuthnError) {
    return browserWords[error.code] ?? fallback
  }

  if (error instanceof RequestRefused) {
    const code = (error.body as { code?: unknown } | null)?.code

    if (typeof code !== 'string') {
      // A route of ours under `/auth`, whose refusals are sentences already.
      return error.message
    }

    if (ownCodes.has(code)) {
      return error.message
    }

    if (error.status === 429) {
      return 'Zu viele Versuche hintereinander. Bitte in einer Minute noch einmal.'
    }

    return pluginWords(application.name)[code] ?? fallback
  }

  if (error instanceof Error && error.name === 'NotAllowedError') {
    return browserWords.ERROR_CEREMONY_ABORTED ?? fallback
  }

  return fallback
}
