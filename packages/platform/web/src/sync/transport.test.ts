import { afterEach, describe, expect, it, vi } from 'vitest'

import { request, RequestRefused } from './transport.js'

/**
 * What a route answers that has nothing to say: a removal answers 200 with no
 * body at all, and a request that read it as JSON failed after the server had
 * done what was asked (opengewerk/opengewerk-haustechnik#346). A page then
 * stayed on a record that was gone and said it had no connection.
 */

function answering(body: string, status: number): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(status === 204 ? null : body, {
        status,
        headers: body === '' ? {} : { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('an answer of the server', () => {
  it('with nothing in it is no answer, and no failure', async () => {
    answering('', 200)

    await expect(request('/roles/own-1', { method: 'DELETE' })).resolves.toBeUndefined()

    answering('', 204)

    await expect(request('/roles/own-1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('with something in it is read as it was sent, and a refusal stays one', async () => {
    answering('{"key":"own-1"}', 200)

    await expect(request('/roles')).resolves.toEqual({ key: 'own-1' })

    answering('{"message":"Die Rolle ist noch 1 Zugang zugeordnet."}', 409)

    await expect(request('/roles/own-1', { method: 'DELETE' })).rejects.toBeInstanceOf(
      RequestRefused,
    )
  })
})
