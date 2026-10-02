import type { TenantId } from '@opengewerk/platform-domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RequestRefused } from '../sync/transport.js'
import {
  forgetAccount,
  forgetSignIn,
  keptTenantsKey,
  rememberAccount,
  rememberedAccount,
  rememberedTenants,
  rememberTenants,
  unreachable,
} from './remembered.js'
import type { Account, TenantChoice } from './session.js'

/**
 * What a device keeps of the last answers of the server, so that it opens in
 * a basement: who was signed in, in which tenant, and what their roles add up
 * to there. Nothing of it signs anybody in, and nothing of it allows anything;
 * it only decides what a device shows until the server answers again.
 */

const tenantId = 't-1' as TenantId

const account: Account = {
  userId: 'u-1',
  email: 'erika@probewerk.example.de',
  name: 'Erika Berg',
  tenantId,
  twoFactorEnabled: true,
  signInMethod: 'password',
}

const choice: TenantChoice = {
  id: tenantId,
  name: 'Probewerk Nord',
  roles: ['lead'],
  roleLabels: ['Leitung'],
  rights: ['shelf.read', 'shelf.write'],
  secondFactor: true,
}

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('who was signed in here last', () => {
  it('is kept once a tenant is chosen, and read back as it was', () => {
    rememberAccount(account)

    expect(rememberedAccount()).toEqual(account)
  })

  it('is not kept while the session works in no tenant', () => {
    // Without a tenant there is no store to open, so there is nothing a start
    // without a network could do with the account.
    rememberAccount({ ...account, tenantId: null })

    expect(rememberedAccount()).toBeNull()
    // Not written at all, rather than written and not read: a name and an
    // address that open nothing have no place on the device.
    expect(globalThis.localStorage.getItem('opengewerk.account')).toBeNull()
  })

  it('is nobody when what is kept is not an account', () => {
    for (const kept of [
      'not json',
      '"a string"',
      '{"userId":"u-1"}',
      '{"tenantId":"t-1"}',
      'null',
    ]) {
      globalThis.localStorage.setItem('opengewerk.account', kept)

      expect(rememberedAccount(), kept).toBeNull()
    }
  })

  it('is read with care where a field is not what it should be', () => {
    globalThis.localStorage.setItem(
      'opengewerk.account',
      JSON.stringify({
        userId: 'u-1',
        tenantId,
        email: 7,
        twoFactorEnabled: 'yes',
        signInMethod: 'x',
      }),
    )

    expect(rememberedAccount()).toEqual({
      userId: 'u-1',
      tenantId,
      email: '',
      name: '',
      twoFactorEnabled: false,
      signInMethod: 'password',
    })
  })

  it('is kept under the name every installation already keeps it by', () => {
    // A device finds who was signed in under this name after an update. Under
    // another one it would need a network to open once more.
    rememberAccount(account)

    expect(globalThis.localStorage.getItem('opengewerk.account')).not.toBeNull()
  })

  it('costs nothing but the start without a network where a browser refuses to keep anything', () => {
    // A private window, for instance: every call throws instead of answering.
    const refuse = () => {
      throw new DOMException('refused', 'SecurityError')
    }

    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse })

    expect(() => {
      rememberAccount(account)
      rememberTenants([choice])
      forgetSignIn()
    }).not.toThrow()
    expect(rememberedAccount()).toBeNull()
    expect(rememberedTenants()).toBeNull()
  })
})

describe('the tenants of whoever was signed in here last', () => {
  it('are kept with what the roles add up to in each', () => {
    rememberAccount(account)
    rememberTenants([choice])

    expect(rememberedTenants()).toEqual([choice])
  })

  it('are not read without the account they belong to', () => {
    rememberTenants([choice])

    expect(rememberedTenants()).toBeNull()
  })

  it('are not read when the tenant of the account is not among them', () => {
    // A list without the tenant the device opens is a list of somebody else's.
    rememberAccount(account)
    rememberTenants([{ ...choice, id: 't-2' as TenantId }])

    expect(rememberedTenants()).toBeNull()
  })

  it('are read from the name an application may reach the list by', () => {
    rememberAccount(account)
    globalThis.localStorage.setItem(keptTenantsKey, JSON.stringify([choice]))

    expect(keptTenantsKey).toBe('opengewerk.tenants')
    expect(rememberedTenants()).toEqual([choice])
  })

  it('leave out an entry that is not in the form the server answers in', () => {
    // What a role allows is written nowhere in this code, so an entry with
    // roles and without rights is not one: there is nothing to make rights
    // from. An application that kept such a list rewrites it before this reads.
    rememberAccount(account)
    globalThis.localStorage.setItem(
      keptTenantsKey,
      JSON.stringify([
        choice,
        { id: 't-2', name: 'Probewerk Süd', roles: ['member'] },
        { id: 't-3', name: 'Probewerk West', roles: ['member'], rights: 'all' },
        // Each with one thing missing that the server always says.
        { ...choice, id: 't-4', rights: undefined },
        { ...choice, id: 't-5', roleLabels: undefined },
        { ...choice, id: 't-6', secondFactor: undefined },
        { ...choice, id: 't-7', roles: undefined },
        { ...choice, id: 't-8', name: undefined },
        'not a tenant',
        null,
      ]),
    )

    expect(rememberedTenants()).toEqual([choice])
  })

  it('are nothing when only entries in another form are kept', () => {
    rememberAccount(account)
    globalThis.localStorage.setItem(
      keptTenantsKey,
      JSON.stringify([{ id: tenantId, name: 'Probewerk Nord', roles: ['lead'] }]),
    )

    expect(rememberedTenants()).toBeNull()
  })

  it('are nothing when what is kept is not a list', () => {
    rememberAccount(account)

    for (const kept of ['not json', '{}', '"a string"']) {
      globalThis.localStorage.setItem(keptTenantsKey, kept)

      expect(rememberedTenants(), kept).toBeNull()
    }
  })
})

describe('forgetting', () => {
  it('lets go of the account alone when another tenant is chosen', () => {
    // The list belongs to the person and not to the tenant: choosing another
    // tenant of the same account changes nothing in it.
    rememberAccount(account)
    rememberTenants([choice])
    forgetAccount()

    expect(rememberedAccount()).toBeNull()
    expect(globalThis.localStorage.getItem(keptTenantsKey)).not.toBeNull()
  })

  it('lets go of both when the person changes', () => {
    rememberAccount(account)
    rememberTenants([choice])
    forgetSignIn()

    expect(rememberedAccount()).toBeNull()
    expect(globalThis.localStorage.getItem(keptTenantsKey)).toBeNull()
  })
})

describe('a question nobody answered', () => {
  it('is a lost connection, or a proxy in front of a server that is down', () => {
    expect(unreachable(new TypeError('Failed to fetch'))).toBe(true)

    for (const status of [502, 503, 504]) {
      expect(unreachable(new RequestRefused(status, 'Bad Gateway')), String(status)).toBe(true)
    }
  })

  it('is not an answer of the server, whatever it says', () => {
    // A device must not open on a guess when it could have been told.
    for (const status of [400, 401, 403, 404, 500]) {
      expect(unreachable(new RequestRefused(status, 'no')), String(status)).toBe(false)
    }

    expect(unreachable(new Error('something else'))).toBe(false)
    expect(unreachable(null)).toBe(false)
  })
})
