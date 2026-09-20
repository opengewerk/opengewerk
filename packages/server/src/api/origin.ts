import { BadRequestException, ForbiddenException } from '@nestjs/common'

/**
 * The same defence better-auth puts in front of the sign in, for the routes of
 * ours that write without anybody being signed in.
 *
 * There are two: the first run setup, which creates the first business on an
 * empty instance, and the redemption of an invitation link, which creates an
 * account and puts it into a business. Both have to answer somebody who cannot
 * be identified yet, which is the whole problem each of them exists to solve,
 * and both would otherwise be reachable from a form on a stranger's page while
 * the person who should be using them is looking at that page.
 *
 * Two checks, and they cover different halves. A browser sends `Origin` on
 * every cross site POST, so a form from elsewhere is refused by the first. A
 * request with no `Origin` at all passes it, which is the ordinary case for
 * `curl` on the machine itself; the second catches what a browser could still
 * send that way, because a form can only send the two encodings HTML knows and
 * neither of them is JSON. Anything that wants to send JSON from another
 * origin is asked for permission first, and nothing here gives it.
 *
 * It was written once for the setup in #62 and moved here in #63, when the
 * second route needed it. A check like this copied into a second file is a
 * check that is about to differ from itself.
 */
export function refuseAForeignForm(
  request: unknown,
  trustedOrigins: readonly string[],
  /** What is being refused, so the sentence names it. */
  what: string,
): void {
  const headers = (request as { headers?: Record<string, unknown> }).headers ?? {}
  const origin = headers['origin']
  const contentType = headers['content-type']

  if (typeof origin === 'string' && origin !== '' && !trustedOrigins.includes(origin)) {
    throw new ForbiddenException(
      `Diese Anfrage kommt von einer fremden Adresse. ${what} läuft nur über die Adresse, ` +
        'unter der die Instanz erreichbar ist (TRUSTED_ORIGINS).',
    )
  }

  if (typeof contentType !== 'string' || !contentType.includes('application/json')) {
    throw new BadRequestException(`${what} erwartet JSON.`)
  }
}
