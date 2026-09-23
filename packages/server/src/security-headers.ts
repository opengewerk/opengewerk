import type { Express, NextFunction, Request, Response } from 'express'

/**
 * The Content-Security-Policy of the two shells (#131, ADR 0006).
 *
 * Everything from this origin and nothing from anywhere else. The built shells
 * carry no inline script and no inline style, so neither needs a hash or a
 * nonce; React sets the one style it does set through the CSSOM, which the
 * policy does not govern. The service worker, the manifest, the fonts and the
 * icons all come from here as well.
 *
 * On the shells and not on every answer. The shells are the documents script
 * runs in; an answer from the API is JSON or a PDF, and a policy on a PDF only
 * risks the viewer the browser opens it in.
 */
export const shellPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/**
 * The headers every answer carries, the API's, the interface's and
 * better-auth's alike (#131).
 *
 * - `nosniff`, so that a file is what its type says and a browser does not
 *   guess a script out of an upload.
 * - No referrer at all. Two addresses of this application carry a token, the
 *   invitation and the new password, and the server needs no referrer for
 *   anything.
 * - No framing, as `X-Frame-Options` for the browsers that do not read
 *   `frame-ancestors`.
 * - HSTS for a year. A browser honours it only over TLS, which is how an
 *   instance runs. Whether it should last longer or cover the subdomains is
 *   the operator's to decide for their domain, and the proxy then replaces
 *   the value rather than sending a second header: a browser reads only the
 *   first.
 * - The window and the resources to this origin (`COOP`, `CORP`).
 *
 * Set here and not in the proxy, so that an instance behind any proxy has
 * them. The README says which the proxy must not send a second time.
 */
export function sendSecurityHeaders(application: Express): void {
  application.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Strict-Transport-Security', 'max-age=31536000')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    next()
  })
}
