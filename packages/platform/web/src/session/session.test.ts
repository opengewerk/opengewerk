import type { TenantId } from '@opengewerk/platform-domain'
import { WebAuthnError } from '@simplewebauthn/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RequestRefused } from '../sync/transport.js'
import { deviceIdentity } from './device.js'
import { passkeyTrouble } from './passkeys.js'
import {
  keptTenantsKey,
  rememberAccount,
  rememberedAccount,
  rememberedTenants,
  rememberTenants,
} from './remembered.js'
import {
  type Account,
  availableTenants,
  chooseTenant,
  correctAccount,
  currentAccount,
  instanceVersion,
  invitationPath,
  invitationToken,
  invite,
  passwordResetToken,
  secretFrom,
  setBlocked,
  setRoles,
  signIn,
  signOut,
  type TenantChoice,
  verifyRecoveryCode,
} from './session.js'

/**
 * The questions of the session as the interface asks them of the server, with
 * a server that answers what the test tells it to. What matters most here is
 * what happens when it does not answer at all: a device then opens with what
 * it kept, and never with more than that.
 */

const tenantId = 't-1' as TenantId

const account: Account = {
  userId: 'u-1',
  email: 'erika@probewerk.example.de',
  name: 'Erika Berg',
  tenantId,
  twoFactorEnabled: false,
  signInMethod: 'password',
}

const choice: TenantChoice = {
  id: tenantId,
  name: 'Probewerk Nord',
  roles: ['member'],
  roleLabels: ['Mitglied'],
  rights: ['shelf.read'],
  secondFactor: false,
}

interface Asked {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let asked: Asked[]
let answers: (path: string) => Response | Error

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  asked = []
  answers = () => json({})

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    asked.push({
      path,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    })

    const answer = answers(path)

    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('who is signed in', () => {
  it('is what the server says, and is kept for a start without a network', async () => {
    answers = () =>
      json({
        user: { id: 'u-1', email: account.email, name: account.name, twoFactorEnabled: false },
        session: { activeTenantId: tenantId, signInMethod: 'password' },
      })

    expect(await currentAccount()).toEqual(account)
    expect(rememberedAccount()).toEqual(account)
  })

  it('is nobody when the server says so, and nothing kept outlives that', async () => {
    rememberAccount(account)
    rememberTenants([choice])
    answers = () => json(null)

    expect(await currentAccount()).toBeNull()
    expect(rememberedAccount()).toBeNull()
    expect(rememberedTenants()).toBeNull()
  })

  it('is who was signed in here last when nobody answers', async () => {
    rememberAccount(account)
    answers = () => new TypeError('Failed to fetch')

    expect(await currentAccount()).toEqual(account)
  })

  it('stays a failure when nobody answers and nobody was ever signed in here', async () => {
    answers = () => new TypeError('Failed to fetch')

    await expect(currentAccount()).rejects.toThrow(TypeError)
  })

  it('stays a failure when the server answers with an error, whoever was kept', async () => {
    // The server spoke. A device must not open on what it kept when it could
    // have been told.
    rememberAccount(account)
    answers = () => json({ message: 'Datenbank nicht erreichbar.' }, 500)

    await expect(currentAccount()).rejects.toThrow(RequestRefused)
  })

  it('takes a sign in the server does not know the kind of for one with a password', async () => {
    answers = () =>
      json({ user: { id: 'u-1' }, session: { activeTenantId: null, signInMethod: 'smoke' } })

    expect(await currentAccount()).toMatchObject({ tenantId: null, signInMethod: 'password' })
  })
})

describe('the tenants of an account', () => {
  it('are what the server says, and are kept', async () => {
    rememberAccount(account)
    answers = () => json([choice])

    expect(await availableTenants()).toEqual([choice])
    expect(rememberedTenants()).toEqual([choice])
  })

  it('are the kept ones when nobody answers', async () => {
    rememberAccount(account)
    rememberTenants([choice])
    answers = () => json({ message: 'Bad Gateway' }, 502)

    expect(await availableTenants()).toEqual([choice])
  })

  it('stay a failure when nobody answers and none are kept', async () => {
    answers = () => new TypeError('Failed to fetch')

    await expect(availableTenants()).rejects.toThrow(TypeError)
  })
})

describe('choosing a tenant', () => {
  it('forgets which one this device opens without a network, before it asks', async () => {
    rememberAccount(account)
    answers = () => new TypeError('Failed to fetch')

    await expect(chooseTenant('t-2' as TenantId, 'device-1')).rejects.toThrow(TypeError)

    // Until the new one has been opened, the device opens none.
    expect(rememberedAccount()).toBeNull()
    expect(asked).toEqual([
      { path: '/auth/tenant', method: 'POST', body: { tenantId: 't-2', deviceId: 'device-1' } },
    ])
  })
})

describe('signing in and out', () => {
  it('says when a second factor is asked for, which is no failure', async () => {
    answers = () => json({ twoFactorRedirect: true })

    expect(await signIn('erika@probewerk.example.de', 'a password of some length')).toBe(
      'second-factor',
    )

    answers = () => json({ token: 'x' })

    expect(await signIn('erika@probewerk.example.de', 'a password of some length')).toBe(
      'signed-in',
    )
  })

  it('leaves nothing for the next start to open, also when nobody hears the sign out', async () => {
    rememberAccount(account)
    rememberTenants([choice])
    answers = () => new TypeError('Failed to fetch')

    await expect(signOut()).rejects.toThrow(TypeError)

    expect(rememberedAccount()).toBeNull()
    expect(globalThis.localStorage.getItem(keptTenantsKey)).toBeNull()
  })

  it('sends a recovery code without the spaces it was copied with', async () => {
    await verifyRecoveryCode('  ab12c-d34ef \n')

    expect(asked.at(-1)?.body).toEqual({ code: 'ab12c-d34ef' })
  })
})

describe('the links somebody reaches the gate with', () => {
  const token = 'A'.repeat(43)

  it('are recognised by their path and the shape of their token', () => {
    expect(invitationToken(`/einladung/${token}`)).toBe(token)
    expect(invitationToken(`/einladung/${token}/und/mehr`)).toBe(token)
    expect(invitationToken(`/einladung/${token.slice(1)}`)).toBeNull()
    expect(invitationToken(`/einladung/${token.slice(1)}!`)).toBeNull()
    expect(invitationToken(`/anderswo/${token}`)).toBeNull()
    expect(invitationToken('/einladung')).toBeNull()

    expect(passwordResetToken('/passwort/abcdefghijklmnop')).toBe('abcdefghijklmnop')
    expect(passwordResetToken('/passwort/zu-kurz')).toBeNull()
    expect(passwordResetToken(`/passwort/${'a'.repeat(65)}`)).toBeNull()
    expect(passwordResetToken(`/einladung/${token}`)).toBeNull()
  })

  it('are put together from the address the browser is at, once, for a link passed on by hand', async () => {
    answers = () => json({ token, expiresAt: '2026-10-09T08:00:00.000Z' })

    const invited = await invite({
      email: 'neu@probewerk.example.de',
      name: 'Neu Hier',
      roles: ['member'],
      send: 'link',
    })

    expect(invited).toEqual({
      link: `${globalThis.location.origin}${invitationPath}/${token}`,
      expiresAt: '2026-10-09T08:00:00.000Z',
    })
  })

  it('are not handed back at all when the server sends them by mail', async () => {
    // The token is made when the message goes out, and is in that message
    // and nowhere else.
    answers = () => json({ token: null, expiresAt: '2026-10-09T08:00:00.000Z' })

    const invited = await invite({
      email: 'neu@probewerk.example.de',
      name: 'Neu Hier',
      roles: ['member'],
      send: 'mail',
    })

    expect(invited.link).toBeNull()
  })
})

describe('what the server is asked for the people of a tenant', () => {
  it('hands on what the application keeps beside a membership, with an invitation and with the roles', async () => {
    answers = () => json({ token: null, expiresAt: '2026-10-09T08:00:00.000Z' })

    await invite({
      email: 'neu@probewerk.example.de',
      name: 'Neu Hier',
      roles: ['member'],
      send: 'mail',
      additions: { shelf: 'A3' },
    })
    await setRoles('u 2', ['guest'], { shelf: 'B1' })

    expect(asked.slice(-2).map((entry) => [entry.method, entry.path, entry.body])).toEqual([
      [
        'POST',
        '/staff',
        {
          email: 'neu@probewerk.example.de',
          name: 'Neu Hier',
          roles: ['member'],
          send: 'mail',
          additions: { shelf: 'A3' },
        },
      ],
      ['PATCH', '/staff/u%202', { roles: ['guest'], additions: { shelf: 'B1' } }],
    ])
  })

  it('names nothing of it where a screen has nothing to say', async () => {
    await setRoles('u 2', ['member'])

    expect(asked.at(-1)?.body).toEqual({ roles: ['member'] })
  })

  it('corrects an account with what is named and nothing else', async () => {
    await correctAccount('u 2', { name: 'Max Mitglied' })
    await correctAccount('u 2', { email: 'max@probewerk.example.de' })

    expect(asked.map((entry) => [entry.method, entry.path, entry.body])).toEqual([
      ['PATCH', '/staff/u%202/account', { name: 'Max Mitglied' }],
      ['PATCH', '/staff/u%202/account', { email: 'max@probewerk.example.de' }],
    ])
  })

  it('shuts somebody out with one method and lets them back in with the other', async () => {
    await setBlocked('u 2', true)
    await setBlocked('u 2', false)

    expect(asked.map((entry) => [entry.method, entry.path])).toEqual([
      ['PUT', '/staff/u%202/block'],
      ['DELETE', '/staff/u%202/block'],
    ])
  })
})

describe('what a screen shows of an answer', () => {
  it('is the secret out of the address an authenticator app is fed, or nothing', () => {
    expect(secretFrom('otpauth://totp/Probewerk:erika?secret=JBSWY3DPEHPK3PXP&issuer=P')).toBe(
      'JBSWY3DPEHPK3PXP',
    )
    expect(secretFrom('otpauth://totp/Probewerk:erika')).toBe('')
    expect(secretFrom('not an address')).toBe('')
  })

  it('is the version the health check names, or none', async () => {
    answers = () => json({ status: 'ok', version: '0.4.0' })
    expect(await instanceVersion()).toBe('0.4.0')

    answers = () => json({ status: 'ok' })
    expect(await instanceVersion()).toBeNull()

    answers = () => json({ status: 'ok', version: '' })
    expect(await instanceVersion()).toBeNull()
  })
})

describe('what went wrong with a passkey', () => {
  const application = { name: 'Probewerk' }
  const fallback = 'Das hat nicht geklappt.'

  it('is the sentence of the server where the refusal is its own', () => {
    const refused = new RequestRefused(403, 'Bitte zuerst noch einmal bestätigen.', {
      code: 'RECONFIRMATION_REQUIRED',
    })

    expect(passkeyTrouble(refused, fallback, application)).toBe(
      'Bitte zuerst noch einmal bestätigen.',
    )
    // A route under `/auth` carries no code: its sentence is one already.
    expect(
      passkeyTrouble(
        new RequestRefused(404, 'Diesen Passkey gibt es nicht.'),
        fallback,
        application,
      ),
    ).toBe('Diesen Passkey gibt es nicht.')
  })

  it('names the application by the name it was given, and by no other', () => {
    const unknown = new RequestRefused(400, 'Passkey not found', { code: 'PASSKEY_NOT_FOUND' })

    expect(passkeyTrouble(unknown, fallback, application)).toBe(
      'Diesen Passkey kennt Probewerk nicht, vielleicht wurde er gelöscht. Die Anmeldung mit dem Passwort geht weiter.',
    )
    expect(passkeyTrouble(unknown, fallback, { name: 'Anderswerk' })).toContain(
      'kennt Anderswerk nicht',
    )
  })

  it('is translated where the plugin or the browser speaks, and the fallback otherwise', () => {
    expect(
      passkeyTrouble(
        new RequestRefused(400, 'Challenge not found', { code: 'CHALLENGE_NOT_FOUND' }),
        fallback,
        application,
      ),
    ).toMatch(/^Die Anfrage an den Browser ist abgelaufen/)
    expect(
      passkeyTrouble(
        new RequestRefused(429, 'Too many requests', { code: 'TOO_MANY' }),
        fallback,
        application,
      ),
    ).toBe('Zu viele Versuche hintereinander. Bitte in einer Minute noch einmal.')
    expect(
      passkeyTrouble(
        new RequestRefused(400, 'Something new', { code: 'SOMETHING_NEW' }),
        fallback,
        application,
      ),
    ).toBe(fallback)
    expect(
      passkeyTrouble(
        new WebAuthnError({
          message: 'aborted',
          code: 'ERROR_CEREMONY_ABORTED',
          cause: new Error('aborted'),
        }),
        fallback,
        application,
      ),
    ).toBe('Abgebrochen, oder die Zeit am Gerät ist abgelaufen.')

    const notAllowed = new Error('The operation is not allowed')

    notAllowed.name = 'NotAllowedError'

    expect(passkeyTrouble(notAllowed, fallback, application)).toBe(
      'Abgebrochen, oder die Zeit am Gerät ist abgelaufen.',
    )
    expect(passkeyTrouble(new Error('anything else'), fallback, application)).toBe(fallback)
  })
})

describe('the identity of a device', () => {
  it('is minted once and kept, under the name every installation keeps it by', () => {
    const first = deviceIdentity()

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(deviceIdentity()).toBe(first)
    expect(globalThis.localStorage.getItem('opengewerk.device')).toBe(first)
  })

  it('is a fresh one every time where a browser refuses to keep it', () => {
    // A longer device list and nothing worse; refusing to run would be worse.
    const refusing = {
      getItem: () => {
        throw new DOMException('refused', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('refused', 'SecurityError')
      },
    } as unknown as Storage

    const one = deviceIdentity(refusing)
    const two = deviceIdentity(refusing)

    expect(one).toMatch(/^[0-9a-f-]{36}$/)
    expect(two).not.toBe(one)
  })
})
