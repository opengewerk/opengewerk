/**
 * The first segment of every path the server of the Handwerkersoftware answers
 * itself, beside those of the foundation (`foundationPaths`).
 *
 * One list for three places that used to keep a copy each: the server, which
 * never hands a shell back for one of them; the service worker, which never
 * answers a navigation to one from its cache; and the development server of
 * the interface, which forwards them to the server. A path missing in one of
 * them came back as HTML where a program expects JSON, and the failure read
 * like a broken server.
 *
 * The test of the routes holds it against the controllers of the server, in
 * both directions: no route outside it, and nothing in it no route answers.
 */
export const serverPaths = [
  'customers',
  'contacts',
  'suppliers',
  'articles',
  'sites',
  'installations',
  'jobs',
  'tasks',
  'deadlines',
  'push',
  'audit',
  'tenants',
  'files',
  'attachments',
  'form-records',
  'time',
  'documents',
  'payments',
  'sync',
  'settings',
  'health',
] as const
