import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { OwnLeave } from './leave.js'

/**
 * One's own leave on site (#288) is not on the device: without a network the
 * screen says so instead of showing an old state, and without a file of one's
 * own it says who makes one.
 */

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T10:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('one’s own leave on site', () => {
  it('says that it needs a network when there is none', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    render(inQueries(<OwnLeave />))

    expect(
      await screen.findByText(
        'Ohne Netz lässt sich dein Urlaub nicht ansehen und kein Antrag stellen.',
      ),
    ).toBeTruthy()
  })

  it('says who makes the file when there is none of one’s own', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    )
    render(inQueries(<OwnLeave />))

    expect(await screen.findByText(/noch keine Akte\. Das Büro legt sie an/)).toBeTruthy()
  })
})
