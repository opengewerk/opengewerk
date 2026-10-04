import { lookup as resolveName, type LookupAddress } from 'node:dns'
import { lookup as lookupAll } from 'node:dns/promises'
import type { ClientRequest } from 'node:http'
import { request } from 'node:https'
import { isIP } from 'node:net'

import { isInternalAddress } from '../network/internal-address.js'

/**
 * Why an endpoint a browser handed over is not one the server posts to, or
 * null when it is.
 *
 * The address comes from a device, and the server makes a request to it
 * whenever there is a message: without a rule it would post to whatever a
 * device names, the database of the instance or anything else in the network
 * it runs in, like the mail server before GHSA-5664-h6fc-v729. A push service
 * is always somewhere on the internet, over HTTPS on the usual port, so that
 * is all that is taken. Whether a name points inside is asked when the
 * connection is made (`checkedLookup`), because that is the answer that counts.
 */
export function endpointProblem(endpoint: string): string | null {
  let url: URL

  try {
    url = new URL(endpoint)
  } catch {
    return 'Die Adresse des Push-Dienstes ist keine Adresse.'
  }

  if (url.protocol !== 'https:') {
    return 'Ein Push-Dienst wird nur über HTTPS erreicht.'
  }

  if (url.port !== '' && url.port !== '443') {
    return 'Ein Push-Dienst antwortet auf dem Port für HTTPS, nicht auf einem anderen.'
  }

  if (url.username !== '' || url.password !== '') {
    return 'Die Adresse des Push-Dienstes trägt Zugangsdaten, das tut keine.'
  }

  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')

  if (isIP(host) !== 0 && isInternalAddress(host)) {
    return 'Die Adresse des Push-Dienstes liegt in einem internen Netz.'
  }

  return null
}

/** Every address a name stands for, the way the system resolves it. */
async function addressesOf(host: string): Promise<readonly string[]> {
  const found = await lookupAll(host, { all: true, verbatim: true })

  return found.map((entry) => entry.address)
}

/**
 * The same question as `endpointProblem`, asked of the name as well: whether
 * a device may subscribe with this endpoint at all. Asked when it subscribes,
 * so that the device hears the reason at once and not a minute later from the
 * job; the connection asks again (`checkedLookup`).
 */
export async function endpointReachable(
  endpoint: string,
  resolve: (host: string) => Promise<readonly string[]> = addressesOf,
): Promise<string | null> {
  const problem = endpointProblem(endpoint)

  if (problem !== null) {
    return problem
  }

  const host = new URL(endpoint).hostname.replace(/^\[(.*)\]$/, '$1')

  if (isIP(host) !== 0) {
    return null
  }

  let addresses: readonly string[]

  try {
    addresses = await resolve(host)
  } catch {
    addresses = []
  }

  if (addresses.length === 0) {
    return `Den Push-Dienst "${host}" gibt es nicht, der Name lässt sich nicht auflösen.`
  }

  if (addresses.some(isInternalAddress)) {
    return 'Die Adresse des Push-Dienstes liegt in einem internen Netz.'
  }

  return null
}

/** What came back from a push service: the status, and when to try again if it said. */
export interface PushAnswer {
  readonly status: number
  readonly retryAfter: string | null
}

/** Posts a message to a push service. A fake in the tests, `httpsPost` in the running instance. */
export type PushPost = (
  endpoint: string,
  headers: Readonly<Record<string, string>>,
  body: Buffer,
) => Promise<PushAnswer>

type Lookup = typeof resolveName

/**
 * Resolves a name the way the connection needs it and refuses it when any of
 * its addresses is inside a network. Every one of them, because which one the
 * connection takes is up to the resolver; and here, because a name checked
 * once and resolved again by the connection could point somewhere else by the
 * second time.
 */
export function checkedLookup(resolve: Lookup = resolveName): Lookup {
  const checked = ((
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    resolve(hostname, { all: true, family: options.family ?? 0 }, (error, found) => {
      if (error) {
        callback(error, '')

        return
      }

      const addresses = found as unknown as LookupAddress[]
      const inside = addresses.find((entry) => isInternalAddress(entry.address))

      if (inside || addresses.length === 0) {
        callback(
          Object.assign(new Error(`${hostname} liegt nicht im Internet`), { code: 'EINTERNAL' }),
          '',
        )

        return
      }

      if (options.all) {
        callback(null, addresses)
      } else {
        const [first] = addresses

        callback(null, first?.address ?? '', first?.family)
      }
    })
  }) as unknown as Lookup

  return checked
}

/** How long a push service has for the whole of one request. */
export const pushAnswerLimitMs = 10_000

/** Posts over HTTPS, to the internet only, and gives up after ten seconds. */
export function httpsPost(resolve?: Lookup): PushPost {
  const lookup = checkedLookup(resolve)

  return (endpoint, headers, body) => {
    const problem = endpointProblem(endpoint)

    if (problem !== null) {
      return Promise.reject(new Error(problem))
    }

    const sent = request(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(body.length) },
      lookup,
    })
    const answer = answerOf(sent)

    sent.end(body)

    return answer
  }
}

/**
 * What a push service answers to one request: as soon as the head of its
 * response is there, or an error when that takes longer than the limit.
 *
 * The limit is for the whole request and not for each pause in it. Before
 * opengewerk-haustechnik#31 it was the idle timeout of the socket, which
 * starts again with every byte, and the body of the answer was read to its
 * end. An endpoint anybody with the right to switch on push can name, and
 * that sends a byte every few seconds and never an end, then held the job
 * that sends push for every tenant of the instance: a cycle runs one message
 * after another and never two at once. All the server needs is the status
 * and one header, so the connection is cut as soon as they are there.
 */
export function answerOf(sent: ClientRequest, limitMs = pushAnswerLimitMs): Promise<PushAnswer> {
  return new Promise((answered, failed) => {
    let settled = false
    const timer = setTimeout(() => {
      sent.destroy(new Error('Der Push-Dienst hat nicht rechtzeitig geantwortet.'))
    }, limitMs)

    function settle(finish: () => void): void {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        finish()
      }
    }

    sent.on('response', (response) => {
      const retryAfter = response.headers['retry-after']

      settle(() => {
        answered({
          status: response.statusCode ?? 0,
          retryAfter: typeof retryAfter === 'string' ? retryAfter : null,
        })
      })
      // Whatever the body says, the status already did.
      response.destroy()
    })
    sent.on('error', (error) => {
      settle(() => {
        failed(error)
      })
    })
  })
}
