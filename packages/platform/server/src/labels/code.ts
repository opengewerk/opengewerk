import { randomBytes } from 'node:crypto'

import { labelCodeFrom } from '@opengewerk/platform-domain'

import { isUniqueViolation } from '../api/database-errors.js'

/** No free code after every attempt: said to whoever asked, who asks again. */
export class LabelCodeUnavailableError extends Error {
  constructor() {
    super('Es ließ sich kein freier Code ziehen. Bitte noch einmal.')
  }
}

/** A code for a new label, from the randomness of the system. */
export function drawLabelCode(): string {
  return labelCodeFrom(randomBytes(10))
}

/**
 * Writes with a freshly drawn code, and once more with another when the code
 * stood in the table already.
 *
 * The server draws the code and never a client: it is what keeps the address
 * on a label from being guessed. A code drawn twice is as likely as none of
 * these requests ever being made; the loop is there so that the unique index,
 * named by `codeIndex`, is the last word and not an error nobody could have
 * caused. `write` is a transaction of its own each time, since the one that
 * met the index is over.
 */
export async function withLabelCode<Written>(
  codeIndex: string,
  write: (draw: () => string) => Promise<Written>,
): Promise<Written> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await write(drawLabelCode)
    } catch (error) {
      if (!isUniqueViolation(error, codeIndex)) {
        throw error
      }
    }
  }

  throw new LabelCodeUnavailableError()
}
