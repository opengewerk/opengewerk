import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SecondFactorSetup, SetupScreen } from './setup.js'

/**
 * The two screens a fresh installation meets before it is an installation at
 * all, and the one an account meets when its role needs a second factor.
 *
 * Driven through the form rather than through the functions behind it, because
 * the failure worth catching here is the one #62 was about: a screen that
 * looks finished and leads nowhere. What the server is asked is checked as
 * well, since that is the contract these screens keep.
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

/** Everything the first run screen asks for, typed the way a person would. */
async function fillIn(setupCode: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Einrichtungscode'), setupCode)
  await userEvent.type(screen.getByLabelText('Betrieb'), 'Elektro Neubeginn GmbH')
  await userEvent.type(screen.getByLabelText('Ihr Name'), 'Olga Beispiel')
  await userEvent.type(screen.getByLabelText('E-Mail'), 'chefin@neubeginn.example.de')
  await userEvent.type(screen.getByLabelText('Passwort'), 'ein-langes-passwort')
  await userEvent.type(screen.getByLabelText('Passwort wiederholen'), 'ein-langes-passwort')
}

describe('the first run screen', () => {
  /**
   * The code comes first, above everything that describes the business, and
   * says where it is (#215). Where and not what: the screen never knows it.
   */
  it('asks for the setup code first and says where it is', () => {
    render(<SetupScreen onDone={vi.fn()} />)

    const fields = screen.getAllByRole('textbox')
    const code = screen.getByLabelText('Einrichtungscode')

    expect(fields[0]).toBe(code)
    expect(code.getAttribute('aria-describedby')).toBeTruthy()
    expect(
      screen.getByText(
        'Steht auf dem Server in der Datei docker/.env. So richtet nur ein, wer an den Server kommt.',
      ),
    ).toBeDefined()
    expect(screen.getByRole('separator')).toBeDefined()
  })

  it('sends the code, the business and the account, and then signs the person in', async () => {
    serverSays('/setup', { tenantId: 'b-1' })

    const done = vi.fn()
    render(<SetupScreen onDone={done} />)

    await fillIn('k7q4-9pxm')
    await userEvent.click(screen.getByRole('button', { name: 'Betrieb anlegen' }))

    // As typed. Capitals, spaces and the dash are the server's business.
    expect(asked('/setup')?.body).toEqual({
      setupCode: 'k7q4-9pxm',
      company: 'Elektro Neubeginn GmbH',
      name: 'Olga Beispiel',
      email: 'chefin@neubeginn.example.de',
      password: 'ein-langes-passwort',
    })

    // The ordinary sign in afterwards, with the ordinary cookie. A setup that
    // handed out a session of its own would be a second way in to keep right.
    expect(asked('/api/auth/sign-in/email')?.body).toEqual({
      email: 'chefin@neubeginn.example.de',
      password: 'ein-langes-passwort',
    })

    expect(done).toHaveBeenCalled()
  })

  /**
   * A wrong code and too many of them are the server's to say, in its own
   * words. Nobody is signed in afterwards, and the screen stays where it is,
   * with everything still filled in for the next try.
   */
  it('shows why the server turned the code down, and signs nobody in', async () => {
    for (const [status, sentence] of [
      [403, 'Der Einrichtungscode stimmt nicht.'],
      [429, 'Zu viele Versuche. Bitte in einer Viertelstunde erneut versuchen.'],
    ] as const) {
      calls = []
      serverRefuses('/setup', status, sentence)

      const done = vi.fn()
      const { unmount } = render(<SetupScreen onDone={done} />)

      await fillIn('K7Q4-9PXN')
      await userEvent.click(screen.getByRole('button', { name: 'Betrieb anlegen' }))

      expect((await screen.findByRole('alert')).textContent).toBe(sentence)
      expect(asked('/api/auth/sign-in/email')).toBeUndefined()
      expect(done).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Einrichtungscode')).toHaveProperty('value', 'K7Q4-9PXN')
      expect(screen.getByRole('button', { name: 'Betrieb anlegen' })).toHaveProperty(
        'disabled',
        false,
      )

      unmount()
    }
  })

  /**
   * Nobody can reset this password for this person: it is the only account on
   * the instance. A typo in it costs the installation, so it is typed twice
   * and the screen says so before anything is sent.
   */
  it('does not send anything while the two passwords differ', async () => {
    render(<SetupScreen onDone={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Betrieb'), 'Elektro Neubeginn GmbH')
    await userEvent.type(screen.getByLabelText('Passwort'), 'ein-langes-passwort')
    await userEvent.type(screen.getByLabelText('Passwort wiederholen'), 'ein-langes-passwor')

    expect(screen.getByRole('button', { name: 'Betrieb anlegen' })).toHaveProperty('disabled', true)
    expect(asked('/setup')).toBeUndefined()
  })
})

describe('setting up a second factor', () => {
  const totpUri =
    'otpauth://totp/OpenGewerk:chefin%40neubeginn.example.de' +
    '?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPIYDCMRTGQ2Q&issuer=OpenGewerk'

  it('asks for the password, then shows the code and the way back in without a phone', async () => {
    serverSays('/api/auth/two-factor/enable', {
      totpURI: totpUri,
      backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
    })

    render(<SecondFactorSetup onDone={vi.fn()} />)

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
    render(<SecondFactorSetup onDone={done} />)

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
    const { unmount } = render(<SecondFactorSetup onDone={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Später' })).toBeDefined()

    unmount()
    render(<SecondFactorSetup onDone={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Später' })).toBeNull()
  })
})
