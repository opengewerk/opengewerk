import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  defaultSmtpPorts,
  type Identity,
  signatureMaxLength,
  type SmtpSecurity,
  smtpSecurities,
  type TenantId,
  unknownPlaceholders,
} from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'
import { mailSettings } from '../database/schema/index.js'
import type { SecretKey } from '../secrets/key.js'
import { forgetSecret, keepSecret, readSecret, type StoredSecret } from '../secrets/store.js'
import { isHostName, isMailAddress, type MailConfiguration } from './configuration.js'
import { giveUpPending } from './outbox.js'

/**
 * The mail server of a business as the office sees it, and never with the
 * password. Whether there is one, and whether it can still be opened, is all
 * a screen learns about it.
 */
export interface MailServerView {
  readonly host: string
  readonly port: number
  readonly security: SmtpSecurity
  readonly username: string | null
  readonly fromAddress: string
  readonly signature: string | null
  /**
   * `unreadable` is a password this instance can no longer open, because
   * `SESSION_SECRET` has changed since it was sealed. It has to be entered
   * again, and until it is, nothing is sent.
   */
  readonly password: 'none' | 'set' | 'unreadable'
  readonly passwordSetAt: Date | null
  readonly updatedAt: Date
}

/** What the office sends to set the mail server up or change it. */
export interface MailServerInput {
  readonly host: string
  /** Null for the port that goes with the kind of connection. */
  readonly port: number | null
  readonly security: SmtpSecurity
  readonly username: string | null
  /** A new password. Left out, the one there is stays. */
  readonly password?: string
  readonly fromAddress: string
  readonly signature: string | null
}

/** Whether a business sends mail, and from where, for everybody who reads the settings. */
export interface MailStatus {
  readonly configured: boolean
  readonly from: string | null
}

/** How the job reaches the mail server of one business. */
export type MailConnection =
  | { readonly state: 'ready'; readonly configuration: MailConfiguration }
  /** Set up, but the password does not open. Messages wait until it is entered again. */
  | { readonly state: 'unreadable' }

type SettingsRow = typeof mailSettings.$inferSelect

const passwordPurpose = 'smtp_password'

function viewOf(row: SettingsRow, secret: StoredSecret): MailServerView {
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    fromAddress: row.fromAddress,
    signature: row.signature,
    password:
      secret.state === 'readable' ? 'set' : secret.state === 'unreadable' ? 'unreadable' : 'none',
    passwordSetAt: row.passwordSetAt,
    updatedAt: row.updatedAt,
  }
}

async function settingsOf(tx: TenantTransaction, tenantId: TenantId) {
  const [row] = await tx.select().from(mailSettings).where(eq(mailSettings.tenantId, tenantId))

  return row ?? null
}

/**
 * The settings as they are to be kept: trimmed, the port filled in, and every
 * mistake that can be named before a server is asked refused with the field
 * it is in. What only the server can judge, whether the login is right, is
 * for the check.
 */
export function validMailServer(wanted: MailServerInput): MailServerInput {
  const host = wanted.host.trim()
  const fromAddress = wanted.fromAddress.trim()
  const username = wanted.username?.trim() || null
  const signature = wanted.signature?.trim() ? wanted.signature.replace(/\r\n?/g, '\n') : null

  if (!(smtpSecurities as readonly string[]).includes(wanted.security)) {
    throw new BadRequestException('Die Verschlüsselung ist "starttls", "tls" oder "none".')
  }

  const port = wanted.port ?? defaultSmtpPorts[wanted.security]

  if (host === '' || !isHostName(host)) {
    throw new BadRequestException(
      'Der Server ist ein Name wie mail.example.de oder eine IP-Adresse, ohne "smtp://" davor ' +
        'und ohne Port; der hat ein Feld für sich.',
    )
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BadRequestException('Der Port ist eine Zahl zwischen 1 und 65535.')
  }

  if (!isMailAddress(fromAddress)) {
    throw new BadRequestException(
      `"${fromAddress}" ist keine E-Mail-Adresse. Als Absender steht hier nur die Adresse, der ` +
        'Name davor kommt aus dem Briefkopf.',
    )
  }

  if (wanted.password === '') {
    throw new BadRequestException(
      'Ein leeres Passwort gibt es nicht. Soll das gespeicherte bleiben, wird das Feld gar nicht ' +
        'mitgeschickt.',
    )
  }

  if (username === null && wanted.password !== undefined) {
    throw new BadRequestException(
      'Ein Passwort gehört zu einem Benutzernamen. Ohne Benutzernamen meldet sich OpenGewerk ' +
        'beim Mailserver nicht an und braucht keines.',
    )
  }

  if (signature !== null) {
    const unknown = unknownPlaceholders(signature)

    if (unknown.length > 0) {
      throw new BadRequestException(
        `In der Signatur steht ${unknown.join(', ')}. Möglich sind {benutzer} für den Namen ` +
          'dessen, der die E-Mail verschickt, und {briefkopf} für den Briefkopf.',
      )
    }

    if (signature.length > signatureMaxLength) {
      throw new BadRequestException(
        `Die Signatur ist länger als ${String(signatureMaxLength)} Zeichen.`,
      )
    }
  }

  return {
    host,
    port,
    security: wanted.security,
    username,
    ...(wanted.password === undefined ? {} : { password: wanted.password }),
    fromAddress,
    signature,
  }
}

/** The mail server of a business, or null when it has none. */
export async function readMailServer(
  database: Database,
  identity: Identity,
  key: SecretKey,
): Promise<MailServerView | null> {
  return database.forTenant(identity, async (tx) => {
    const row = await settingsOf(tx, identity.tenantId)

    return row ? viewOf(row, await readSecret(tx, key, identity.tenantId, passwordPurpose)) : null
  })
}

/**
 * Sets the mail server up, or changes it.
 *
 * The password is sealed into `secrets` and only its moment goes into
 * `mail_settings`, where the audit log sees it. A settings row that says there
 * is a login and no password that opens is refused rather than kept: the next
 * message would find out the hard way.
 */
export async function saveMailServer(
  database: Database,
  identity: Identity,
  key: SecretKey,
  wanted: MailServerInput,
): Promise<MailServerView> {
  const input = validMailServer(wanted)

  return database.forTenant(identity, async (tx) => {
    const current = await settingsOf(tx, identity.tenantId)
    let passwordSetAt = current?.passwordSetAt ?? null

    if (input.username === null) {
      await forgetSecret(tx, identity.tenantId, passwordPurpose)
      passwordSetAt = null
    } else if (input.password !== undefined) {
      await keepSecret(tx, key, identity.tenantId, passwordPurpose, input.password)
      passwordSetAt = new Date()
    } else {
      const stored = await readSecret(tx, key, identity.tenantId, passwordPurpose)

      if (stored.state === 'none') {
        throw new BadRequestException('Zum Benutzernamen fehlt das Passwort.')
      }

      if (stored.state === 'unreadable') {
        throw new BadRequestException(
          'Das gespeicherte Passwort lässt sich nicht mehr lesen, weil SESSION_SECRET der ' +
            'Instanz seitdem getauscht wurde. Es muss neu eingegeben werden.',
        )
      }
    }

    const values = {
      host: input.host,
      port: input.port ?? defaultSmtpPorts[input.security],
      security: input.security,
      username: input.username,
      fromAddress: input.fromAddress,
      signature: input.signature,
      passwordSetAt,
      updatedAt: new Date(),
    }

    const [row] = current
      ? await tx
          .update(mailSettings)
          .set(values)
          .where(eq(mailSettings.tenantId, identity.tenantId))
          .returning()
      : await tx
          .insert(mailSettings)
          .values({ tenantId: identity.tenantId, ...values })
          .returning()

    if (!row) {
      throw new NotFoundException('Die Einstellungen ließen sich nicht speichern.')
    }

    return viewOf(row, await readSecret(tx, key, identity.tenantId, passwordPurpose))
  })
}

/**
 * Removes the mail server, and the login with it.
 *
 * Messages still waiting are given up on with the reason rather than left to
 * go out whenever a server is set up again: a reminder for a task that was due
 * three weeks ago is not what somebody switching mail back on wants to send.
 */
export async function removeMailServer(database: Database, identity: Identity): Promise<void> {
  await database.forTenant(identity, async (tx) => {
    const removed = await tx
      .delete(mailSettings)
      .where(eq(mailSettings.tenantId, identity.tenantId))
      .returning({ id: mailSettings.id })

    if (removed.length === 0) {
      throw new NotFoundException('Für diesen Betrieb ist kein Mailserver eingerichtet.')
    }

    await forgetSecret(tx, identity.tenantId, passwordPurpose)
    await giveUpPending(
      tx,
      'Der Mailserver wurde entfernt, bevor die E-Mail hinausging.',
      new Date(),
    )
  })
}

/** Whether a business sends mail and from which address, for anybody who reads the settings. */
export async function mailStatusOf(database: Database, identity: Identity): Promise<MailStatus> {
  const row = await database.forTenant(identity, (tx) => settingsOf(tx, identity.tenantId))

  return { configured: row !== null, from: row?.fromAddress ?? null }
}

/**
 * Refuses a wish to send when this business has no mail server, with the
 * sentence that says where one is set up. A message written anyway would wait
 * for a server nobody set up, and the office would take it for sent.
 */
export async function requireMailServer(database: Database, identity: Identity): Promise<void> {
  if (!(await mailStatusOf(database, identity)).configured) {
    throw new ConflictException(
      'Für diesen Betrieb ist kein Mailserver eingerichtet, deshalb verschickt er keine ' +
        'E-Mails. Einrichten lässt er sich unter "E-Mail-Einstellungen".',
    )
  }
}

/**
 * How the job reaches the mail server of one business, with the password
 * opened. Null for a business that sends no mail.
 */
export async function connectionOf(
  database: Database,
  tenantId: TenantId,
  key: SecretKey,
): Promise<MailConnection | null> {
  return database.forTenant({ tenantId, reason: 'mail' }, async (tx) => {
    const row = await settingsOf(tx, tenantId)

    if (!row) {
      return null
    }

    const configuration = {
      host: row.host,
      port: row.port,
      security: row.security,
      from: row.fromAddress,
    }

    if (row.username === null) {
      return { state: 'ready', configuration: { ...configuration, user: null, password: null } }
    }

    const secret = await readSecret(tx, key, tenantId, passwordPurpose)

    return secret.state === 'readable'
      ? {
          state: 'ready',
          configuration: { ...configuration, user: row.username, password: secret.value },
        }
      : { state: 'unreadable' }
  })
}

/**
 * Whether a connection is the one this business already sends through: the
 * same server, port, kind of connection and login, the password included.
 * Saving a new signature is not held up by a server that is down this minute,
 * saving a new login is.
 */
export async function sameConnection(
  database: Database,
  tenantId: TenantId,
  key: SecretKey,
  configuration: MailConfiguration,
): Promise<boolean> {
  const stored = await connectionOf(database, tenantId, key)

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
 * The settings the office is about to save, as a connection to try. The
 * password is the one typed in, or the one kept when none was typed, so that
 * checking a changed port does not ask for the password again.
 */
export async function configurationToTry(
  database: Database,
  identity: Identity,
  key: SecretKey,
  wanted: MailServerInput,
): Promise<MailConfiguration> {
  const input = validMailServer(wanted)
  const configuration = {
    host: input.host,
    port: input.port ?? defaultSmtpPorts[input.security],
    security: input.security,
    from: input.fromAddress,
  }

  if (input.username === null) {
    return { ...configuration, user: null, password: null }
  }

  if (input.password !== undefined) {
    return { ...configuration, user: input.username, password: input.password }
  }

  const stored = await database.forTenant(identity, (tx) =>
    readSecret(tx, key, identity.tenantId, passwordPurpose),
  )

  if (stored.state !== 'readable') {
    throw new BadRequestException(
      stored.state === 'none'
        ? 'Zum Benutzernamen fehlt das Passwort.'
        : 'Das gespeicherte Passwort lässt sich nicht mehr lesen. Es muss neu eingegeben werden.',
    )
  }

  return { ...configuration, user: input.username, password: stored.value }
}
