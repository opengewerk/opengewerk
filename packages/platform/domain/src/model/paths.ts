/**
 * The first segment of every path the server of the foundation answers itself
 * (ADR 0010): the authentication under `/api`, the routes of the sign in, the
 * first run, the people of a tenant, an invitation and the area of the
 * instance, the health check, the change log of a tenant, and the sync of an
 * application whose devices work without a network.
 *
 * Three read it, each together with the paths the server of its application
 * answers: the server, which never hands a shell back for one of them; the
 * service worker, which never answers a navigation to one from its cache; and
 * the development server of an interface, which forwards them to the server.
 * A path missing from one of the three comes back as HTML where a program
 * expects JSON, and the failure reads like a broken server. Until #12 each of
 * the three kept a list of its own.
 *
 * A test of the server side holds the list against the routes of the
 * foundation, in both directions: no route outside it, and nothing in it that
 * no route answers. An application holds its own list against its routes the
 * same way.
 */
export const foundationPaths = [
  'api',
  'auth',
  'setup',
  'staff',
  'invitation',
  'instance',
  'health',
  'audit',
  'sync',
] as const
