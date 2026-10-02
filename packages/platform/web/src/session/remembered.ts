import { isSignInMethod, type TenantId } from '@opengewerk/platform-domain'

import { RequestRefused } from '../sync/transport.js'
import type { Account, TenantChoice } from './session.js'

/**
 * Who was last signed in on this device, and in which tenant.
 *
 * Without it a device could not open without a network (#123): the local
 * store belongs to a tenant, and which tenant was only ever learned from the
 * server. Opened in a basement, the application asked the server who was
 * signed in, got no answer, and showed a sign in form in front of a device
 * full of the day's work.
 *
 * What is kept is what `currentAccount` answered, nothing more: no token, no
 * password, nothing that would sign anybody in. The session cookie stays the
 * only key, and the server still decides at the first request that reaches it.
 * The data of the tenant are on the device anyway, in IndexedDB.
 *
 * In `localStorage` and read with care, because a browser may refuse it, in a
 * private window for instance, and then the device simply behaves as before.
 *
 * The names begin with the organisation in small letters, like the local
 * store and for the same reason: a browser keeps them by the address a page
 * came from, and a device of an installation that looked under another name
 * after an update would need a network to open once more.
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
      signInMethod: isSignInMethod(account.signInMethod) ? account.signInMethod : 'password',
    }
  } catch {
    return null
  }
}

/** On signing out and on choosing another tenant: the next start asks the server. */
export function forgetAccount(): void {
  try {
    globalThis.localStorage.removeItem(key)
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/**
 * The tenants of whoever is signed in here, with what their roles add up to
 * in each (#184).
 *
 * Kept beside the account for the same reason. The screens ask the rights
 * what to show, and a device opened in a basement got no answer and showed
 * nothing that needs a right, with all of it on the device. What is kept
 * allows nothing: every request that reaches the server is decided there, by
 * the rows of the tenant as they stand then.
 *
 * Forgotten with the person and not with the tenant: choosing another tenant
 * of the same account changes nothing in the list.
 *
 * The name is exported for the one case an application has to reach the list
 * itself: a version of it that kept the list in another form rewrites it
 * once, before the first read, in the form below.
 */
export const keptTenantsKey = 'opengewerk.tenants'

export function rememberTenants(tenants: readonly TenantChoice[]): void {
  try {
    globalThis.localStorage.setItem(keptTenantsKey, JSON.stringify(tenants))
  } catch {
    // Not remembered. Offline the screens then show what needs no right.
  }
}

/**
 * The kept list, and only while an account is kept whose tenant is in it.
 * A list without the account it belongs to is a list of somebody else's.
 */
export function rememberedTenants(): readonly TenantChoice[] | null {
  const account = rememberedAccount()

  if (!account) {
    return null
  }

  try {
    const raw = globalThis.localStorage.getItem(keptTenantsKey)
    const kept: unknown = raw ? JSON.parse(raw) : null

    if (!Array.isArray(kept)) {
      return null
    }

    const tenants = kept.flatMap((tenant: unknown) => {
      const choice = keptChoice(tenant)

      return choice ? [choice] : []
    })

    return tenants.some((tenant) => tenant.id === account.tenantId) ? tenants : null
  } catch {
    return null
  }
}

function texts(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * One entry of the kept list, or nothing when it is not one.
 *
 * An entry holds what the server resolved: the keys of the roles, their names
 * in the tenant, the rights they add up to and whether one of them asks for a
 * second factor. An entry in any other form is not read as one: what a role
 * allows is not written in this code (ADR 0010), so there is nothing to make
 * rights from. An application whose earlier versions kept another form puts
 * the list into this one itself, before the first read.
 */
function keptChoice(tenant: unknown): TenantChoice | null {
  if (typeof tenant !== 'object' || tenant === null) {
    return null
  }

  const kept = tenant as Partial<Record<keyof TenantChoice, unknown>>

  if (
    typeof kept.id !== 'string' ||
    typeof kept.name !== 'string' ||
    !texts(kept.roles) ||
    !texts(kept.rights) ||
    !texts(kept.roleLabels) ||
    typeof kept.secondFactor !== 'boolean'
  ) {
    return null
  }

  return {
    id: kept.id as TenantId,
    name: kept.name,
    roles: kept.roles,
    roleLabels: kept.roleLabels,
    rights: kept.rights,
    secondFactor: kept.secondFactor,
  }
}

/** When the person changes: on signing out, and when the server says nobody is signed in. */
export function forgetSignIn(): void {
  forgetAccount()

  try {
    globalThis.localStorage.removeItem(keptTenantsKey)
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
