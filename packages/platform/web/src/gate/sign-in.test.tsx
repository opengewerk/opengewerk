import type { TenantId } from '@opengewerk/platform-domain'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InProbe, probeApplication } from '../probe-application.js'
import type { TenantChoice } from '../session/session.js'
import { PasswordResetScreen } from './password-reset.js'
import { SecondFactorScreen, SignInScreen, TenantScreen } from './sign-in.js'

/**
 * The sign in and the two steps after it: the second factor, with the code
 * from the app or with a recovery code for somebody whose phone is gone
 * (#125), and the choice of a tenant. Before #125 the recovery codes were
 * shown at the setup and could be used nowhere: the sign in only knew the code
 * from the app.
 *
 * Every sentence that names a tenant, whoever leads one or a place in an
 * application is the application's (ADR 0010). The one here belongs to
 * nobody, and a sentence of it on the screen came from the value over the
 * screen. What the foundation says itself is held word for word beside it.
 */

interface Call {
  readonly path: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, unknown>
let down: Set<string>

beforeEach(() => {
  calls = []
  answers = new Map()
  down = new Set()

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

    if (down.has(path)) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the sign in', () => {
  it('says for whom the second factor is required in the words of the application, and what follows in its own', () => {
    render(
      <InProbe>
        <SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />
      </InProbe>,
    )

    expect(
      screen.getByText(
        'Für die Leitung ist der zweite Faktor Pflicht. Nach dem Passwort folgt dann der Code aus der App; ein Passkey zählt selbst als zweiter Faktor.',
      ),
    ).toBeTruthy()
  })

  it('shows over the card what the application puts there, and nothing where it puts nothing', () => {
    const { unmount } = render(
      <InProbe
        application={probeApplication({
          beforeSignIn: <p role="note">Nach der Anmeldung öffnet sich das Regal.</p>,
        })}
      >
        <SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />
      </InProbe>,
    )

    expect(screen.getByRole('note').textContent).toBe('Nach der Anmeldung öffnet sich das Regal.')
    unmount()

    render(
      <InProbe>
        <SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />
      </InProbe>,
    )

    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('the second step of a sign in', () => {
  it('asks for the code from the app, as it always has', async () => {
    const verified = vi.fn()

    render(
      <InProbe>
        <SecondFactorScreen onVerified={verified} />
      </InProbe>,
    )
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(calls.map((call) => call.path)).toEqual(['/api/auth/two-factor/verify-totp'])
    expect(verified).toHaveBeenCalledOnce()
  })

  it('takes a recovery code instead, and says how many are left before going on', async () => {
    answers.set('/auth/recovery-codes', { left: 9 })

    const verified = vi.fn()

    render(
      <InProbe>
        <SecondFactorScreen onVerified={verified} />
      </InProbe>,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Telefon nicht zur Hand? Wiederherstellungscode' }),
    )
    await userEvent.type(screen.getByLabelText('Wiederherstellungscode'), ' Ab3dE-fG7hJ ')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(calls[0]).toEqual({
      path: '/api/auth/two-factor/verify-backup-code',
      body: { code: 'Ab3dE-fG7hJ' },
    })
    // How many are left is the foundation's to count. Where new ones are made
    // is the application's to say: it knows where it put the account.
    expect(
      await screen.findByText(
        'Der Code ist eingelöst. Es sind noch 9 Wiederherstellungscodes übrig. Neue Codes gibt es im Probewerk unter "Konto".',
      ),
    ).toBeTruthy()
    // Not yet: the count is worth a moment before the application opens.
    expect(verified).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(verified).toHaveBeenCalledOnce()
  })

  it.each([
    [{ left: 1 }, 'Der Code ist eingelöst. Es ist noch ein Wiederherstellungscode übrig.'],
    [{}, 'Der Code ist eingelöst und gilt kein zweites Mal.'],
  ])('counts what is left in a sentence that fits (%j)', async (answer, counted) => {
    answers.set('/auth/recovery-codes', answer)

    render(
      <InProbe>
        <SecondFactorScreen onVerified={vi.fn()} />
      </InProbe>,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Telefon nicht zur Hand? Wiederherstellungscode' }),
    )
    await userEvent.type(screen.getByLabelText('Wiederherstellungscode'), 'Ab3dE-fG7hJ')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(
      await screen.findByText(`${counted} Neue Codes gibt es im Probewerk unter "Konto".`),
    ).toBeTruthy()
  })
})

describe('a forgotten password', () => {
  it('asks for a link for the address in the field, and says the same either way', async () => {
    render(
      <InProbe>
        <SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />
      </InProbe>,
    )

    await userEvent.type(screen.getByLabelText('E-Mail'), ' mitglied@nord.example.de ')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    expect(calls[0]).toEqual({
      path: '/api/auth/request-password-reset',
      body: { email: 'mitglied@nord.example.de' },
    })
    // When a link goes out and who helps when none arrives is the
    // application's to say. How long it holds is decided here, and stands
    // between the two.
    expect((await screen.findByRole('status')).textContent).toBe(
      'Gibt es zu dieser Adresse einen Zugang, ist ein Link zu einem neuen Passwort unterwegs. ' +
        'Er gilt eine Stunde. ' +
        'Kommt keiner an, hilft die Leitung des Mandanten.',
    )
  })

  it('wants the address first, before it asks for anything', async () => {
    render(
      <InProbe>
        <SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />
      </InProbe>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    expect(calls).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('E-Mail-Adresse')
  })

  it('sets the new password behind the link, twelve characters and twice the same', async () => {
    render(
      <InProbe>
        <PasswordResetScreen token="abcdefghijklmnopqrstuvwx" />
      </InProbe>,
    )

    await userEvent.type(screen.getByLabelText('Neues Passwort'), 'zu-kurz')
    await userEvent.type(screen.getByLabelText('Neues Passwort wiederholen'), 'zu-kurz')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort setzen' }))

    expect(calls).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('12 Zeichen')

    await userEvent.clear(screen.getByLabelText('Neues Passwort'))
    await userEvent.clear(screen.getByLabelText('Neues Passwort wiederholen'))
    await userEvent.type(screen.getByLabelText('Neues Passwort'), 'ein-neues-langes-passwort')
    await userEvent.type(
      screen.getByLabelText('Neues Passwort wiederholen'),
      'ein-neues-langes-passwort',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Passwort setzen' }))

    expect(calls[0]).toEqual({
      path: '/api/auth/reset-password',
      body: { token: 'abcdefghijklmnopqrstuvwx', newPassword: 'ein-neues-langes-passwort' },
    })
    expect(await screen.findByRole('heading', { name: 'Passwort gesetzt' })).toBeTruthy()
  })
})

describe('the choice of a tenant', () => {
  function aTenant(
    over: Partial<Omit<TenantChoice, 'id'>> & { readonly id: string },
  ): TenantChoice {
    return {
      name: 'Probewerk Nord',
      roles: ['member'],
      roleLabels: ['Mitglied'],
      rights: [],
      secondFactor: false,
      ...over,
      id: over.id as TenantId,
    }
  }

  const two = [
    aTenant({ id: 't-nord', name: 'Probewerk Nord', roles: ['lead'], roleLabels: ['Leitung'] }),
    aTenant({ id: 't-sued', name: 'Probewerk Süd' }),
  ]

  it('offers each tenant of the account by name, under the heading of the application', () => {
    render(
      <InProbe>
        <TenantScreen
          entry="office"
          deviceId="device"
          tenants={two}
          onChosen={vi.fn()}
          onSignedOut={vi.fn()}
        />
      </InProbe>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Mandant wählen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Probewerk Nord/ }).textContent).toBe(
      'Probewerk NordLeitung',
    )
    expect(screen.getByRole('button', { name: /Probewerk Süd/ }).textContent).toBe(
      'Probewerk SüdMitglied',
    )
  })

  /**
   * The device goes along from the site and not from a desk: that is what
   * makes a session a long one, and a desk is a thing people walk away from.
   */
  it.each([
    ['site', { tenantId: 't-sued', deviceId: 'device' }],
    ['office', { tenantId: 't-sued' }],
  ] as const)('names the device with the choice only from the %s', async (entry, sent) => {
    const chosen = vi.fn()

    render(
      <InProbe>
        <TenantScreen
          entry={entry}
          deviceId="device"
          tenants={two}
          onChosen={chosen}
          onSignedOut={vi.fn()}
        />
      </InProbe>,
    )
    await userEvent.click(screen.getByRole('button', { name: /Probewerk Süd/ }))

    expect(calls).toEqual([{ path: '/auth/tenant', body: sent }])
    expect(chosen).toHaveBeenCalledOnce()
  })

  it('says in the words of the application that one could not be chosen, and offers the choice again', async () => {
    down.add('/auth/tenant')
    const chosen = vi.fn()

    render(
      <InProbe>
        <TenantScreen
          entry="office"
          deviceId="device"
          tenants={two}
          onChosen={chosen}
          onSignedOut={vi.fn()}
        />
      </InProbe>,
    )
    await userEvent.click(screen.getByRole('button', { name: /Probewerk Süd/ }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Mandant ließ sich nicht auswählen.',
    )
    expect(chosen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Probewerk Nord/ })).toHaveProperty('disabled', false)
  })

  it('tells an account that belongs to none so, in the words of the application, with the way out', () => {
    render(
      <InProbe>
        <TenantScreen
          entry="office"
          deviceId="device"
          tenants={[]}
          onChosen={vi.fn()}
          onSignedOut={vi.fn()}
        />
      </InProbe>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Kein Mandant' })).toBeTruthy()
    expect(screen.getByText('Dieses Konto gehört zu keinem Mandanten.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeTruthy()
  })
})
