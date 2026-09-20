import { randomBytes } from 'node:crypto'

/**
 * The alphabet a generated password is built from.
 *
 * Thirty two characters, lower case, and four of them missing on purpose: `i`
 * and `l` are the same shape as `1`, `o` is the same shape as `0`, and `u` is
 * the same shape as `v` in most terminal faces. This password is read off a
 * terminal and typed into a browser by hand, once, and a character somebody
 * has to guess at costs more than the bit it carries.
 *
 * That it is exactly thirty two characters is what makes the draw fair: 256 is
 * a multiple of 32, so masking a random byte with 31 gives every character the
 * same chance. An alphabet of any other size would need the bytes outside the
 * last whole multiple thrown away, and code that forgets that is code with a
 * bias nobody sees.
 */
const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'

/**
 * The shortest password anybody may choose for themselves.
 *
 * Twelve, everywhere it is asked: on the command line, in the first run setup,
 * and when a new colleague redeems their link. It stood in three files as
 * three twelves until #63 put it here, which is two too many for a number
 * whose whole value is that it is the same one.
 *
 * Why twelve and not eight: these accounts are set up once and used for years,
 * and the thing on the other side of them is a company's books. It says
 * nothing about capitals or punctuation, because a rule about those buys a
 * predictable password with a capital at the front.
 */
export const shortestPassword = 12

/** Five groups of five, which is what makes it readable across a room. */
const groups = 5
const perGroup = 5

/**
 * A password for an account created without anybody choosing one.
 *
 * Twenty five characters out of thirty two possibilities is 125 bits, which is
 * far past anything a rule about capitals and punctuation would add. The
 * hyphens are part of it and have to be typed; they buy nothing against
 * guessing and everything against mistyping.
 *
 * It never becomes an argument and never an environment variable. It is
 * created here, handed to the account, printed once on standard output, and
 * forgotten.
 */
export function generatePassword(): string {
  const parts: string[] = []
  let part = ''

  for (const byte of randomBytes(groups * perGroup)) {
    // The mask, not a remainder: see the note on the alphabet above. `charAt`
    // rather than an index so that nothing here needs a fallback for a case
    // that cannot happen; a fallback would be a quiet bias towards whichever
    // character it named.
    part += alphabet.charAt(byte & 31)

    if (part.length === perGroup) {
      parts.push(part)
      part = ''
    }
  }

  return parts.join('-')
}
