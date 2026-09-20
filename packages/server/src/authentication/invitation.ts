import { createHash, randomBytes } from 'node:crypto'

/**
 * The one time link a new colleague comes in through.
 *
 * A token of 32 random bytes, handed out once and never stored. What stays
 * behind is its SHA-256, so the table of invitations is a list of who was
 * invited rather than a ring of keys, and a backup of it opens nothing.
 *
 * Why a link at all, rather than a password the office types in and passes on:
 * the issue this was built for puts it in one sentence, and it is the whole
 * argument. A password a colleague knows and that then stays for three years
 * is worse than one nobody knows. Whoever opens the link sets their own, and
 * from that moment the only person who knows it is the person it belongs to.
 *
 * What a link is not is a secret channel. It travels by whatever the office
 * uses, a message, a note on a desk, a sentence in a corridor, and anybody who
 * reads it on the way can use it. Three things make that bearable and they are
 * the reason for each of the three columns next to the hash: it works once, it
 * stops working after a week, and the office can call it back. A password
 * handed over the same way has none of the three.
 */

/**
 * How many bytes go into a token.
 *
 * Thirty two, so that guessing is not a threat model and the route that reads
 * one needs no rate limit of its own to stay honest. base64url of 32 bytes is
 * 43 characters, which fits in a URL without escaping and survives being
 * pasted out of a message.
 */
const tokenBytes = 32

export interface MintedToken {
  /** Shown once, to the office, and never stored anywhere. */
  readonly token: string
  /** What goes in the database. */
  readonly hash: string
}

export function mintToken(): MintedToken {
  const token = randomBytes(tokenBytes).toString('base64url')

  return { token, hash: hashToken(token) }
}

/**
 * The hash a token is recognised by.
 *
 * A plain SHA-256 and deliberately not a password hash. Argon2id exists to
 * make guessing a human chosen secret expensive; this secret is 256 random
 * bits, where guessing is already out of reach, and a slow hash on a route
 * anybody may call would be a way of making the server do work for free.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Whether a token could be one of ours at all.
 *
 * Checked before the database is asked, so that a path with a stray character
 * in it costs a comparison instead of a query. It says nothing about whether
 * the token is good, only that it has the shape of one.
 */
export function looksLikeAToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value)
}
