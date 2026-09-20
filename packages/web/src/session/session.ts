import type { RoleKey, TenantId } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

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
  const answer = await request<SessionAnswer | null>(`${authentication}/get-session`)
  const user = answer?.user

  if (!user || typeof user.id !== 'string') {
    return null
  }

  const tenantId = answer.session?.activeTenantId

  return {
    userId: user.id,
    email: typeof user.email === 'string' ? user.email : '',
    name: typeof user.name === 'string' ? user.name : '',
    tenantId: typeof tenantId === 'string' ? (tenantId as TenantId) : null,
    twoFactorEnabled: user.twoFactorEnabled === true,
  }
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

export interface InvitationEntry {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly roles: readonly RoleKey[]
  readonly expiresAt: string
  readonly invitedBy: string
}

export function staff(): Promise<readonly StaffEntry[]> {
  return request<readonly StaffEntry[]>('/staff')
}

export function openInvitations(): Promise<readonly InvitationEntry[]> {
  return request<readonly InvitationEntry[]>('/staff/invitations')
}

/**
 * Invites somebody, and hands the link back once.
 *
 * The address is put together here rather than on the server, out of the one
 * the browser is already looking at. The server would have to be told an
 * address, and a wrong one would produce links that lead nowhere on exactly
 * the installations nobody tested.
 */
export async function invite(wanted: {
  readonly email: string
  readonly name: string
  readonly roles: readonly RoleKey[]
}): Promise<{ link: string; expiresAt: string }> {
  const answer = await request<{ token: string; expiresAt: string }>('/staff', {
    method: 'POST',
    body: JSON.stringify(wanted),
  })

  return {
    link: `${globalThis.location.origin}${invitationPath}/${answer.token}`,
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
