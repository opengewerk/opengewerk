import { describe, expect, it } from 'vitest'

import { refusalOf } from './origin.js'

/**
 * The defence against a form on somebody else's page (GHSA-r7rq-234g-3jx8).
 * The session cookie is `SameSite=Lax`, and a page on another subdomain of the
 * same site still gets it sent along; what stands between that page and a
 * change here is the origin it has to name and the JSON it cannot send.
 */

const instance = 'https://opengewerk.example.de'
const foreign = 'https://werbung.example.de'

function changing(headers: Record<string, string>, method = 'POST') {
  return { method, headers }
}

describe('a request that changes something', () => {
  it('is refused from a page anywhere else, and from one that names no page at all', () => {
    for (const origin of [foreign, 'null', 'http://opengewerk.example.de']) {
      const refusal = refusalOf(
        changing({ origin, 'content-type': 'application/json', 'content-length': '2' }),
        [instance],
      )

      expect(refusal?.getStatus()).toBe(403)
    }
  })

  it('goes through from the address of the instance, and without an origin, as from curl', () => {
    const json = { 'content-type': 'application/json; charset=utf-8', 'content-length': '2' }

    expect(refusalOf(changing({ ...json, origin: instance }), [instance])).toBeNull()
    expect(refusalOf(changing(json), [instance])).toBeNull()
  })

  it('is refused as a form, in each of the three encodings HTML knows', () => {
    for (const type of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain',
    ]) {
      const refusal = refusalOf(changing({ 'content-type': type, 'content-length': '9' }), [
        instance,
      ])

      expect(refusal?.getStatus()).toBe(415)
    }
  })

  /**
   * A browser sends `text/plain` with a parameter from any page without asking
   * first, because only the essence decides whether it asks. A check that
   * looked for "application/json" anywhere in the header let this through.
   */
  it('is read by the essence of its type, so plain text cannot pass as JSON', () => {
    const refusal = refusalOf(
      changing({ 'content-type': 'text/plain; x=application/json', 'content-length': '2' }),
      [instance],
    )

    expect(refusal?.getStatus()).toBe(415)
  })

  it('is refused when it carries a body without saying what it is', () => {
    expect(refusalOf(changing({ 'content-length': '12' }), [instance])?.getStatus()).toBe(415)
    expect(refusalOf(changing({ 'transfer-encoding': 'chunked' }), [instance])?.getStatus()).toBe(
      415,
    )
  })

  it('goes through without a body and without a type, which no form can send', () => {
    expect(refusalOf(changing({}), [instance])).toBeNull()
    expect(refusalOf(changing({ origin: instance }, 'DELETE'), [instance])).toBeNull()
  })

  it('takes on a route for images the types it declares, and says so for anything else', () => {
    const logo = {
      mediaTypes: ['image/png', 'image/jpeg'],
      refusal: 'Das Logo wird als Bild geschickt.',
    }

    expect(
      refusalOf(changing({ 'content-type': 'image/png', 'content-length': '8' }, 'PUT'), [], logo),
    ).toBeNull()

    const refusal = refusalOf(
      changing({ 'content-type': 'application/json', 'content-length': '2' }, 'PUT'),
      [],
      logo,
    )

    expect(refusal?.getStatus()).toBe(415)
    expect(refusal?.message).toBe('Das Logo wird als Bild geschickt.')
  })
})

describe('a request that reads', () => {
  it('is not asked where it comes from; a page elsewhere cannot read the answer', () => {
    expect(refusalOf({ method: 'GET', headers: { origin: foreign } }, [instance])).toBeNull()
    expect(refusalOf({ method: 'HEAD', headers: { origin: foreign } }, [instance])).toBeNull()
  })
})
