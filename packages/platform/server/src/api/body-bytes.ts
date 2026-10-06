import type { Request } from 'express'

/**
 * The body of a request as bytes, read here and by nothing in front of the
 * route, or null when it is longer than the route takes.
 *
 * A parser in front of the route reads before any guard has asked who is
 * sending: megabytes went into memory for a request without a session, which
 * was then turned away (opengewerk-haustechnik#31). Read by the handler, a
 * body is read for whoever the guards let through and for nobody else.
 *
 * A body that is too long is read on and kept nowhere. Answering while the
 * sender is still sending cuts the connection under it, and what it reads
 * then is a lost connection and not the sentence about the size. Twice the
 * limit is where the reading ends whatever is still coming.
 */
export function bodyBytesOf(request: Request, most: number): Promise<Buffer | null> {
  const said = Number(request.header('content-length') ?? '0')
  const announced = Number.isFinite(said) ? said : 0

  // An application that still reads the body in front of the route has it here.
  if (Buffer.isBuffer(request.body)) {
    return Promise.resolve(request.body.byteLength > most ? null : request.body)
  }

  if (request.readableEnded) {
    return Promise.resolve(Buffer.alloc(0))
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    // What the sender says the length is decides before a byte is kept.
    let tooLong = announced > most

    const finish = (result: Buffer | null) => {
      request.off('data', take)
      request.off('end', end)
      request.off('error', reject)
      resolve(result)
    }
    const take = (chunk: Buffer) => {
      length += chunk.byteLength

      if (length > most) {
        tooLong = true
        chunks.length = 0
      }

      if (!tooLong) {
        chunks.push(chunk)
      } else if (length > most * 2) {
        request.pause()
        finish(null)
      }
    }
    const end = () => {
      finish(tooLong ? null : Buffer.concat(chunks))
    }

    request.on('data', take)
    request.on('end', end)
    request.on('error', reject)
  })
}
