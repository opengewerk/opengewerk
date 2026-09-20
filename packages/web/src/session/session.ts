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

export interface Account {
  readonly userId: string
  readonly email: string
  readonly name: string
  /** Null until a business has been chosen for this session. */
  readonly tenantId: TenantId | null
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
  readonly user?: { readonly id?: unknown; readonly email?: unknown; readonly name?: unknown }
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
