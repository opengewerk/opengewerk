import type { TenantId } from '@opengewerk/domain'

import { RequestRefused } from '../sync/transport.js'
import type { Account } from './session.js'

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
