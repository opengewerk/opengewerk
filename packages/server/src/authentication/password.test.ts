import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { ConfigurationError } from '../configuration.js'
import { readNewPassword } from './password.js'

/**
 * The password for `add-staff` and `reset-password`, typed on the terminal and
 * never shown. `add-staff` used to make one up when none was given (#64) and
 * print it, and a printed password stays in the scrollback of the terminal
 * until somebody replaces it.
 */

const password = 'ein-langes-passwort'

/**
 * A terminal with somebody at it, who types the next of `keys` whenever a
 * question appears, and a record of everything the screen showed.
 */
function somebodyTyping(keys: string[], isTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY })
  let screen = ''
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      const text = chunk.toString()

      screen += text

      const next = text.endsWith(': ') ? keys.shift() : undefined

      if (next !== undefined) {
        // Once the question is out, as a person would.
        setImmediate(() => {
          input.write(next)
        })
      }

      done()
    },
  })

  return { terminal: { input, output }, screen: () => screen }
}

async function refusalOf(answer: Promise<string>): Promise<ConfigurationError> {
  const refusal: unknown = await answer.then(
    () => null,
    (error: unknown) => error,
  )

  expect(refusal).toBeInstanceOf(ConfigurationError)

  return refusal as ConfigurationError
}

describe('a password on the command line', () => {
  it('is asked for twice and never shown', async () => {
    const { terminal, screen } = somebodyTyping([`${password}\r`, `${password}\r`])

    expect(await readNewPassword(undefined, terminal)).toBe(password)
    expect(screen()).toBe('Passwort: \nNoch einmal: \n')
  })

  it('is not taken when the two entries differ or the first is too short', async () => {
    const differing = somebodyTyping([`${password}\r`, 'ein-anderes-passwort\r'])

    expect((await refusalOf(readNewPassword(undefined, differing.terminal))).message).toContain(
      'nicht gleich',
    )

    const short = somebodyTyping(['kurz\r'])

    expect((await refusalOf(readNewPassword(undefined, short.terminal))).message).toContain(
      'mindestens 12 Zeichen',
    )
    // Not asked a second time for a password that could not be taken.
    expect(short.screen()).toBe('Passwort: \n')
  })

  it('stops on Ctrl+C and on Ctrl+D instead of waiting for good', async () => {
    for (const key of ['\u0003', '\u0004']) {
      const { terminal } = somebodyTyping([key])

      expect((await refusalOf(readNewPassword(undefined, terminal))).message).toContain(
        'Abgebrochen',
      )
    }
  })

  it('comes from OPENGEWERK_PASSWORD in a script, and only there', async () => {
    const script = somebodyTyping([], false)

    expect(await readNewPassword(` ${password} `, script.terminal)).toBe(password)
    expect(script.screen()).toBe('')
    expect((await refusalOf(readNewPassword('kurz', script.terminal))).message).toContain(
      'OPENGEWERK_PASSWORD',
    )
    // Without a terminal and without the variable there is nobody to ask,
    // and nothing is made up instead.
    expect((await refusalOf(readNewPassword(undefined, script.terminal))).message).toContain(
      'OPENGEWERK_PASSWORD',
    )
  })
})
