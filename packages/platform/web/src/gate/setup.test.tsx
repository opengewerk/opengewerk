import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InProbe } from '../probe-application.js'
import { SecondFactorSetup, SecondFactorSetupScreen, SetupScreen } from './setup.js'

/**
 * The two screens a fresh installation meets before it is an installation at
 * all, and the one an account meets when its role needs a second factor.
 *
 * Driven through the form rather than through the functions behind it, because
 * the failure worth catching here is the one #62 was about: a screen that
 * looks finished and leads nowhere. What the server is asked is checked as
 * well, since that is the contract these screens keep.
 *
 * What a tenant is called, where the setup code stands and for whom a second
 * factor is required are the application's to say (ADR 0010). The one in
 * these tests belongs to nobody.
 */

interface Call {
  readonly path: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { readonly status: number; readonly body: unknown }>

/** A server that answers what it was told to, and remembers what it was asked. */
function serverSays(path: string, answer: unknown): void {
  answers.set(path, { status: 200, body: answer })
}

/** The same server turning a request down, with the sentence Nest puts in `message`. */
function serverRefuses(path: string, status: number, message: string): void {
  answers.set(path, { status, body: { statusCode: status, message } })
}

beforeEach(() => {
  calls = []
  answers = new Map()

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

    const answer = answers.get(path) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function asked(path: string): Call | undefined {
  return calls.find((call) => call.path === path)
}

function firstRun(onDone: () => void = vi.fn()) {
  return render(
    <InProbe>
      <SetupScreen onDone={onDone} />
    </InProbe>,
  )
}

/** Everything the first run screen asks for, typed the way a person would. */
async function fillIn(setupCode: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Einrichtungscode'), setupCode)
  await userEvent.type(screen.getByLabelText('Mandant'), 'Probewerk Neubeginn')
  await userEvent.type(screen.getByLabelText('Ihr Name'), 'Olga Beispiel')
  await userEvent.type(screen.getByLabelText('E-Mail'), 'leitung@neubeginn.example.de')
  await userEvent.type(screen.getByLabelText('Passwort'), 'ein-langes-passwort')
  await userEvent.type(screen.getByLabelText('Passwort wiederholen'), 'ein-langes-passwort')
}

describe('the first run screen', () => {
  /**
   * The code comes first, above everything that describes the tenant, and
   * says where it is (#215). Where and not what: the screen never knows it.
   * Where is the application's to say, since it depends on how the
   * application is installed; why it is asked for is said here.
   */
  it('asks for the setup code first and says where it is', () => {
    firstRun()

    const fields = screen.getAllByRole('textbox')
    const code = screen.getByLabelText('Einrichtungscode')

    expect(fields[0]).toBe(code)
    expect(code.getAttribute('aria-describedby')).toBeTruthy()
    expect(
      screen.getByText(
        'Steht in der Probe auf einem Zettel. So richtet nur ein, wer an den Server kommt.',
      ),
    ).toBeDefined()
    expect(screen.getByRole('separator')).toBeDefined()
  })

  it('says what is made in the words of the application, between what the foundation says', () => {
    firstRun()

    expect(
      screen.getByText(
        'Diese Instanz ist noch leer. Hier entstehen der erste Mandant und das erste Konto. Wer dieses Konto hat, legt später alle weiteren an.',
      ),
    ).toBeDefined()
  })

  /**
   * An instance was once set up under a name nobody had typed, most likely
   * filled in as a company by a password manager (#276). The field no longer
   * invites that, and stops where the server would, which the application
   * says: the rule for the name of a tenant is its own.
   */
  it('keeps the name of the tenant out of the reach of autofill, and as short as the application takes it', () => {
    firstRun()

    const tenant = screen.getByLabelText('Mandant') as HTMLInputElement

    expect(tenant.getAttribute('autocomplete')).toBe('off')
    expect(tenant.name).not.toBe('organization')
    expect(tenant.maxLength).toBe(40)
    expect(tenant.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText('So wie der Mandant heißen soll.')).toBeDefined()
  })

  it('sends the code, the tenant and the account, and then signs the person in', async () => {
    serverSays('/setup', { tenantId: 'b-1' })

    const done = vi.fn()
    firstRun(done)

    await fillIn('k7q4-9pxm')
    await userEvent.click(screen.getByRole('button', { name: 'Mandant anlegen' }))

    // As typed. Capitals, spaces and the dash are the server's business.
    expect(asked('/setup')?.body).toEqual({
      setupCode: 'k7q4-9pxm',
      company: 'Probewerk Neubeginn',
      name: 'Olga Beispiel',
      email: 'leitung@neubeginn.example.de',
      password: 'ein-langes-passwort',
    })

    // The ordinary sign in afterwards, with the ordinary cookie. A setup that
    // handed out a session of its own would be a second way in to keep right.
    expect(asked('/api/auth/sign-in/email')?.body).toEqual({
      email: 'leitung@neubeginn.example.de',
      password: 'ein-langes-passwort',
    })

    expect(done).toHaveBeenCalled()
  })

  /**
   * A wrong code and too many of them are the server's to say, in its own
   * words. Nobody is signed in afterwards, and the screen stays where it is,
   * with everything still filled in for the next try.
   *
   * One test for each, and not both in one: each types the whole form, and
   * in a full run on a busy machine the two together took longer than a test
   * may.
   */
  it.each([
    [403, 'Der Einrichtungscode stimmt nicht.'],
    [429, 'Zu viele Versuche. Bitte in einer Viertelstunde erneut versuchen.'],
  ] as const)(
    'shows why the server turned the code down (%i), and signs nobody in',
    async (status, sentence) => {
      serverRefuses('/setup', status, sentence)

      const done = vi.fn()

      firstRun(done)

      await fillIn('K7Q4-9PXN')
      await userEvent.click(screen.getByRole('button', { name: 'Mandant anlegen' }))

      expect((await screen.findByRole('alert')).textContent).toBe(sentence)
      expect(asked('/api/auth/sign-in/email')).toBeUndefined()
      expect(done).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Einrichtungscode')).toHaveProperty('value', 'K7Q4-9PXN')
      expect(screen.getByRole('button', { name: 'Mandant anlegen' })).toHaveProperty(
        'disabled',
        false,
      )
    },
  )

  /**
   * Nobody can reset this password for this person: it is the only account on
   * the instance. A typo in it costs the installation, so it is typed twice
   * and the screen says so before anything is sent.
   */
  it('does not send anything while the two passwords differ', async () => {
    firstRun()

    await userEvent.type(screen.getByLabelText('Mandant'), 'Probewerk Neubeginn')
    await userEvent.type(screen.getByLabelText('Passwort'), 'ein-langes-passwort')
    await userEvent.type(screen.getByLabelText('Passwort wiederholen'), 'ein-langes-passwor')

    expect(screen.getByRole('button', { name: 'Mandant anlegen' })).toHaveProperty('disabled', true)
    expect(asked('/setup')).toBeUndefined()
  })
})

describe('setting up a second factor', () => {
  const totpUri =
    'otpauth://totp/Probewerk:leitung%40neubeginn.example.de' +
    '?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPIYDCMRTGQ2Q&issuer=Probewerk'

  it('asks for the password, then shows the code and the way back in without a phone', async () => {
    serverSays('/api/auth/two-factor/enable', {
      totpURI: totpUri,
      backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
    })

    render(
      <InProbe>
        <SecondFactorSetup onDone={vi.fn()} />
      </InProbe>,
    )

    await userEvent.type(screen.getByLabelText('Passwort'), 'ein-langes-passwort')
    await userEvent.click(screen.getByRole('button', { name: 'Einrichten' }))

    // The picture, and the same secret in characters underneath it: a machine
    // without a camera has to be able to set this up too.
    const picture = await screen.findByRole('img', { name: 'QR-Code für die Authenticator-App' })
    expect(picture).toBeDefined()
    expect(screen.getByText('MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPIYDCMRTGQ2Q')).toBeDefined()

    // Shown once and never again, which is why they are on the screen and not
    // behind a link.
    const codes = within(screen.getByRole('list'))
    expect(codes.getByText('aaaa-bbbb')).toBeDefined()
    expect(codes.getByText('cccc-dddd')).toBeDefined()

    expect(asked('/api/auth/two-factor/enable')?.body).toEqual({
      password: 'ein-langes-passwort',
      method: 'totp',
    })
  })

  /**
   * Nothing is switched on until a code from the new secret has been checked.
   * A factor that counted as set up a moment earlier is one that locks
   * somebody out of their own instance when the secret was mistyped.
   */
  it('is finished only once a code has been checked', async () => {
    serverSays('/api/auth/two-factor/enable', { totpURI: totpUri, backupCodes: ['aaaa-bbbb'] })

    const done = vi.fn()
    render(
      <InProbe>
        <SecondFactorSetup onDone={done} />
      </InProbe>,
    )

    await userEvent.type(screen.getByLabelText('Passwort'), 'ein-langes-passwort')
    await userEvent.click(screen.getByRole('button', { name: 'Einrichten' }))

    await screen.findByLabelText('Code aus der App')
    expect(done).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Fertig' }))

    expect(asked('/api/auth/two-factor/verify-totp')?.body).toEqual({ code: '123456' })
    expect(done).toHaveBeenCalled()
  })

  it('offers a way out only where there is one', async () => {
    const { unmount } = render(
      <InProbe>
        <SecondFactorSetup onDone={vi.fn()} onCancel={vi.fn()} />
      </InProbe>,
    )

    expect(screen.getByRole('button', { name: 'Später' })).toBeDefined()

    unmount()
    render(
      <InProbe>
        <SecondFactorSetup onDone={vi.fn()} />
      </InProbe>,
    )

    expect(screen.queryByRole('button', { name: 'Später' })).toBeNull()
  })

  /**
   * As the only thing on the screen, for somebody who gets no further without
   * it. For whom that is, the application says in the words it has for its
   * roles; how it is set up is the same everywhere. And there is no way round
   * it: the screen offers none.
   */
  it('says in the gate for whom it is required in the words of the application, and offers no way round', () => {
    render(
      <InProbe>
        <SecondFactorSetupScreen onDone={vi.fn()} />
      </InProbe>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Zweiter Faktor' })).toBeTruthy()
    expect(
      screen.getByText(
        'Wer einen Mandanten leitet, braucht einen zweiten Faktor. Richten Sie ihn mit einer Authenticator-App auf dem Telefon ein.',
      ),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Später' })).toBeNull()
  })
})
