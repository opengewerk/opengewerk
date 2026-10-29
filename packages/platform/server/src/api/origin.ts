import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  type HttpException,
  Inject,
  Injectable,
  SetMetadata,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { json as readJson, type NextFunction, type Request, type Response } from 'express'

import { TRUSTED_ORIGINS } from './handed-in.js'

/** The methods that change something, and so the ones a foreign page would send. */
const changing = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const ACCEPTS_METADATA = 'opengewerk:accepts'

/** What a route takes as a body other than JSON, and the sentence for anything else. */
interface Accepted {
  readonly mediaTypes: readonly string[]
  readonly refusal: string
}

const json: Accepted = {
  mediaTypes: ['application/json'],
  refusal: 'Diese Anfrage wird nur als JSON angenommen.',
}

/**
 * Marks the one kind of route whose body is not JSON, an image or the bytes of
 * a file, with the types it takes and what to say about any other. The types
 * have to be ones a form cannot send; an image is, a form only knows three
 * encodings.
 */
export const AcceptsBody = (mediaTypes: readonly string[], refusal: string) =>
  SetMetadata(ACCEPTS_METADATA, { mediaTypes, refusal } satisfies Accepted)

/** The media type without its parameters, `application/json` out of `application/json; charset=utf-8`. */
function essenceOf(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

/**
 * Why a request that changes something is refused, or null when it may go on.
 *
 * Two checks, and they cover different halves. A browser sends `Origin` with
 * every request that is not a GET or a HEAD, so a page from anywhere else is
 * refused by the first; `null`, which a sandboxed frame or a redirect sends,
 * is no trusted origin either. A request with no `Origin` at all passes it,
 * which is the ordinary case for `curl` on the machine itself.
 *
 * The second catches what a browser could still send that way. A form sends
 * one of the three encodings HTML knows, never JSON, and a page that wants to
 * send JSON to another origin has to ask first, which nothing here allows. So
 * a request that says what it carries has to say JSON, and one that carries a
 * body without saying what it is is refused as well. The type is compared by
 * its essence and not searched for: `text/plain; x=application/json` is plain
 * text, and a browser sends it from any page without asking.
 *
 * What passes both is a request without a body and without a type. A form
 * cannot send that, it always names its encoding, and a script on another
 * page that sends it carries an `Origin` and has been refused above.
 */
export function refusalOf(
  request: {
    readonly method?: string
    readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>
  },
  trustedOrigins: readonly string[],
  accepted: Accepted = json,
): HttpException | null {
  if (!changing.has((request.method ?? 'GET').toUpperCase())) {
    return null
  }

  const headers = request.headers ?? {}
  const origin = headers['origin']

  if (origin !== undefined && (typeof origin !== 'string' || !trustedOrigins.includes(origin))) {
    return new ForbiddenException(
      'Diese Anfrage kommt von einer fremden Adresse. Sie wird nur von der Adresse ' +
        'angenommen, unter der die Instanz erreichbar ist (TRUSTED_ORIGINS).',
    )
  }

  const contentType = headers['content-type']
  const length = Number(headers['content-length'] ?? 0)
  const carriesBody = length > 0 || headers['transfer-encoding'] !== undefined

  if (contentType === undefined) {
    return carriesBody ? new UnsupportedMediaTypeException(accepted.refusal) : null
  }

  if (typeof contentType !== 'string' || !accepted.mediaTypes.includes(essenceOf(contentType))) {
    return new UnsupportedMediaTypeException(accepted.refusal)
  }

  return null
}

/**
 * The defence against a form on somebody else's page, in front of every route
 * of ours that changes something (ADR 0006).
 *
 * The authentication checks the origin of its own routes. Until
 * GHSA-r7rq-234g-3jx8 the rest of an application relied on the session cookie
 * being `SameSite=Lax`. That keeps a foreign site out in a current browser,
 * but not a page on another subdomain of the same site: a browser counts it
 * as the same site and sends the cookie along. Only the first run setup and
 * the redemption of an invitation checked for themselves, the two routes that
 * write without anybody signed in.
 *
 * A guard and not a check in each route, so that the next route cannot be
 * written without it. It runs before the guard that asks who is calling, so a
 * foreign form costs no lookup of a session.
 */
@Injectable()
export class SameOriginGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TRUSTED_ORIGINS) private readonly trustedOrigins: readonly string[],
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const accepted = this.reflector.getAllAndOverride<Accepted | undefined>(ACCEPTS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ])
    const refusal = refusalOf(
      context.switchToHttp().getRequest(),
      this.trustedOrigins,
      accepted ?? json,
    )

    if (refusal) {
      throw refusal
    }

    return true
  }
}

/**
 * The most a transmission of the outbox may be, in bytes (#202).
 *
 * A device sends what it holds in parts of a megabyte of text
 * (`largestTransmission` in the web client); this leaves room for a part that
 * is one large operation on its own, a test protocol with its values twice,
 * as `from` and `to`, and in umlauts. Every other route reads the 100 kB
 * Express reads by default: none of them takes more than a form's worth, and
 * a body is read before anybody knows who sent it.
 *
 * The outbox is read by its route, after the guards (`outboxOf` in the sync),
 * so that eight megabytes are read for a device somebody is signed in on and
 * for nobody else.
 */
export const largestTransmissionBytes = 8 * 1024 * 1024

/**
 * The most operations one transmission of the outbox carries. Eight megabytes
 * of the smallest operations are tens of thousands, each a row written, a
 * receipt and a line in the log, and all of them in one transaction that holds
 * the counter of the tenant until it ends. A device sends parts of at most a
 * thousand (`mostTransmittedOperations` in the web client); this leaves twice
 * that for a client of an older version.
 */
export const mostOperationsPerTransmission = 2000

/** A transmission of the outbox, the one JSON body the parser in front leaves to its route. */
function isOutbox(request: Request): boolean {
  return request.method === 'POST' && request.path === '/sync'
}

/**
 * Reads JSON bodies and nothing else.
 *
 * Nest reads JSON and form bodies unless it is told otherwise. A form body is
 * the one thing a page on another site can send, no route here takes one, and
 * the guard above refuses it anyway; not parsing it at all is the same answer
 * with a parser less. A route that takes raw bytes reads them through a
 * middleware of its own, on that route alone. For an application created with
 * `bodyParser: false`.
 *
 * The outbox at `POST /sync` is passed by unread: its route reads it once the
 * guards have let it through, with a limit of its own. Until #202 it had the
 * 100 kB of every route, and a device over that was refused with an answer
 * that named no operation, so its outbox hung for good. After that it was read
 * here, with its larger limit, before anybody had asked who sent it.
 *
 * Called after the authentication is mounted, never before: Express reads a
 * body once, and a parser in front would hand the sign in a body it had made
 * something else of.
 */
export function readJsonBodiesOnly(application: NestExpressApplication): void {
  const everyOther = readJson()

  application.use((request: Request, response: Response, next: NextFunction) => {
    if (isOutbox(request)) {
      next()
    } else {
      everyOther(request, response, next)
    }
  })
}
