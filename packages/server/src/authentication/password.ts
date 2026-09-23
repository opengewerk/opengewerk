import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import type { Readable } from 'node:stream'

import { ConfigurationError } from '../configuration.js'

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

/** Where a command asks its questions: what is typed, and the screen. */
export interface Terminal {
  readonly input: Readable & { readonly isTTY?: boolean }
  readonly output: Writable
}

/**
 * The password for `add-staff` and `reset-password`, asked for twice and never
 * shown, like `passwd`.
 *
 * It appears nowhere: not on the screen, not in the process list, not in the
 * history of the shell. From a script, without a terminal, it comes from
 * `OPENGEWERK_PASSWORD` instead. Nothing is made up here. `add-staff` used to
 * make one up when none was given and print it once (#64), and a printed
 * password stays in the scrollback of whoever ran the command, valid until
 * somebody replaces it; code scanning rightly called that clear-text logging.
 */
export async function readNewPassword(
  given: string | undefined,
  terminal: Terminal,
): Promise<string> {
  if (given !== undefined) {
    const password = given.trim()

    if (password.length < shortestPassword) {
      throw new ConfigurationError(
        `OPENGEWERK_PASSWORD ist kürzer als ${String(shortestPassword)} Zeichen. Kurze ` +
          'Passwörter sind bei der Anmeldung die teure Stelle, weil sie einmal gesetzt und ' +
          'jahrelang benutzt werden.',
      )
    }

    return password
  }

  if (!terminal.input.isTTY) {
    throw new ConfigurationError(
      'Kein Terminal, das nach dem Passwort fragen könnte. Aus einem Skript heraus kommt es ' +
        'aus der Umgebungsvariable OPENGEWERK_PASSWORD.',
    )
  }

  const reader = hiddenReader(terminal)

  try {
    const password = await reader.ask('Passwort: ')

    if (password.length < shortestPassword) {
      // Not asked a second time: it could not be taken anyway.
      throw new ConfigurationError(
        `Das Passwort braucht mindestens ${String(shortestPassword)} Zeichen.`,
      )
    }

    if ((await reader.ask('Noch einmal: ')) !== password) {
      throw new ConfigurationError('Die beiden Eingaben sind nicht gleich.')
    }

    return password
  } finally {
    reader.close()
  }
}

/**
 * Questions whose answers are not shown. Whatever readline would echo goes
 * nowhere, and the terminal does not echo either, because readline switches
 * it to raw mode for as long as it reads.
 */
function hiddenReader(terminal: Terminal) {
  const nowhere = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  })
  const reader = createInterface({
    input: terminal.input,
    output: nowhere,
    terminal: true,
    historySize: 0,
  })

  return {
    async ask(question: string): Promise<string> {
      terminal.output.write(question)

      try {
        return await reader.question('')
      } catch {
        // Ctrl+C, and Ctrl+D on an empty line, close the reader, and a
        // question still open is refused rather than left waiting.
        throw new ConfigurationError('Abgebrochen.')
      } finally {
        // The Enter that ended the answer was not shown either.
        terminal.output.write('\n')
      }
    },
    close() {
      reader.close()
    },
  }
}
