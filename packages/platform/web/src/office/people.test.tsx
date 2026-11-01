import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import type { PersonFile } from '../session/people.js'
import {
  hoursOf,
  minutesOf,
  OwnFilePanel,
  type PeopleScreenProps,
  PeopleScreen,
  PersonScreen,
} from './people.js'

/**
 * The files of the people as the foundation draws them (ADR 0016,
 * opengewerk#287): the list with what runs out, one file with its working
 * times and qualifications, what may be changed and by whom, and the own
 * file under "Konto". The names of the roles and the sentences about who
 * reads the files are the application's.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(method: string, path: string, body: unknown, status = 200): void {
  answers.set(`${method} ${path}`, { status, body })
}

function sent(method: string, path: string): unknown[] {
  return calls.filter((call) => call.method === method && call.path === path).map((c) => c.body)
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InProbe>
        <InRouter>{node}</InRouter>
      </InProbe>
    </QueryClientProvider>
  )
}

const screenProps: Omit<PeopleScreenProps, 'mayWrite'> = {
  words: {
    role: (key) => (key === 'technician' ? 'Monteur' : key),
    whoReads: 'Die Akten liest, wer das Recht dazu hat.',
    beforeExpiry: 'Vor dem Ablauf entsteht eine Frist.',
  },
  paths: {
    people: '/mitarbeiter',
    person: (id) => `/mitarbeiter/${id}`,
    newPerson: '/mitarbeiter/neu',
  },
}

const week = (minutes: readonly number[]) => ({
  mondayMinutes: minutes[0] ?? 0,
  tuesdayMinutes: minutes[1] ?? 0,
  wednesdayMinutes: minutes[2] ?? 0,
  thursdayMinutes: minutes[3] ?? 0,
  fridayMinutes: minutes[4] ?? 0,
  saturdayMinutes: minutes[5] ?? 0,
  sundayMinutes: minutes[6] ?? 0,
})

const anna: PersonFile = {
  id: 'anna',
  name: 'Anna Weber',
  userId: 'u-anna',
  joinedOn: '2023-03-01',
  leftOn: null,
  standing: 'employed',
  account: {
    userId: 'u-anna',
    name: 'Anna Weber',
    email: 'a.weber@example.de',
    roles: ['technician'],
  },
  leadDays: 60,
  workingTimes: [
    {
      id: 't-later',
      validFrom: '2099-01-01',
      ...week([450, 450, 450, 450]),
      weekMinutes: 1800,
      holdsToday: false,
      begun: false,
    },
    {
      id: 't-now',
      validFrom: '2023-03-01',
      ...week([480, 480, 480, 480, 480]),
      weekMinutes: 2400,
      holdsToday: true,
      begun: true,
    },
  ],
  qualifications: [
    {
      id: 'q-height',
      kindKey: 'core.work_at_height',
      ownKindId: null,
      validUntil: '2026-11-30',
      note: null,
      certificateSha256: null,
      kindLabel: 'Höhenarbeit',
      kindLevel: 'instructed_person',
      standing: 'expiring',
    },
  ],
}

beforeEach(() => {
  calls = []
  answers = new Map()
  serverSays('GET', '/people', [
    {
      id: 'anna',
      name: 'Anna Weber',
      userId: 'u-anna',
      joinedOn: '2023-03-01',
      leftOn: null,
      standing: 'employed',
      account: anna.account,
      weekMinutes: 2400,
      qualifications: { valid: 3, expiring: 1, expired: 1 },
    },
    {
      id: 'tim',
      name: 'Tim Schäfer',
      userId: null,
      joinedOn: '2026-10-01',
      leftOn: null,
      standing: 'employed',
      account: null,
      weekMinutes: 1500,
      qualifications: { valid: 1, expiring: 0, expired: 0 },
    },
    {
      id: 'sabine',
      name: 'Sabine Roth',
      userId: null,
      joinedOn: '2020-01-01',
      leftOn: '2026-08-31',
      standing: 'left',
      account: null,
      weekMinutes: 2400,
      qualifications: { valid: 0, expiring: 0, expired: 0 },
    },
  ])
  serverSays('GET', '/people/anna', anna)
  serverSays('GET', '/qualification-kinds', {
    catalogue: [{ key: 'core.work_at_height', label: 'Höhenarbeit', level: 'instructed_person' }],
    own: [],
  })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })

    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(answer.body === null ? '' : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hours as typed', () => {
  it('turn into whole minutes, with a comma, and back', () => {
    expect(minutesOf('7,5')).toBe(450)
    expect(minutesOf('8')).toBe(480)
    expect(minutesOf('')).toBe(0)
    expect(minutesOf('25')).toBeNull()
    expect(minutesOf('acht')).toBeNull()
    expect(hoursOf(450)).toBe('7,5')
  })
})

describe('the list of the files', () => {
  it('shows who works here with their access, the hours of the week and what runs out', async () => {
    render(inQueries(<PeopleScreen {...screenProps} mayWrite />))

    const table = await screen.findByRole('table')
    const annaRow = (await within(table).findByRole('link', { name: 'Anna Weber' })).closest(
      'tr',
    ) as HTMLElement
    const timRow = within(table)
      .getByRole('link', { name: 'Tim Schäfer' })
      .closest('tr') as HTMLElement

    expect(within(annaRow).getByText('Monteur')).toBeTruthy()
    expect(within(annaRow).getByText('40 Std.')).toBeTruthy()
    expect(within(annaRow).getByText('1 abgelaufen')).toBeTruthy()
    expect(within(annaRow).getByText('1 läuft bald ab')).toBeTruthy()
    expect(within(timRow).getByText('Kein Zugang')).toBeTruthy()
    // Who left stands under "Ausgetreten".
    expect(within(table).queryByRole('link', { name: 'Sabine Roth' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Neue Akte' })).toBeTruthy()
  })

  it('offers no new file to whoever may not keep the files', async () => {
    render(inQueries(<PeopleScreen {...screenProps} mayWrite={false} />))

    await screen.findByRole('link', { name: 'Anna Weber' })
    expect(screen.queryByRole('link', { name: 'Neue Akte' })).toBeNull()
  })
})

describe('a file', () => {
  it('changes a working time still to come and none that holds already', async () => {
    render(inQueries(<PersonScreen {...screenProps} personId="anna" mayWrite />))

    await screen.findByText('Gilt heute')
    expect(screen.getByRole('button', { name: 'Arbeitszeit ab 01.01.2099 ändern' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Arbeitszeit ab 01.03.2023 ändern' })).toBeNull()
  })

  it('offers nothing to change to whoever may only read', async () => {
    render(inQueries(<PersonScreen {...screenProps} personId="anna" mayWrite={false} />))

    await screen.findByText('Gilt heute')
    expect(screen.queryByRole('button', { name: 'Neue Arbeitszeit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Qualifikation hinzufügen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: /ändern$/ })).toBeNull()
  })

  it('sends a new working time as minutes of each weekday', async () => {
    serverSays('POST', '/people/anna/working-times', { id: 't-new' }, 201)
    render(inQueries(<PersonScreen {...screenProps} personId="anna" mayWrite />))

    await userEvent.click(await screen.findByRole('button', { name: 'Neue Arbeitszeit' }))

    const dialog = screen.getByRole('dialog')
    const date = within(dialog).getByLabelText('Gültig ab')

    await userEvent.clear(date)
    await userEvent.type(date, '2099-06-01')

    for (const day of ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag']) {
      const field = within(dialog).getByLabelText(day)

      await userEvent.clear(field)
      await userEvent.type(field, '7,5')
    }

    const friday = within(dialog).getByLabelText('Freitag')

    await userEvent.clear(friday)
    await userEvent.type(friday, '0')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('POST', '/people/anna/working-times')).toEqual([
        { validFrom: '2099-06-01', ...week([450, 450, 450, 450]) },
      ])
    })
  })
})

describe('the own file under "Konto"', () => {
  it('shows the own working time and qualifications, read only', async () => {
    serverSays('GET', '/people/mine', anna)
    render(inQueries(<OwnFilePanel />))

    expect(await screen.findByText('Meine Akte')).toBeTruthy()
    expect(screen.getByText('Höhenarbeit')).toBeTruthy()
    expect(screen.getByText('Läuft bald ab')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is not there for somebody without a file', async () => {
    serverSays('GET', '/people/mine', null)
    const { container } = render(inQueries(<OwnFilePanel />))

    await waitFor(() => {
      expect(calls.some((call) => call.path === '/people/mine')).toBe(true)
    })
    expect(container.textContent).not.toContain('Meine Akte')
  })
})
