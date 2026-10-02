import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InProbe } from '../probe-application.js'
import { SignInScreen } from './sign-in.js'

/**
 * Signing in with a passkey (#167), the button under "oder" on the board
 * "Tor-Anmelden". The browser's half is a stand-in that records what it was
 * asked; what the server makes of the answer is in the server's own tests.
 *
 * The one sentence here that names an application names the one over the
 * screen (ADR 0010), which in these tests belongs to nobody.
 */

const browser = vi.hoisted(() => ({
  supported: true,
  asked: [] as unknown[],
  assertion: { id: 'cred-1', rawId: 'cred-1', type: 'public-key' },
}))

vi.mock('@simplewebauthn/browser', () => ({
  WebAuthnError: class extends Error {},
  browserSupportsWebAuthn: () => browser.supported,
  startRegistration: () => Promise.reject(new Error('not in this test')),
  startAuthentication: (options: unknown) => {
    browser.asked.push(options)

    return Promise.resolve(browser.assertion)
  },
}))

interface Call {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

beforeEach(() => {
  calls = []
  answers = new Map()
  browser.supported = true
  browser.asked = []
  answers.set('GET /api/auth/passkey/generate-authenticate-options', {
    status: 200,
    body: { challenge: 'abc', rpId: 'probewerk.example.de', userVerification: 'preferred' },
  })
  answers.set('POST /api/auth/passkey/verify-authentication', {
    status: 200,
    body: { session: {}, user: {} },
  })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    const found = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(found.body), {
        status: found.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signing in with a passkey', () => {
  it('needs no address and asks the browser for the confirmation on the device', async () => {
    const signedIn = vi.fn()

    render(
      <InProbe>
        <SignInScreen onSignedIn={signedIn} onSecondFactor={vi.fn()} />
      </InProbe>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }))

    await waitFor(() => {
      expect(signedIn).toHaveBeenCalledOnce()
    })
    expect(browser.asked).toEqual([
      {
        optionsJSON: {
          challenge: 'abc',
          rpId: 'probewerk.example.de',
          userVerification: 'required',
        },
      },
    ])
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/auth/passkey/verify-authentication',
      body: { response: browser.assertion },
    })
  })

  it('says in German that a passkey is unknown to the application by its name, and stays on the screen', async () => {
    answers.set('POST /api/auth/passkey/verify-authentication', {
      status: 401,
      body: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' },
    })
    const signedIn = vi.fn()

    render(
      <InProbe>
        <SignInScreen onSignedIn={signedIn} onSecondFactor={vi.fn()} />
      </InProbe>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Diesen Passkey kennt Probewerk nicht',
    )
    expect(signedIn).not.toHaveBeenCalled()
  })

  it("passes the server's own sentence on, as for a passkey without confirmation", async () => {
    answers.set('POST /api/auth/passkey/verify-authentication', {
      status: 401,
      body: {
        code: 'USER_VERIFICATION_REQUIRED',
        message:
          'Ein Passkey meldet nur mit Bestätigung am Gerät an, mit Fingerabdruck, Gesicht oder PIN.',
      },
    })

    render(
      <InProbe>
        <SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />
      </InProbe>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Bestätigung am Gerät')
  })

  it('is not offered by a browser that cannot hold a passkey', () => {
    browser.supported = false

    render(
      <InProbe>
        <SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />
      </InProbe>,
    )

    expect(screen.queryByRole('button', { name: 'Mit Passkey anmelden' })).toBeNull()
    expect(screen.queryByText('oder')).toBeNull()
    // The password works as before.
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeTruthy()
  })
})
