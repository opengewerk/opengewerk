import { type OutgoingHttpHeaders, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** What a request sent by hand was answered with. */
export interface HandAnswer {
  readonly status: number
  readonly text: string
}

/**
 * Sends a POST by hand, piece after piece, in the two ways supertest cannot:
 * with a length the body never reaches, and with no length at all. A request
 * that `ends` is finished after its pieces; one that does not is held open,
 * the way a sender that is still sending holds it. Resolves with the answer,
 * or with null when none came within two seconds.
 *
 * An answer to a request that is still open is the proof that the server did
 * not wait for the rest of its body.
 */
export async function sentByHand(
  server: Server,
  path: string,
  headers: OutgoingHttpHeaders,
  pieces: readonly string[],
  ends: boolean,
): Promise<HandAnswer | null> {
  if (!server.listening) {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
  }

  const { port } = server.address() as AddressInfo

  return new Promise((resolve) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers })
    const waiting: { deadline?: NodeJS.Timeout } = {}
    let over = false

    const finish = (answer: HandAnswer | null) => {
      if (over) {
        return
      }

      over = true
      clearTimeout(waiting.deadline)
      outgoing.destroy()
      server.closeAllConnections()
      resolve(answer)
    }

    waiting.deadline = setTimeout(() => {
      finish(null)
    }, 2000)

    // The connection is cut under a sender that is still sending once it has
    // its answer; that is the end of this request, not a failure of it.
    outgoing.on('error', () => undefined)
    outgoing.on('response', (incoming) => {
      let text = ''

      incoming.setEncoding('utf8')
      incoming.on('data', (chunk: string) => {
        text += chunk
      })
      incoming.on('end', () => {
        finish({ status: incoming.statusCode ?? 0, text })
      })
    })

    const send = (index: number) => {
      const piece = pieces[index]

      if (over) {
        return
      }

      if (piece === undefined) {
        if (ends) {
          outgoing.end()
        }

        return
      }

      outgoing.write(piece, () => {
        setImmediate(() => {
          send(index + 1)
        })
      })
    }

    send(0)
  })
}
