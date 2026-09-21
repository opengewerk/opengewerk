import type { Identity } from '@opengewerk/domain'
import type { RequestHandler } from 'express'

import type { IdentitySource, SignedInUser } from '../api/identity.js'

/** The session every request of the preview is said to carry. */
export const previewSessionId = 'preview-session'

/**
 * An identity source that answers every request with the same person, in the
 * same business, with the same roles, whatever the request carries.
 *
 * The API tests work this way, through a header; the preview does without
 * even that, because a browser sends no header of its own. That is the whole
 * of what makes the preview a preview, and the reason for the fences around
 * it: this folder is left out of `dist` and with it out of the image, the
 * entry point refuses `NODE_ENV=production` and a database that is not local,
 * and it listens on 127.0.0.1 and nowhere else.
 *
 * What stays real is everything behind the guard. Rights are checked against
 * the roles here exactly as against a membership, row level security isolates
 * the business, and the audit log writes down who did what.
 */
export class PreviewIdentitySource implements IdentitySource {
  private readonly identity: Identity

  constructor(identity: Identity) {
    this.identity = identity
  }

  identify(): Promise<Identity> {
    return Promise.resolve(this.identity)
  }

  authenticate(): Promise<SignedInUser> {
    return Promise.resolve({ userId: this.identity.userId, sessionId: previewSessionId })
  }
}

/**
 * What stands where better-auth's routes stand on an instance, under
 * `/api/auth`.
 *
 * One of them is answered: the question the interface asks first, who is
 * signed in and in which business. The answer names the preview's person with
 * the business already chosen, so the interface goes straight to work. Every
 * other route of the sign in says that there is none, because signing in,
 * signing out and setting up a second factor have nothing to act on here.
 */
export function previewSession(
  identity: Identity,
  user: { readonly name: string; readonly email: string },
): RequestHandler {
  return (request, response) => {
    if (request.method === 'GET' && request.path === '/get-session') {
      response.json({
        user: {
          id: identity.userId,
          name: user.name,
          email: user.email,
          twoFactorEnabled: true,
        },
        session: {
          id: previewSessionId,
          userId: identity.userId,
          activeTenantId: identity.tenantId,
        },
      })

      return
    }

    response.status(404).json({
      statusCode: 404,
      message:
        'In der Vorschau gibt es keine Anmeldung. Jede Anfrage läuft mit der Rolle Inhaber ' +
        'des Beispielbetriebs.',
    })
  }
}
