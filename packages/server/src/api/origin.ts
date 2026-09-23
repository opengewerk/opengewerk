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
 * Marks the one kind of route whose body is not JSON, today the logo, with
 * the types it takes and what to say about any other. The types have to be
 * ones a form cannot send; an image is, a form only knows three encodings.
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
 * better-auth checks the origin of its own routes under `/api/auth`. Until
 * GHSA-r7rq-234g-3jx8 the rest of the application relied on the session
 * cookie being `SameSite=Lax`. That keeps a foreign site out in a current
 * browser, but not a page on another subdomain of the same site: a browser
 * counts it as the same site and sends the cookie along. Only the first run
 * setup and the redemption of an invitation checked for themselves, the two
 * routes that write without anybody signed in.
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
 * Reads JSON bodies and nothing else.
 *
 * Nest reads JSON and form bodies unless it is told otherwise. A form body is
 * the one thing a page on another site can send, no route here takes one, and
 * the guard above refuses it anyway; not parsing it at all is the same answer
 * with a parser less. The logo reads its raw bytes through a middleware of its
 * own, on its route alone. For an application created with `bodyParser: false`.
 *
 * Called after better-auth is mounted, never before: Express reads a body
 * once, and a parser in front would leave the sign in with an empty one, which
 * looks exactly like a wrong password.
 */
export function readJsonBodiesOnly(application: NestExpressApplication): void {
  application.useBodyParser('json')
}
