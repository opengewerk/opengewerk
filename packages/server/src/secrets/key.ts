import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/** The first part of every sealed value, so that a later scheme can tell its own apart. */
const scheme = 'v1'

/**
 * The key the credentials a business hands the instance are sealed with.
 *
 * Derived from `SESSION_SECRET` rather than read from a variable of its own.
 * That secret already has to be kept, backed up and never changed lightly: a
 * new one makes every second factor unreadable, and now every stored mail
 * password as well, which the screen then says. A second variable would be a
 * second thing to lose, and the first one to be forgotten in a restore.
 *
 * HKDF with a label of its own keeps the two uses apart: nothing sealed here
 * can be opened with what the authentication makes of the same secret, and the
 * other way round.
 *
 * The bytes live in a private field. The key travels through the process in
 * the objects the job and the routes are handed, and a stray `console.log` of
 * one of them must not print it.
 */
export class SecretKey {
  readonly #bytes: Buffer

  private constructor(bytes: Buffer) {
    this.#bytes = bytes
  }

  static from(sessionSecret: string): SecretKey {
    return new SecretKey(
      Buffer.from(hkdfSync('sha256', sessionSecret, 'opengewerk', 'opengewerk secrets v1', 32)),
    )
  }

  /**
   * Seals a value for one context, `<tenant>:<purpose>`. The context is not
   * stored with it but has to be named again to open it, so a sealed value
   * copied to another business or another purpose opens nowhere.
   */
  seal(context: string, value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.#bytes, iv)

    cipher.setAAD(Buffer.from(context, 'utf8'))

    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])

    return [scheme, iv, cipher.getAuthTag(), body]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join(':')
  }

  /**
   * Opens a sealed value, or null when it does not open: sealed under another
   * key, for another context, or changed since. The three look the same from
   * here and are the same to the caller, a value that has to be entered again.
   */
  unseal(context: string, sealed: string): string | null {
    const [version, iv, tag, body] = sealed.split(':')

    if (version !== scheme || !iv || !tag || body === undefined) {
      return null
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#bytes, Buffer.from(iv, 'base64url'))

      decipher.setAAD(Buffer.from(context, 'utf8'))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))

      return Buffer.concat([
        decipher.update(Buffer.from(body, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      return null
    }
  }
}
