import type { RoleKey, TenantId } from '@opengewerk/domain'

import { request } from '../sync/transport.js'
import { forgetAccount, rememberAccount, rememberedAccount, unreachable } from './remembered.js'

/**
 * The three steps between opening the application and being able to work,
 * exactly as ADR 0006 cuts them.
 *
 * Who are you, which business, and only then what may you do. The middle step
 * is the one that is easy to skip and impossible to add later: a session that
 * carries no business would have to be given one by every request, and then
 * the answer to "which business" comes from the caller instead of from the
 * session. Row level security would isolate that business perfectly, for
 * whoever asked.
 */

/** Where better-auth's own routes are mounted, in front of the API. */
const authentication = '/api/auth'

/**
 * The shortest password the server accepts for an account somebody sets up
 * for themselves.
 *
 * Said here as well so that the screen can refuse a short one without a round
 * trip, and only here, so that the two screens that ask for a password do not
 * each carry a twelve of their own. The server keeps the same floor and is
 * the one that decides; this is the courtesy in front of it.
 */
export const shortestPassword = 12

export interface Account {
  readonly userId: string
  readonly email: string
  readonly name: string
  /** Null until a business has been chosen for this session. */
  readonly tenantId: TenantId | null
  /**
   * Whether a second factor is set up. Whether one is required follows from
   * the roles of the memberships, so the two are asked separately and only the
   * pair answers "can this person work here" (ADR 0006).
   */
  readonly twoFactorEnabled: boolean
}

export interface TenantChoice {
  readonly id: TenantId
  readonly name: string
  readonly roles: readonly RoleKey[]
}

export interface DeviceEntry {
  readonly sessionId: string
  readonly userAgent: string | null
  readonly deviceId: string | null
  readonly longLived: boolean
  readonly signedInAt: string
  readonly expiresAt: string
  readonly current: boolean
}

/**
 * What signing in produced. `second-factor` is not a failure: the password was
 * right and the account has TOTP switched on, which for an owner it must.
 */
export type SignInOutcome = 'signed-in' | 'second-factor'

interface SessionAnswer {
  readonly user?: {
    readonly id?: unknown
    readonly email?: unknown
    readonly name?: unknown
    readonly twoFactorEnabled?: unknown
  }
  readonly session?: { readonly activeTenantId?: unknown }
}

/** Who is signed in on this browser, or nobody. */
export async function currentAccount(): Promise<Account | null> {
  let answer: SessionAnswer | null

  try {
    answer = await request<SessionAnswer | null>(`${authentication}/get-session`)
  } catch (error) {
    // Nobody answered, which is not the same as "nobody is signed in". The
    // device then works with who was signed in here last, so that the site
    // opens the day's jobs in a basement (#123); the server decides again at
    // the first request that reaches it. With nobody kept, the failure stays
    // a failure and the gate says the device needs a network once.
    const kept = unreachable(error) ? rememberedAccount() : null

    if (kept) {
      return kept
    }

    throw error
  }

  const user = answer?.user

  if (!user || typeof user.id !== 'string') {
    // The server said so, and it decides: nothing kept outlives that.
    forgetAccount()

    return null
  }

  const tenantId = answer?.session?.activeTenantId
  const account: Account = {
    userId: user.id,
    email: typeof user.email === 'string' ? user.email : '',
    name: typeof user.name === 'string' ? user.name : '',
    tenantId: typeof tenantId === 'string' ? (tenantId as TenantId) : null,
    twoFactorEnabled: user.twoFactorEnabled === true,
  }

  rememberAccount(account)

  return account
}

/**
 * Whether this instance has never been used and is waiting to be set up.
 *
 * Asked only when nobody is signed in, which is the one moment the answer
 * matters. A signed in browser never pays for the question.
 */
export async function setupNeeded(): Promise<boolean> {
  const answer = await request<{ needed?: unknown }>('/setup')

  return answer.needed === true
}

export interface FirstRun {
  readonly company: string
  readonly name: string
  readonly email: string
  readonly password: string
}

/**
 * The first business, the first account and the membership between them.
 *
 * Signing in afterwards is a separate call and deliberately so: it is the
 * ordinary sign in, with the ordinary cookie and the ordinary rate limit, and
 * a route that handed out a session of its own would be a second way in to
 * keep right.
 */
export async function runSetup(firstRun: FirstRun): Promise<{ tenantId: TenantId }> {
  return request<{ tenantId: TenantId }>('/setup', {
    method: 'POST',
    body: JSON.stringify(firstRun),
  })
}

/** The secret and the codes a second factor is set up from, shown once. */
export interface SecondFactorStart {
  readonly totpUri: string
  readonly backupCodes: readonly string[]
}

/**
 * Starts setting up a second factor. The password is asked for again because
 * better-auth asks for it: this is the one change to an account that hands out
 * a way in, and a screen somebody walked away from should not be enough.
 *
 * Nothing is switched on yet. The factor counts as set up once a code from it
 * has been checked, which is what keeps a mistyped secret from locking
 * somebody out of their own instance.
 */
export async function startSecondFactor(password: string): Promise<SecondFactorStart> {
  const answer = await request<{ totpURI?: unknown; backupCodes?: unknown }>(
    `${authentication}/two-factor/enable`,
    { method: 'POST', body: JSON.stringify({ password, method: 'totp' }) },
  )

  return {
    totpUri: typeof answer.totpURI === 'string' ? answer.totpURI : '',
    backupCodes: Array.isArray(answer.backupCodes)
      ? answer.backupCodes.filter((code): code is string => typeof code === 'string')
      : [],
  }
}

/**
 * The secret out of the address the authenticator app is fed.
 *
 * For the line under the picture. A camera is the usual way in and a printed
 * row of characters is the way that still works on a machine with no camera,
 * behind a proxy that mangles images, or for somebody who cannot see the code.
 */
export function secretFrom(totpUri: string): string {
  try {
    return new URL(totpUri).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const answer = await request<{ twoFactorRedirect?: boolean }>(`${authentication}/sign-in/email`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  return answer.twoFactorRedirect === true ? 'second-factor' : 'signed-in'
}

export async function verifySecondFactor(code: string): Promise<void> {
  await request(`${authentication}/two-factor/verify-totp`, {
    method: 'POST',
    // `trustDevice` is deliberately not sent. It would let a browser skip the
    // second factor next time, and the second factor is the one thing between
    // a stolen password and a business's books.
    body: JSON.stringify({ code }),
  })
}

/**
 * The second step of a sign in with a recovery code instead of the code from
 * the app, for somebody whose phone is gone (#125). Each code works once.
 */
export async function verifyRecoveryCode(code: string): Promise<void> {
  await request(`${authentication}/two-factor/verify-backup-code`, {
    method: 'POST',
    // `trustDevice` is not sent here either, for the same reason as above.
    body: JSON.stringify({ code: code.trim() }),
  })
}

/** How many recovery codes this account has left; `null` without a second factor. */
export async function recoveryCodesLeft(): Promise<number | null> {
  const answer = await request<{ left?: unknown }>('/auth/recovery-codes')

  return typeof answer.left === 'number' ? answer.left : null
}

/**
 * A new set of recovery codes, which replaces the old one entirely. Asks for
 * the password, because a session left open at a desk must not be enough to
 * make a new way past the second factor.
 */
export async function newRecoveryCodes(password: string): Promise<readonly string[]> {
  const answer = await request<{ backupCodes?: unknown }>(
    `${authentication}/two-factor/generate-backup-codes`,
    { method: 'POST', body: JSON.stringify({ password }) },
  )

  return Array.isArray(answer.backupCodes)
    ? answer.backupCodes.filter((code): code is string => typeof code === 'string')
    : []
}

export function availableTenants(): Promise<readonly TenantChoice[]> {
  return request<readonly TenantChoice[]>('/auth/tenants')
}

/**
 * Picks the business this session works in.
 *
 * The device id goes along on the site entry and not in the office, and that
 * is what decides the length of the session: thirty days on a registered
 * device, twelve hours at a desk somebody walks away from.
 */
export async function chooseTenant(tenantId: TenantId, deviceId?: string): Promise<void> {
  // The business this device opens without a network changes with it; until
  // the new one has been opened, it opens none (#123).
  forgetAccount()
  await request('/auth/tenant', {
    method: 'POST',
    body: JSON.stringify({ tenantId, deviceId }),
  })
}

export function devices(): Promise<readonly DeviceEntry[]> {
  return request<readonly DeviceEntry[]>('/auth/devices')
}

export async function revokeDevice(sessionId: string): Promise<void> {
  await request(`/auth/devices/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export async function signOut(): Promise<void> {
  // First, so that a sign out without a network still leaves nothing for the
  // next start to open on its own (#123).
  forgetAccount()
  await request('/auth/sign-out', { method: 'POST' })
}

/**
 * Who works in this business, and what the office may do about it.
 *
 * Behind `membership.read` and `membership.write`, which only the owner has.
 * The screen that uses them lives in the office application because that is
 * where a desk is, not because the office role reaches it.
 */

export interface StaffEntry {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly roles: readonly RoleKey[]
  /** Null while they work here, a moment in time once they were shut out. */
  readonly blockedAt: string | null
  /** When this business last saw them start work, not the instance. */
  readonly lastSignInAt: string | null
  readonly twoFactorEnabled: boolean
}

/** Where the message with an invitation stands, for one sent by mail. */
export interface InvitationMail {
  readonly status: 'pending' | 'sent' | 'failed'
  readonly sentAt: string | null
  readonly lastError: string | null
}

export interface InvitationEntry {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly roles: readonly RoleKey[]
  readonly expiresAt: string
  readonly invitedBy: string
  /** Null for a link the office passed on itself. */
  readonly mail: InvitationMail | null
}

export function staff(): Promise<readonly StaffEntry[]> {
  return request<readonly StaffEntry[]>('/staff')
}

export function openInvitations(): Promise<readonly InvitationEntry[]> {
  return request<readonly InvitationEntry[]>('/staff/invitations')
}

/**
 * Invites somebody, and hands the link back once, or has it sent by mail.
 *
 * For a link the office passes on, the address is put together here rather
 * than on the server, out of the one the browser is already looking at. The
 * server would have to be told an address, and a wrong one would produce links
 * that lead nowhere on exactly the installations nobody tested.
 *
 * Sent by mail, there is no link to hand back: the server makes the token when
 * the message goes out, and it is in that message and nowhere else.
 */
export async function invite(wanted: {
  readonly email: string
  readonly name: string
  readonly roles: readonly RoleKey[]
  readonly send: 'link' | 'mail'
}): Promise<{ link: string | null; expiresAt: string }> {
  const answer = await request<{ token: string | null; expiresAt: string }>('/staff', {
    method: 'POST',
    body: JSON.stringify(wanted),
  })

  return {
    link:
      answer.token === null
        ? null
        : `${globalThis.location.origin}${invitationPath}/${answer.token}`,
    expiresAt: answer.expiresAt,
  }
}

export async function withdrawInvitation(invitationId: string): Promise<void> {
  await request(`/staff/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' })
}

export async function setRoles(userId: string, roles: readonly RoleKey[]): Promise<void> {
  await request(`/staff/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ roles }),
  })
}

export async function setBlocked(userId: string, blocked: boolean): Promise<void> {
  await request(`/staff/${encodeURIComponent(userId)}/block`, {
    method: blocked ? 'PUT' : 'DELETE',
  })
}

export function staffDevices(userId: string): Promise<readonly DeviceEntry[]> {
  return request<readonly DeviceEntry[]>(`/staff/${encodeURIComponent(userId)}/devices`)
}

export async function revokeStaffDevice(userId: string, sessionId: string): Promise<void> {
  await request(`/staff/${encodeURIComponent(userId)}/devices/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
}

/**
 * The far end of the link, which is a screen somebody reaches before they have
 * an account at all.
 *
 * The path is the one thing both halves have to agree on: the office builds a
 * link with it and the gate recognises one by it. So it is written once, here,
 * rather than as a string in each of the two places.
 */
export const invitationPath = '/einladung'

export type InvitationState = 'open' | 'redeemed' | 'revoked' | 'expired'

export interface InvitationOffer {
  readonly state: InvitationState
  readonly company: string
  readonly name: string
  readonly email: string
  readonly expiresAt: string
  /** Whether this address already has an account, which keeps its password. */
  readonly knownAccount: boolean
}

/**
 * A new password with the old one as confirmation (#126). Every other device
 * of the account is signed out, this one stays.
 */
export async function changePassword(current: string, next: string): Promise<void> {
  await request(`${authentication}/change-password`, {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    }),
  })
}

/**
 * Asks for a link to a new password. The answer is the same whether the
 * address has an account or not, and whether a mail goes out depends on
 * whether a business it works in sends mail at all.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await request(`${authentication}/request-password-reset`, {
    method: 'POST',
    body: JSON.stringify({ email: email.trim() }),
  })
}

/** The new password behind the link, which works once. */
export async function resetPassword(token: string, password: string): Promise<void> {
  await request(`${authentication}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ token, newPassword: password }),
  })
}

/** Where the link in the mail points: this path and the token after it. */
export const passwordResetPath = '/passwort'

/** The token of a link to a new password out of the address bar, or nothing. */
export function passwordResetToken(path: string): string | null {
  if (!path.startsWith(`${passwordResetPath}/`)) {
    return null
  }

  const token = path.slice(passwordResetPath.length + 1).split('/')[0] ?? ''

  return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null
}

/** The token out of the address bar, or nothing. */
export function invitationToken(path: string): string | null {
  if (!path.startsWith(`${invitationPath}/`)) {
    return null
  }

  const token = path.slice(invitationPath.length + 1).split('/')[0] ?? ''

  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}

export function invitationOffer(token: string): Promise<InvitationOffer> {
  return request<InvitationOffer>(`/invitation/${encodeURIComponent(token)}`)
}

/**
 * Uses the link. Signing in afterwards is the ordinary sign in and a separate
 * call, because a route that handed out a session of its own would be a second
 * way in to keep right.
 */
export function redeemInvitation(
  token: string,
  password: string,
): Promise<{ tenantId: TenantId; company: string; email: string; created: boolean }> {
  return request(`/invitation/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}
