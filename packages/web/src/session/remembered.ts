import type { TenantId } from '@opengewerk/domain'

import { RequestRefused } from '../sync/transport.js'
import type { Account, TenantChoice } from './session.js'

/**
 * Who was last signed in on this device, and in which business.
 *
 * Without it the site could not open without a network (#123): the local
 * store belongs to a business, and which business was only ever learned from
 * the server. Opened in a basement, the application asked the server who was
 * signed in, got no answer, and showed a sign in form in front of a device
 * full of the day's jobs.
 *
 * What is kept is what `currentAccount` answered, nothing more: no token, no
 * password, nothing that would sign anybody in. The session cookie stays the
 * only key, and the server still decides at the first request that reaches it.
 * The data of the business are on the device anyway, in IndexedDB.
 *
 * In `localStorage` and read with care, because a browser may refuse it, in a
 * private window for instance, and then the device simply behaves as before.
 */
const key = 'opengewerk.account'

export function rememberAccount(account: Account): void {
  if (!account.tenantId) {
    return
  }

  try {
    globalThis.localStorage.setItem(key, JSON.stringify(account))
  } catch {
    // Not remembered. Offline the device then needs the network to open.
  }
}

export function rememberedAccount(): Account | null {
  try {
    const raw = globalThis.localStorage.getItem(key)
    const kept: unknown = raw ? JSON.parse(raw) : null

    if (
      typeof kept !== 'object' ||
      kept === null ||
      typeof (kept as Account).userId !== 'string' ||
      typeof (kept as Account).tenantId !== 'string'
    ) {
      return null
    }

    const account = kept as Account

    return {
      userId: account.userId,
      email: typeof account.email === 'string' ? account.email : '',
      name: typeof account.name === 'string' ? account.name : '',
      tenantId: account.tenantId as TenantId,
      twoFactorEnabled: account.twoFactorEnabled === true,
    }
  } catch {
    return null
  }
}

/** On signing out and on choosing another business: the next start asks the server. */
export function forgetAccount(): void {
  try {
    globalThis.localStorage.removeItem(key)
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/**
 * The businesses of whoever is signed in here, with their roles in each (#184).
 *
 * Kept beside the account for the same reason. The screens ask the roles what
 * to show, and a device opened in a basement got no answer and showed no task,
 * no photo and no working time, with all of them on the device. What is kept
 * allows nothing: every request that reaches the server is decided there, by
 * the roles it holds now.
 *
 * Forgotten with the person and not with the business: choosing another
 * business of the same account changes nothing in the list.
 */
const tenantsKey = 'opengewerk.tenants'

export function rememberTenants(tenants: readonly TenantChoice[]): void {
  try {
    globalThis.localStorage.setItem(tenantsKey, JSON.stringify(tenants))
  } catch {
    // Not remembered. Offline the screens then show what needs no right.
  }
}

/**
 * The kept list, and only while an account is kept whose business is in it.
 * A list without the account it belongs to is a list of somebody else's.
 */
export function rememberedTenants(): readonly TenantChoice[] | null {
  const account = rememberedAccount()

  if (!account) {
    return null
  }

  try {
    const raw = globalThis.localStorage.getItem(tenantsKey)
    const kept: unknown = raw ? JSON.parse(raw) : null

    if (!Array.isArray(kept)) {
      return null
    }

    const tenants = kept.filter(
      (tenant: unknown): tenant is TenantChoice =>
        typeof tenant === 'object' &&
        tenant !== null &&
        typeof (tenant as TenantChoice).id === 'string' &&
        typeof (tenant as TenantChoice).name === 'string' &&
        Array.isArray((tenant as TenantChoice).roles) &&
        (tenant as TenantChoice).roles.every((role) => typeof role === 'string'),
    )

    return tenants.some((tenant) => tenant.id === account.tenantId) ? tenants : null
  } catch {
    return null
  }
}

/** When the person changes: on signing out, and when the server says nobody is signed in. */
export function forgetSignIn(): void {
  forgetAccount()

  try {
    globalThis.localStorage.removeItem(tenantsKey)
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/**
 * Whether a failed question to the server means "nobody answered" rather than
 * an answer. A lost connection throws before any status exists; a proxy in
 * front of a server that is down answers 502, 503 or 504. Anything else is
 * the server speaking, and a device must not open on a guess when it could
 * have been told.
 */
export function unreachable(error: unknown): boolean {
  if (error instanceof RequestRefused) {
    return error.status === 502 || error.status === 503 || error.status === 504
  }

  return error instanceof TypeError
}
