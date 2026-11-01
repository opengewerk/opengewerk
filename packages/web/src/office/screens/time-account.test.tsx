import type { AccountDay, IsoDate } from '@opengewerk/domain'
import { addDays } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { AccountPanel } from './time-account.js'

/**
 * The time account in the office (#289): the months of a year with what came
 * over from the year before and where the account stands, asked of the server
 * for the person chosen; and why there is none without a file.
 */

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

const asked: string[] = []

function serving(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    asked.push(String(input))

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

function year(): AccountDay[] {
  const all: AccountDay[] = []

  for (let on = '2026-01-01' as IsoDate; on <= '2026-12-31'; on = addDays(on, 1)) {
    const weekday = new Date(`${on}T12:00:00Z`).getUTCDay() % 6 !== 0

    all.push({
      on,
      targetMinutes: weekday ? 480 : 0,
      workedMinutes: weekday ? (on.endsWith('-02') ? 570 : 480) : 0,
      counted: on <= '2026-11-04',
    })
  }

  return all
}

beforeEach(() => {
  asked.length = 0
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the time account in the office', () => {
  it('shows the months of the year after what came over, and where the account stands', async () => {
    serving({
      hasFile: true,
      startsOn: '2023-03-01',
      countedUntil: '2026-11-04',
      state: 'DE-BW',
      balanceBeforeMinutes: 390,
      balanceMinutes: 1485,
      days: year(),
    })
    render(inQueries(<AccountPanel userId="anna" />))

    const table = await screen.findByRole('table', { name: 'Zeitkonto 2026 nach Monaten' })
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent)

    expect(rows[0]).toBe('Übertrag aus 2025+6:30 Std.')
    expect(rows.at(-1)).toBe('November, bis 04.11.24:00 Std.25:30 Std.+1:30 Std.+20:00 Std.')
    expect(screen.getByText('Stand bis gestern, 04.11.2026: +24:45 Std.')).toBeTruthy()
    expect(asked.some((url) => url.includes('userId=anna&from=2026-01-01&to=2026-12-31'))).toBe(
      true,
    )
  })

  it('says why there is none without a file', async () => {
    serving({
      hasFile: false,
      startsOn: null,
      countedUntil: null,
      state: 'DE-BW',
      balanceBeforeMinutes: 0,
      balanceMinutes: 0,
      days: [],
    })
    render(inQueries(<AccountPanel userId="lena" />))

    expect(
      await screen.findByText(/keine Akte\. Ohne vereinbarte Arbeitszeit gibt es kein Zeitkonto/),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
