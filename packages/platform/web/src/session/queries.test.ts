import {
  focusManager,
  QueryClient,
  QueryObserver,
  type QueryObserverResult,
} from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import { RequestRefused } from '../sync/transport.js'
import { queries } from './queries.js'

/**
 * What the cache does with a question that failed. It asks once more where
 * asking again can change the answer, and it takes a refusal for the answer
 * it is: a second attempt waits for a window somebody looks at, and a screen
 * that waits there says something else than "this is not there".
 */

function again(attempt: number, error: unknown): boolean {
  const retry = queries.getDefaultOptions().queries?.retry

  if (typeof retry !== 'function') {
    throw new Error('The cache decides by a function whether it asks again.')
  }

  return retry(attempt, error as Error)
}

const refused = (status: number) =>
  new RequestRefused(status, `Der Server hat die Anfrage abgelehnt (${status}).`)
const broken = () => new TypeError('Failed to fetch')

/** How a question with the options of the cache stands once it stops fetching. */
async function settled(error: unknown): Promise<readonly [string, string]> {
  const client = new QueryClient({ defaultOptions: queries.getDefaultOptions() })
  const observer = new QueryObserver(client, {
    queryKey: ['probe'],
    queryFn: () => Promise.reject(error as Error),
    retryDelay: 1,
  })
  const subscription: { stop: () => void } = { stop: () => undefined }
  const result = await new Promise<QueryObserverResult>((resolve) => {
    subscription.stop = observer.subscribe((state) => {
      if (state.fetchStatus === 'paused' || state.status !== 'pending') {
        resolve(state)
      }
    })
  })

  subscription.stop()
  client.clear()

  return [result.status, result.fetchStatus]
}

describe('a question that failed', () => {
  afterEach(() => {
    focusManager.setFocused(undefined)
  })

  it('is asked once more where asking again can change the answer', () => {
    // No answer at all: the connection broke.
    expect(again(0, broken())).toBe(true)
    // The server could not answer, or said "not now".
    expect([500, 502, 503, 504, 408, 429].filter((status) => !again(0, refused(status)))).toEqual(
      [],
    )
    // And never a third time.
    expect(again(1, broken())).toBe(false)
    expect(again(1, refused(503))).toBe(false)
  })

  it('is not asked again where the server has looked at the request and said no', () => {
    expect(
      [400, 401, 403, 404, 409, 410, 413, 422].filter((status) => again(0, refused(status))),
    ).toEqual([])
  })

  it('settles on a refusal in a window nobody looks at, and does not wait there for a second attempt', async () => {
    focusManager.setFocused(false)

    // The record is gone: an error, and nothing that still runs or waits.
    expect(await settled(refused(404))).toEqual(['error', 'idle'])
    // A broken connection is worth the second attempt, and that one waits
    // for the window: this is the state a screen reads as "no connection".
    expect(await settled(broken())).toEqual(['pending', 'paused'])
  })
})
