import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InProbe } from '../probe-application.js'
import { invitationToken } from '../session/session.js'
import { InvitationScreen } from './invitation.js'

/**
 * The screen at the far end of a one time link, and the piece of the address
 * bar that leads to it.
 *
 * Driven through the form rather than through the functions behind it, for the
 * same reason `setup.test.tsx` is: the failure worth catching is a screen that
 * looks finished and leads nowhere. What is measured besides is the one thing
 * the whole link exists for, that the password reaches the server from this
 * screen and from no other.
 *
 * Who invited is a tenant, and what that is called the application says
 * (ADR 0010). The one in these tests belongs to nobody.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

const token = 'a'.repeat(43)

let calls: Call[]
let answers: Map<string, unknown>
let went: string | null

/**
 * What the server answers for one call. Keyed by method as well as path,
 * because this screen reads and writes the same path and the two answers say
 * different things.
 */
function serverSays(method: string, path: string, answer: unknown): void {
  answers.set(`${method} ${path}`, answer)
}

/**
 * One call, by path and by method.
 *
 * The method is part of the question here and not decoration: this screen asks
 * the same path twice, once to find out what the link is and once to use it,
 * and a helper that returned the first match would have quietly measured the
 * reading half of that pair.
 */
function asked(path: string, method = 'GET'): Call | undefined {
  return calls.find((call) => call.path === path && call.method === method)
}

function inQueries(node: ReactNode) {
  // A client per test, so that one test's answers are not another's cache.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InProbe>{node}</InProbe>
    </QueryClientProvider>
  )
}

/** A link as the server describes it, for somebody new unless the test says otherwise. */
function offer(over: Readonly<Record<string, unknown>> = {}) {
  return {
    state: 'open',
    company: 'Probewerk Nord',
    name: 'Nele Neu',
    email: 'neue@nord.example.de',
    expiresAt: new Date().toISOString(),
    knownAccount: false,
    ...over,
  }
}

beforeEach(() => {
  calls = []
  answers = new Map()
  went = null

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(`${init?.method ?? 'GET'} ${path}`) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  vi.stubGlobal('location', {
    origin: 'https://probewerk.example.de',
    pathname: '/',
    assign: (to: string) => {
      went = to
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the token in the address', () => {
  it('is found where a link puts it and nowhere else', () => {
    expect(invitationToken(`/einladung/${token}`)).toBe(token)
    expect(invitationToken('/')).toBeNull()
    expect(invitationToken('/regale/abc')).toBeNull()
    // The right path with something that is not a token. Refused here rather
    // than sent, so that a pasted line with a word missing costs nothing.
    expect(invitationToken('/einladung/zu-kurz')).toBeNull()
  })
})

describe('redeeming a link', () => {
  it('names the tenant, takes a password and signs the person in with it', async () => {
    serverSays('GET', `/invitation/${token}`, offer())
    serverSays('POST', `/invitation/${token}`, { created: true })

    render(inQueries(<InvitationScreen token={token} />))

    // The tenant has to be on the screen: somebody who was handed a link in a
    // message has to recognise what they are joining before they type
    // anything.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Willkommen bei Probewerk Nord' }),
    ).toBeTruthy()
    // Who made the account is the application's sentence, with the name and
    // the address set into it as the foundation marks them up.
    expect(screen.getByText('Nele Neu').tagName).toBe('STRONG')
    expect(screen.getByText('neue@nord.example.de').tagName).toBe('STRONG')
    expect(screen.getByText('Nele Neu').parentElement?.textContent).toBe(
      'Ein Mandant hat für Nele Neu einen Zugang mit der Adresse neue@nord.example.de angelegt.',
    )

    const person = userEvent.setup()
    const fields = screen.getAllByLabelText(/Passwort/)

    await person.type(fields[0] as HTMLElement, 'was-nur-nele-kennt')
    await person.type(fields[1] as HTMLElement, 'was-nur-nele-kennt')
    await person.click(screen.getByRole('button', { name: 'Zugang einrichten' }))

    const redeemed = asked(`/invitation/${token}`, 'POST')
    expect(redeemed?.body).toEqual({ password: 'was-nur-nele-kennt' })

    // The ordinary sign in afterwards, with the ordinary cookie. A redemption
    // that handed out a session of its own would be a second way in to keep
    // right.
    expect(asked('/api/auth/sign-in/email', 'POST')?.body).toEqual({
      email: 'neue@nord.example.de',
      password: 'was-nur-nele-kennt',
    })

    // And the token is left behind rather than sitting in the history of a
    // machine somebody borrowed.
    expect(went).toBe('/')
  })

  it('sends nothing while the two passwords differ', async () => {
    serverSays('GET', `/invitation/${token}`, offer())

    render(inQueries(<InvitationScreen token={token} />))
    await screen.findByRole('heading', { name: 'Willkommen bei Probewerk Nord' })

    const person = userEvent.setup()
    const fields = screen.getAllByLabelText(/Passwort/)

    await person.type(fields[0] as HTMLElement, 'ein-langes-passwort')
    await person.type(fields[1] as HTMLElement, 'ein-anderes-passwort')

    expect(screen.getByRole('button', { name: 'Zugang einrichten' }).hasAttribute('disabled')).toBe(
      true,
    )
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  /**
   * A link that has been used says so, and says it differently from one that
   * never existed. Only one of the two is worth a second look from the person
   * holding it, and telling them apart is the whole reason the server answers
   * with a state rather than a yes or no. Who to turn to is a tenant, so each
   * of the three is the application's to say.
   */
  it.each([
    ['redeemed', 'Er wurde schon benutzt. Der Mandant weiß mehr.'],
    ['revoked', 'Der Mandant hat ihn zurückgezogen.'],
    ['expired', 'Er ist abgelaufen. Der Mandant erzeugt einen neuen.'],
  ])('says which kind of nothing a link is that was %s', async (state, sentence) => {
    serverSays('GET', `/invitation/${token}`, offer({ state, knownAccount: true }))

    render(inQueries(<InvitationScreen token={token} />))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dieser Link gilt nicht mehr' }),
    ).toBeTruthy()
    expect(screen.getByText(sentence)).toBeTruthy()
    expect(screen.queryByLabelText(/Passwort/)).toBeNull()
  })
})

/**
 * An address that already has an account keeps its password, and joins signed
 * in as that account and only so (opengewerk-haustechnik#31). Asking for a new
 * password would either do nothing or change the password of an account this
 * tenant has nothing to do with; taking the link alone would let whoever holds
 * it, the lead who invited when no mail went out, put somebody else's account
 * into their tenant.
 */
describe('a link for an address that already has an account', () => {
  const lea = { id: 'konto-lea', email: 'lea@example.de', name: 'Lea Leitung' }

  beforeEach(() => {
    serverSays(
      'GET',
      `/invitation/${token}`,
      offer({ name: lea.name, email: lea.email, knownAccount: true }),
    )
  })

  it('asks to sign in with that account first, with the address filled in, and joins only then', async () => {
    render(inQueries(<InvitationScreen token={token} />))

    expect(await screen.findByRole('heading', { level: 1, name: 'Anmelden' })).toBeTruthy()
    expect(screen.getByText('lea@example.de').parentElement?.textContent).toBe(
      'Für lea@example.de gibt es auf dieser Instanz schon ein Konto. Melden Sie sich damit an, ' +
        'dann können Sie Probewerk Nord beitreten.',
    )
    expect((screen.getByLabelText('E-Mail') as HTMLInputElement).value).toBe(lea.email)
    expect(screen.queryByRole('button', { name: 'Mandant übernehmen' })).toBeNull()

    const person = userEvent.setup()

    await person.type(screen.getByLabelText('Passwort'), 'was-nur-lea-kennt')
    // From the sign in on, the server knows who this is.
    serverSays('GET', '/api/auth/get-session', { user: lea, session: {} })
    await person.click(screen.getByRole('button', { name: 'Anmelden' }))

    expect(asked('/api/auth/sign-in/email', 'POST')?.body).toEqual({
      email: lea.email,
      password: 'was-nur-lea-kennt',
    })
    expect(asked(`/invitation/${token}`, 'POST')).toBeUndefined()

    // Then the step that joins, as the account itself, with no password.
    expect((await screen.findByText(/Angemeldet als/)).textContent).toBe(
      'Angemeldet als lea@example.de. Ihr Passwort bleibt, der Mandant kommt dazu.',
    )
    await person.click(await screen.findByRole('button', { name: 'Mandant übernehmen' }))

    expect(asked(`/invitation/${token}`, 'POST')?.body).toEqual({})
    expect(went).toBe('/')
  })

  it('goes through the second factor of an account that has one before it offers to join', async () => {
    serverSays('POST', '/api/auth/sign-in/email', { twoFactorRedirect: true })

    render(inQueries(<InvitationScreen token={token} />))

    const person = userEvent.setup()

    await person.type(await screen.findByLabelText('Passwort'), 'was-nur-lea-kennt')
    await person.click(screen.getByRole('button', { name: 'Anmelden' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Zweiter Faktor' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mandant übernehmen' })).toBeNull()

    serverSays('GET', '/api/auth/get-session', { user: lea, session: {} })
    await person.type(screen.getByLabelText('Code aus der App'), '123456')
    await person.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(asked('/api/auth/two-factor/verify-totp', 'POST')?.body).toEqual({ code: '123456' })
    expect(await screen.findByRole('button', { name: 'Mandant übernehmen' })).toBeTruthy()
    expect(asked(`/invitation/${token}`, 'POST')).toBeUndefined()
  })

  it('joins straight away for the account it is for when that one is signed in already', async () => {
    serverSays('GET', '/api/auth/get-session', { user: lea, session: {} })

    render(inQueries(<InvitationScreen token={token} />))

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Mandant übernehmen' }))

    expect(asked(`/invitation/${token}`, 'POST')?.body).toEqual({})
    // No sign in: the session is there, and the account keeps its password.
    expect(asked('/api/auth/sign-in/email', 'POST')).toBeUndefined()
    expect(went).toBe('/')
  })

  it('goes no further while somebody else is signed in, and says so', async () => {
    serverSays('GET', '/api/auth/get-session', {
      user: { id: 'konto-otto', email: 'otto@example.de', name: 'Otto Anders' },
      session: {},
    })

    render(inQueries(<InvitationScreen token={token} />))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Beitreten zu Probewerk Nord' }),
    ).toBeTruthy()
    expect(screen.getByText('otto@example.de').parentElement?.textContent).toBe(
      'Diese Einladung gilt für lea@example.de, angemeldet sind Sie als otto@example.de. ' +
        'Melden Sie sich in der Anwendung ab und öffnen Sie den Link danach noch einmal.',
    )
    expect(screen.queryByRole('button', { name: 'Mandant übernehmen' })).toBeNull()
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])

    await userEvent.setup().click(screen.getByRole('button', { name: 'Zur Anwendung' }))

    expect(went).toBe('/')
  })
})
