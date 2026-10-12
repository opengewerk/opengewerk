import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { InstanceMailServerView } from '@opengewerk/platform-domain'
import { eq } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'
import type { MailConfiguration } from '../mail/configuration.js'
import {
  keptPasswordFits,
  type MailConnection,
  type MailConnectionInput,
  validMailConnection,
} from '../mail/server-settings.js'
import { instanceSettings } from '../schema.js'
import type { SecretKey } from '../secrets/key.js'

/**
 * The mail server of the instance (opengewerk-haustechnik#81): the one
 * server a mail to an account goes out through, the link to a new password
 * and the notice of a new passkey.
 *
 * An account belongs to the instance and to no tenant, and every other mail
 * server belongs to a tenant, set up by whoever leads it. A mail to an
 * account that went out through one of those could be read there: whoever
 * leads a tenant takes an account into it, enters a mail server of their own,
 * and the link to a new password of that account arrives at it. So these
 * mails have a server of their own, set up by whoever runs the instance, and
 * without one they are not sent at all.
 *
 * Kept on the one row of the settings of the instance. The password is
 * sealed with the key of the instance and for this purpose alone, so that a
 * sealed value copied from a tenant opens nothing here; the log of the
 * instance holds the moment it was set and never the password (the block
 * `instance.sql`).
 */

/** What the password is sealed for. Named again to open it, see `SecretKey`. */
const sealedFor = 'instance:mail-server'

const missing =
  'The settings of the instance are missing; the migration that creates the table writes them.'

const sender =
  'Den Namen davor setzt die Anwendung: eine E-Mail an ein Konto kommt unter ihrem Namen.'

type Row = typeof instanceSettings.$inferSelect

/** The row as a mail server, or null while the instance has none. */
function serverOf(row: Row) {
  return row.mailServerHost === null ||
    row.mailServerPort === null ||
    row.mailServerSecurity === null ||
    row.mailServerFrom === null
    ? null
    : {
        host: row.mailServerHost,
        port: row.mailServerPort,
        security: row.mailServerSecurity,
        username: row.mailServerUsername,
        fromAddress: row.mailServerFrom,
        sealed: row.mailServerPassword,
        passwordSetAt: row.mailServerPasswordSetAt,
      }
}

type Kept = NonNullable<ReturnType<typeof serverOf>>

/** The password kept, opened: none, one that opens, or one this instance can no longer open. */
function passwordOf(
  kept: Kept,
  key: SecretKey,
):
  | { readonly state: 'none' }
  | { readonly state: 'readable'; readonly value: string }
  | { readonly state: 'unreadable' } {
  if (kept.sealed === null) {
    return { state: 'none' }
  }

  const value = key.unseal(sealedFor, kept.sealed)

  return value === null ? { state: 'unreadable' } : { state: 'readable', value }
}

function viewOf(kept: Kept, key: SecretKey): InstanceMailServerView {
  const password = passwordOf(kept, key)

  return {
    host: kept.host,
    port: kept.port,
    security: kept.security,
    username: kept.username,
    fromAddress: kept.fromAddress,
    password: password.state === 'readable' ? 'set' : password.state,
    passwordSetAt: kept.passwordSetAt?.toISOString() ?? null,
  }
}

async function rowOf(tx: TenantTransaction, forUpdate = false): Promise<Row> {
  const query = tx.select().from(instanceSettings).where(eq(instanceSettings.id, 1))
  const [row] = await (forUpdate ? query.for('update') : query)

  if (!row) {
    throw new Error(missing)
  }

  return row
}

/** The fields of a connection out of a body, typed; what they mean `validMailConnection` checks. */
export function instanceMailServerInput(body: unknown): MailConnectionInput {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const text = (name: string, called: string): string | null => {
    const value = record[name]

    if (value === undefined || value === null) {
      return null
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${called} ist kein Text.`)
    }

    return value.trim() === '' ? null : value
  }
  const { port, password, security } = record

  if (port !== undefined && port !== null && typeof port !== 'number') {
    throw new BadRequestException('Der Port ist eine Zahl.')
  }

  if (password !== undefined && typeof password !== 'string') {
    throw new BadRequestException('Das Passwort ist ein Text.')
  }

  return {
    host: text('host', 'Der Server') ?? '',
    port: typeof port === 'number' ? port : null,
    security: (typeof security === 'string'
      ? security
      : 'starttls') as MailConnectionInput['security'],
    username: text('username', 'Der Benutzername'),
    ...(password === undefined ? {} : { password }),
    fromAddress: text('fromAddress', 'Die Absenderadresse') ?? '',
  }
}

/** The mail server of the instance as its settings show it, or null while there is none. */
export async function readInstanceMailServer(
  database: Database,
  key: SecretKey,
): Promise<InstanceMailServerView | null> {
  const kept = serverOf(await database.forInstance((tx) => rowOf(tx)))

  return kept ? viewOf(kept, key) : null
}

/**
 * The settings somebody is about to save, as a connection to try. The
 * password is the one typed in, or the one kept when none was typed; the one
 * kept goes to the server and the login it was typed in for and to no other,
 * as with the mail server of a tenant.
 */
export async function instanceMailConfigurationToTry(
  database: Database,
  key: SecretKey,
  wanted: MailConnectionInput,
): Promise<MailConfiguration> {
  const input = validMailConnection(wanted, sender)
  const configuration = {
    host: input.host,
    port: input.port,
    security: input.security,
    from: input.fromAddress,
  }

  if (input.username === null) {
    return { ...configuration, user: null, password: null }
  }

  if (input.password !== undefined) {
    return { ...configuration, user: input.username, password: input.password }
  }

  const kept = serverOf(await database.forInstance((tx) => rowOf(tx)))
  const password = kept ? passwordOf(kept, key) : ({ state: 'none' } as const)

  if (password.state !== 'readable') {
    throw new BadRequestException(
      password.state === 'none'
        ? 'Zum Benutzernamen fehlt das Passwort.'
        : 'Das gespeicherte Passwort lässt sich nicht mehr lesen. Es muss neu eingegeben werden.',
    )
  }

  keptPasswordFits(kept, input)

  return { ...configuration, user: input.username, password: password.value }
}

/** How a mail to an account reaches the mail server of the instance. Null while there is none. */
export async function instanceMailConnection(
  database: Database,
  key: SecretKey,
): Promise<MailConnection | null> {
  const kept = serverOf(await database.forInstance((tx) => rowOf(tx)))

  if (!kept) {
    return null
  }

  const configuration = {
    host: kept.host,
    port: kept.port,
    security: kept.security,
    from: kept.fromAddress,
  }

  if (kept.username === null) {
    return { state: 'ready', configuration: { ...configuration, user: null, password: null } }
  }

  const password = passwordOf(kept, key)

  return password.state === 'readable'
    ? {
        state: 'ready',
        configuration: { ...configuration, user: kept.username, password: password.value },
      }
    : { state: 'unreadable' }
}

/**
 * Whether a connection is the one the instance already sends through, the
 * password included: saving it again is not held up by a server that is down
 * this minute, saving a new login is.
 */
export async function sameInstanceMailConnection(
  database: Database,
  key: SecretKey,
  configuration: MailConfiguration,
): Promise<boolean> {
  const stored = await instanceMailConnection(database, key)

  if (stored?.state !== 'ready') {
    return false
  }

  const kept = stored.configuration

  return (
    kept.host === configuration.host &&
    kept.port === configuration.port &&
    kept.security === configuration.security &&
    kept.user === configuration.user &&
    kept.password === configuration.password
  )
}

/**
 * Sets the mail server of the instance up, or changes it. A row that says
 * there is a login and no password that opens is refused rather than kept.
 */
export async function saveInstanceMailServer(
  database: Database,
  userId: string,
  key: SecretKey,
  wanted: MailConnectionInput,
): Promise<InstanceMailServerView> {
  const input = validMailConnection(wanted, sender)

  return database.forInstance(
    async (tx) => {
      const kept = serverOf(await rowOf(tx, true))
      let sealed = kept?.sealed ?? null
      let passwordSetAt = kept?.passwordSetAt ?? null

      if (input.username === null) {
        sealed = null
        passwordSetAt = null
      } else if (input.password !== undefined) {
        sealed = key.seal(sealedFor, input.password)
        passwordSetAt = new Date()
      } else {
        const password = kept ? passwordOf(kept, key) : ({ state: 'none' } as const)

        if (password.state === 'none') {
          throw new BadRequestException('Zum Benutzernamen fehlt das Passwort.')
        }

        if (password.state === 'unreadable') {
          throw new BadRequestException(
            'Das gespeicherte Passwort lässt sich nicht mehr lesen, weil SESSION_SECRET der ' +
              'Instanz seitdem getauscht wurde. Es muss neu eingegeben werden.',
          )
        }

        keptPasswordFits(kept, input)
      }

      const [row] = await tx
        .update(instanceSettings)
        .set({
          mailServerHost: input.host,
          mailServerPort: input.port,
          mailServerSecurity: input.security,
          mailServerUsername: input.username,
          mailServerFrom: input.fromAddress,
          mailServerPassword: sealed,
          mailServerPasswordSetAt: passwordSetAt,
          updatedAt: new Date(),
        })
        .where(eq(instanceSettings.id, 1))
        .returning()
      const saved = row ? serverOf(row) : null

      if (!saved) {
        throw new Error(missing)
      }

      return viewOf(saved, key)
    },
    userId,
    'instance.settings',
  )
}

/** Removes the mail server of the instance, and the login with it. */
export async function removeInstanceMailServer(database: Database, userId: string): Promise<void> {
  await database.forInstance(
    async (tx) => {
      if (!serverOf(await rowOf(tx, true))) {
        throw new NotFoundException('Die Instanz hat keinen Mailserver, der sich entfernen ließe.')
      }

      await tx
        .update(instanceSettings)
        .set({
          mailServerHost: null,
          mailServerPort: null,
          mailServerSecurity: null,
          mailServerUsername: null,
          mailServerFrom: null,
          mailServerPassword: null,
          mailServerPasswordSetAt: null,
          updatedAt: new Date(),
        })
        .where(eq(instanceSettings.id, 1))
    },
    userId,
    'instance.settings',
  )
}
