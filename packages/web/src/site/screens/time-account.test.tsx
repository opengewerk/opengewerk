import type { AccountDay, IsoDate } from '@opengewerk/domain'
import { addDays } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { OwnTimeAccount, TimeAccountCard } from './time-account.js'

/**
 * One's own time account on site (#289) comes from the server: where it
 * stands, the week day by day with today not yet counted, the months newest
 * first; and without a network or a file of one's own, why there is none.
 */

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

function days(from: string, to: string, day: (on: IsoDate) => [number, number]) {
  const all: AccountDay[] = []

  for (let on = from as IsoDate; on <= to; on = addDays(on, 1)) {
    const [target, worked] = day(on)

    all.push({ on, targetMinutes: target, workedMinutes: worked, counted: on <= '2026-11-04' })
  }

  return all
}

const weekdays = (on: IsoDate) => new Date(`${on}T12:00:00Z`).getUTCDay() % 6 !== 0

/** The server for Anna Weber on Thursday, 05.11.2026: the week and the year. */
function serving(hasFile = true) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input)
    const week = url.includes('from=2026-11-02')
    const body = {
      hasFile,
      startsOn: hasFile ? '2023-03-01' : null,
      countedUntil: hasFile ? '2026-11-04' : null,
      state: 'DE-BW',
      balanceBeforeMinutes: week ? 1440 : 390,
      balanceMinutes: 1485,
      days: week
        ? days('2026-11-02', '2026-11-08', (on) =>
            on === '2026-11-02'
              ? [480, 510]
              : on === '2026-11-03'
                ? [480, 525]
                : on === '2026-11-04'
                  ? [480, 450]
                  : on === '2026-11-05'
                    ? [480, 190]
                    : weekdays(on)
                      ? [480, 0]
                      : [0, 0],
          )
        : days('2026-01-01', '2026-12-31', (on) => (weekdays(on) ? [480, 480] : [0, 0])),
    }

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('one’s own time account on site', () => {
  it('stands up to yesterday, with what came over from last year', async () => {
    serving()
    render(inQueries(<OwnTimeAccount />))

    expect(await screen.findByText('+24:45 Std.')).toBeTruthy()
    expect(
      screen.getByText('Stand bis gestern, 04.11.2026. Übertrag aus 2025: +6:30 Std.'),
    ).toBeTruthy()
  })

  it('shows the week day by day, today not yet counted', async () => {
    serving()
    render(inQueries(<OwnTimeAccount />))

    const week = within(
      (await screen.findByText('Diese Woche')).closest('section') ?? document.body,
    )
    const lines = week.getAllByRole('listitem').map((line) => line.textContent)

    expect(lines).toEqual([
      'Montag, 02.11.Soll 8:00 Std. · Ist 8:30 Std.+0:30 Std.',
      'Dienstag, 03.11.Soll 8:00 Std. · Ist 8:45 Std.+0:45 Std.',
      'Mittwoch, 04.11.Soll 8:00 Std. · Ist 7:30 Std.−0:30 Std.',
      'Donnerstag, 05.11.Soll 8:00 Std. · bisher 3:10 Std.heute',
      'Freitag, 06.11.Soll 8:00 Std.',
    ])
    expect(
      week.getByText(
        'Bis gestern Soll 24:00 Std., Ist 24:45 Std., Saldo +0:45 Std. Heute zählt erst ab morgen.',
      ),
    ).toBeTruthy()
  })

  it('leaves out a day with nothing agreed and nothing worked, today too', async () => {
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'))
    serving()
    render(inQueries(<OwnTimeAccount />))

    const week = within(
      (await screen.findByText('Diese Woche')).closest('section') ?? document.body,
    )

    expect(week.getAllByRole('listitem').map((line) => line.textContent?.slice(0, 8))).toEqual([
      'Montag, ',
      'Dienstag',
      'Mittwoch',
      'Donnerst',
      'Freitag,',
    ])
  })

  it('lists the months of the year, the newest first', async () => {
    serving()
    render(inQueries(<OwnTimeAccount />))

    const year = within(
      (await screen.findByText('2026 nach Monaten')).closest('section') ?? document.body,
    )
    const titles = year
      .getAllByRole('listitem')
      .map((line) => line.firstChild?.firstChild?.textContent)

    expect(titles.slice(0, 2)).toEqual(['November, bis 04.11.', 'Oktober'])
    expect(titles.at(-1)).toBe('Januar')
  })

  it('says that it needs a network when there is none', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    render(inQueries(<OwnTimeAccount />))

    expect(
      await screen.findByText('Ohne Netz lässt sich dein Zeitkonto nicht ansehen.'),
    ).toBeTruthy()
  })

  it('says who makes the file when there is none of one’s own, and leaves the card out', async () => {
    serving(false)
    render(inQueries(<OwnTimeAccount />))

    expect(await screen.findByText(/noch keine Akte\. Das Büro legt sie an/)).toBeTruthy()

    const { container } = render(inQueries(<TimeAccountCard />))

    await screen.findAllByText(/noch keine Akte/)
    expect(container.textContent).toBe('')
  })

  it('puts the account on "Zeiten" with where it stands and the week so far', async () => {
    serving()
    render(inQueries(<TimeAccountCard />))

    expect(
      await screen.findByText('+24:45 Std. auf deinem Konto, gezählt bis gestern.'),
    ).toBeTruthy()
    expect(screen.getByText('Diese Woche bis gestern: +0:45 Std.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Zeitkonto ansehen/ }).getAttribute('href')).toContain(
      '/zeitkonto',
    )
  })
})
