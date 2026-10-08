import { tmpdir } from 'node:os'
import { PassThrough, Writable } from 'node:stream'

import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { CommandSurroundings } from '../command-line.js'
import { ConfigurationError, type Environment } from '../configuration.js'
import { newId } from '../database/identifier.js'
import { addStaff, addStaffCommand, resetPassword, resetPasswordCommand } from './commands.js'
import {
  probeAccess,
  type ProbeFoundation,
  probeChoice,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin,
  probewerk,
} from './probe-application.js'

/**
 * The two commands that are the way back when the interface is no way in,
 * started the way an application starts them: with its name, its roles and its
 * words. What they say on the terminal names the tenant and the roles as that
 * application does, and the variable a script hands a password over in is the
 * one that application reads.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const first = 'das-erste-lange-passwort'
const second = 'das-zweite-lange-passwort'

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let environment: Environment

/** A script: nobody at the terminal, and nothing shown on it. */
function script(): NonNullable<CommandSurroundings['terminal']> {
  return {
    input: Object.assign(new PassThrough(), { isTTY: false }),
    output: new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    }),
  }
}

/** Runs a command as a script would, and hands back what it said. */
async function said(
  command: (surroundings: CommandSurroundings) => Promise<void>,
  given: readonly string[],
  password?: string,
): Promise<string[]> {
  const lines: string[] = []

  await command({
    arguments: given,
    environment: { ...environment, ...(password ? { PROBEWERK_PASSWORD: password } : {}) },
    terminal: script(),
    say: (line) => lines.push(line),
  })

  return lines
}

const adding = (surroundings: CommandSurroundings) => addStaff(probewerk, probeAccess, surroundings)
const resetting = (surroundings: CommandSurroundings) =>
  resetPassword(probewerk, probeAccess, surroundings)

async function refusal(work: Promise<unknown>): Promise<string> {
  const error: unknown = await work.then(
    () => null,
    (caught: unknown) => caught,
  )

  expect(error).toBeInstanceOf(ConfigurationError)

  return (error as ConfigurationError).message
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north])

  environment = {
    DATABASE_URL: foundation.kit.applicationDatabaseUrl(),
    STORAGE_PATH: tmpdir(),
    SESSION_SECRET: 'c'.repeat(64),
    TRUSTED_ORIGINS: probeOrigin,
  }

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl())
})

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('putting somebody into a tenant from the command line', () => {
  it('says how it is called, in the words of the application, when something is missing', async () => {
    const message = await refusal(said(adding, [north.id, 'neu@example.de']))

    expect(message).toContain('Aufruf: add-staff <mandant> <e-mail> "<name>" <rolle> [<rolle> ...]')
    expect(message).toContain('Mögliche Rollen: lead, member, guest')
    // The variable a script hands the password over in is the application's.
    expect(message).toContain('der Umgebungsvariable PROBEWERK_PASSWORD')
  })

  it('refuses a role the application does not have, and names the ones it has', async () => {
    const message = await refusal(
      said(adding, [north.id, 'neu@example.de', 'Nina Neu', 'member', 'chief'], first),
    )

    expect(message).toBe('Unbekannte Rolle: chief. Möglich sind: lead, member, guest')
    expect(await instance.signIn('neu@example.de', first)).toBe('')
  })

  it('makes an account with the password from the variable, and says so', async () => {
    const lines = await said(adding, [north.id, 'neu@example.de', 'Nina Neu', 'member'], first)

    expect(lines).toEqual([
      `neu@example.de ist beim Mandanten ${north.id} angelegt, Rollen: member.`,
    ])

    const cookies = await instance.signIn('neu@example.de', first)

    expect(cookies).not.toBe('')
    expect((await instance.http().get('/auth/tenants').set('cookie', cookies)).body).toEqual([
      probeChoice(north, ['member']),
    ])
  })

  it('says that a second factor is due when the roles need one', async () => {
    const lines = await said(adding, [north.id, 'leitung@example.de', 'Lea Leitung', 'lead'], first)

    expect(lines).toEqual([
      `leitung@example.de ist beim Mandanten ${north.id} angelegt, Rollen: lead.`,
      'Für die Leitung eines Mandanten ist ein zweiter Faktor Pflicht.',
    ])
  })

  /**
   * An account that is already there keeps its password, so there is nothing
   * to ask for: the command runs without a terminal and without the variable,
   * where asking would have stopped it.
   */
  it('leaves the password of an account that is already there, and asks for none', async () => {
    const lines = await said(adding, [north.id, 'neu@example.de', 'Nina Neu', 'lead', 'member'])

    expect(lines[0]).toBe(
      `neu@example.de gab es schon. Die Rollen beim Mandanten ${north.id} stehen jetzt auf: ` +
        'lead, member.',
    )
    expect(await instance.signIn('neu@example.de', first)).not.toBe('')
  })

  it('refuses a password too short to be worth having, naming the variable it came from', async () => {
    const message = await refusal(
      said(adding, [north.id, 'kurz@example.de', 'Karl Kurz', 'member'], 'kurz'),
    )

    expect(message).toContain('PROBEWERK_PASSWORD ist kürzer als 12 Zeichen')
    expect(await instance.signIn('kurz@example.de', 'kurz')).toBe('')
  })

  it('stops without a terminal and without the variable, and makes nothing up', async () => {
    const message = await refusal(
      said(adding, [north.id, 'still@example.de', 'Stefan Still', 'member']),
    )

    expect(message).toContain('aus der Umgebungsvariable PROBEWERK_PASSWORD')

    const { rows } = await admin.query("select 1 from auth_users where email = 'still@example.de'")

    expect(rows).toEqual([])
  })

  it('says what is wrong with the environment before it connects anywhere', async () => {
    const lines: string[] = []
    const message = await refusal(
      addStaff(probewerk, probeAccess, {
        arguments: [north.id, 'neu@example.de', 'Nina Neu', 'member'],
        environment: { ...environment, DATABASE_URL: undefined },
        terminal: script(),
        say: (line) => lines.push(line),
      }),
    )

    expect(message).toContain('DATABASE_URL')
    expect(lines).toEqual([])
  })
})

describe('a new password from the command line', () => {
  it('says how it is called when the address is missing', async () => {
    const message = await refusal(said(resetting, []))

    expect(message).toContain('Aufruf: reset-password <e-mail>')
    expect(message).toContain('der Umgebungsvariable PROBEWERK_PASSWORD')
  })

  it('says that there is no such account, before it asks for a password', async () => {
    // Without the variable and without a terminal: asking would have stopped
    // it with another sentence.
    expect(await refusal(said(resetting, ['niemand@example.de']))).toBe(
      'Auf dieser Instanz gibt es keinen Zugang für niemand@example.de.',
    )
  })

  it('replaces the password, ends every session of the account, and says so', async () => {
    const open = await instance.signIn('neu@example.de', first)

    expect(open).not.toBe('')

    const lines = await said(resetting, ['neu@example.de'], second)

    expect(lines).toEqual([
      'Das Passwort von neu@example.de ist ersetzt, und alle Geräte dieses Zugangs sind ' +
        'abgemeldet. Ein eingerichteter zweiter Faktor gilt weiter.',
    ])

    await instance.http().get('/auth/tenants').set('cookie', open).expect(401)
    expect(await instance.signIn('neu@example.de', first)).toBe('')
    expect(await instance.signIn('neu@example.de', second)).not.toBe('')
  })
})

describe('a command that stops', () => {
  /**
   * The ending of a command: the sentence goes to the terminal as it is, and
   * the exit code says that it failed, so that a script notices.
   */
  it('prints the sentence and sets the exit code', async () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const before = process.exitCode

    try {
      await addStaffCommand(probewerk, probeAccess, {
        arguments: [],
        environment,
        terminal: script(),
      })

      expect(process.exitCode).toBe(1)
      expect(printed).toHaveBeenCalledTimes(1)
      expect(String(printed.mock.calls[0]?.[0])).toContain('Aufruf: add-staff')

      process.exitCode = before
      printed.mockClear()

      await resetPasswordCommand(probewerk, probeAccess, {
        arguments: ['niemand@example.de'],
        environment,
        terminal: script(),
      })

      expect(process.exitCode).toBe(1)
      expect(String(printed.mock.calls[0]?.[0])).toBe(
        'Auf dieser Instanz gibt es keinen Zugang für niemand@example.de.',
      )
    } finally {
      process.exitCode = before
    }
  })

  it('leaves the exit code alone when it went through', async () => {
    const before = process.exitCode
    const lines: string[] = []

    await addStaffCommand(probewerk, probeAccess, {
      arguments: [north.id, 'durch@example.de', 'Dora Durch', 'member'],
      environment: { ...environment, PROBEWERK_PASSWORD: first },
      terminal: script(),
      say: (line) => lines.push(line),
    })

    expect(process.exitCode).toBe(before)
    expect(lines).toHaveLength(1)
  })
})
