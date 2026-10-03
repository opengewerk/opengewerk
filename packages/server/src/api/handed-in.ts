/**
 * What the module hands to the controllers that cannot get it from a
 * constructor type.
 *
 * `Database` is a class, so Nest can inject it by its type. These are not:
 * they are values, each needs a token to be injected by, and a token is a
 * symbol. The tokens of what the foundation's own parts read, the trusted
 * origins, the authentication, the setup code, the file store, the record of
 * the last backup, the renderer and what mail needs, are the foundation's.
 *
 * They sit in a file of their own rather than next to the first controller
 * that needed them: a controller importing from another would say the two
 * belong together when what they share is only this.
 */

/**
 * The key values are sealed with that are not a login to something outside:
 * the ways into a site (#286). The same key as the mail password's, from
 * `SESSION_SECRET`; null in a test that seals nothing, and every route that
 * would seal then says so.
 */
export const SECRETS = Symbol('Secrets')
