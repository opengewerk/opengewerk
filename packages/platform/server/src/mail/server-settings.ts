import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  defaultSmtpPorts,
  type SmtpSecurity,
  smtpSecurities,
  type TenantId,
} from '@opengewerk/platform-domain'
import { eq } from 'drizzle-orm'

import type { Actor, Database, TenantTransaction } from '../database/database.js'
import { mailSettings } from '../database/schema/mail-settings.js'
import type { SecretKey } from '../secrets/key.js'
import type { SecretStore, StoredSecret } from '../secrets/store.js'
import { isHostName, isMailAddress, type MailConfiguration } from './configuration.js'

/**
 * The mail server of a tenant as a settings screen sees it, and never with
 * the password. Whether there is one, and whether it can still be opened, is
 * all a screen learns about it.
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

/** What a settings screen sends to set the mail server up or change it. */
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

/** Whether a tenant sends mail, and from where, for everybody who reads the settings. */
export interface MailStatus {
  readonly configured: boolean
  readonly from: string | null
}

/** How a job reaches the mail server of one tenant. */
export type MailConnection =
  | { readonly state: 'ready'; readonly configuration: MailConfiguration }
  /** Set up, but the password does not open. Messages wait until it is entered again. */
  | { readonly state: 'unreadable' }

/** The sentences about the mail server that name a tenant, in the words of the application. */
export interface MailServerSentences {
  /** A wish to send refused, because the tenant has no mail server, with where one is set up. */
  readonly notConfigured: string
  /** Removing a mail server the tenant does not have. */
  readonly noneToRemove: string
  /** Where the name in front of the sender address comes from, said after the address is refused. */
  readonly senderName: string
}

/**
 * What an application says about the mail servers of its tenants (ADR 0010).
 * How a mail server is checked, kept and opened is the foundation's; what a
 * signature may say, where the password is sealed and what becomes of the
 * messages still waiting is the application's.
 */
export interface MailServerRules<Purpose extends string> {
  /** The store the password is sealed in, and the purpose it is kept under there. */
  readonly secrets: SecretStore<Purpose>
  readonly purpose: Purpose
  /**
   * What is wrong with a signature as somebody wrote it, as a sentence, or
   * null. Its placeholders are the application's, and so is how long it may be.
   */
  readonly signatureProblem: (signature: string) => string | null
  /**
   * What becomes of the messages still waiting when the mail server is
   * removed, in the same transaction: the outbox is the application's.
   */
  readonly whenRemoved?: (tx: TenantTransaction, now: Date) => Promise<void>
  readonly sentences: MailServerSentences
}

/** The mail servers of the tenants, bound to the rules of an application. */
export interface MailServers {
  /**
   * The settings as they are to be kept: trimmed, the port filled in, and
   * every mistake that can be named before a server is asked refused with the
   * field it is in. What only the server can judge, whether the login is
   * right, is for the check.
   */
  validMailServer(wanted: MailServerInput): MailServerInput
  /** The mail server of a tenant, or null when it has none. */
  readMailServer(database: Database, actor: Actor, key: SecretKey): Promise<MailServerView | null>
  /**
   * Sets the mail server up, or changes it.
   *
   * The password is sealed into the store and only its moment goes into
   * `mail_settings`, where the audit log sees it. A settings row that says
   * there is a login and no password that opens is refused rather than kept:
   * the next message would find out the hard way.
   */
  saveMailServer(
    database: Database,
    actor: Actor,
    key: SecretKey,
    wanted: MailServerInput,
  ): Promise<MailServerView>
  /** Removes the mail server, and the login with it. */
  removeMailServer(database: Database, actor: Actor): Promise<void>
  /** Whether a tenant sends mail and from which address, for anybody who reads the settings. */
  mailStatusOf(database: Database, actor: Actor): Promise<MailStatus>
  /**
   * Refuses a wish to send when this tenant has no mail server, with the
   * sentence that says where one is set up. A message written anyway would
   * wait for a server nobody set up, and whoever asked would take it for sent.
   */
  requireMailServer(database: Database, actor: Actor): Promise<void>
  /**
   * How a job reaches the mail server of one tenant, with the password opened.
   * Null for a tenant that sends no mail.
   */
  connectionOf(
    database: Database,
    tenantId: TenantId,
    key: SecretKey,
  ): Promise<MailConnection | null>
  /**
   * Whether a connection is the one this tenant already sends through: the
   * same server, port, kind of connection and login, the password included.
   * Saving a new signature is not held up by a server that is down this
   * minute, saving a new login is.
   */
  sameConnection(
    database: Database,
    tenantId: TenantId,
    key: SecretKey,
    configuration: MailConfiguration,
  ): Promise<boolean>
  /**
   * The settings somebody is about to save, as a connection to try. The
   * password is the one typed in, or the one kept when none was typed, so
   * that checking a changed port does not ask for the password again.
   */
  configurationToTry(
    database: Database,
    actor: Actor,
    key: SecretKey,
    wanted: MailServerInput,
  ): Promise<MailConfiguration>
}

type SettingsRow = typeof mailSettings.$inferSelect

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
 * The mail servers of the tenants of an application.
 *
 * Every function is a closure over the rules and needs no `this`, so an
 * application may hand them on one by one under the names its callers use.
 */
export function mailServers<Purpose extends string>(rules: MailServerRules<Purpose>): MailServers {
  const { secrets, purpose, sentences } = rules

  const place = (tenantId: TenantId) => ({ tenantId, purpose })

  function validMailServer(wanted: MailServerInput): MailServerInput {
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
        `"${fromAddress}" ist keine E-Mail-Adresse. Als Absender steht hier nur die Adresse. ` +
          sentences.senderName,
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
        'Ein Passwort gehört zu einem Benutzernamen. Ohne Benutzernamen gibt es keine Anmeldung ' +
          'beim Mailserver und kein Passwort dafür.',
      )
    }

    if (signature !== null) {
      const problem = rules.signatureProblem(signature)

      if (problem !== null) {
        throw new BadRequestException(problem)
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

  async function readMailServer(
    database: Database,
    actor: Actor,
    key: SecretKey,
  ): Promise<MailServerView | null> {
    return database.forTenant(actor, async (tx) => {
      const row = await settingsOf(tx, actor.tenantId)

      return row ? viewOf(row, await secrets.read(tx, key, place(actor.tenantId))) : null
    })
  }

  async function saveMailServer(
    database: Database,
    actor: Actor,
    key: SecretKey,
    wanted: MailServerInput,
  ): Promise<MailServerView> {
    const input = validMailServer(wanted)

    return database.forTenant(actor, async (tx) => {
      const current = await settingsOf(tx, actor.tenantId)
      let passwordSetAt = current?.passwordSetAt ?? null

      if (input.username === null) {
        await secrets.forget(tx, place(actor.tenantId))
        passwordSetAt = null
      } else if (input.password !== undefined) {
        await secrets.keep(tx, key, place(actor.tenantId), input.password)
        passwordSetAt = new Date()
      } else {
        const stored = await secrets.read(tx, key, place(actor.tenantId))

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
            .where(eq(mailSettings.tenantId, actor.tenantId))
            .returning()
        : await tx
            .insert(mailSettings)
            .values({ tenantId: actor.tenantId, ...values })
            .returning()

      if (!row) {
        throw new NotFoundException('Die Einstellungen ließen sich nicht speichern.')
      }

      return viewOf(row, await secrets.read(tx, key, place(actor.tenantId)))
    })
  }

  async function removeMailServer(database: Database, actor: Actor): Promise<void> {
    await database.forTenant(actor, async (tx) => {
      const removed = await tx
        .delete(mailSettings)
        .where(eq(mailSettings.tenantId, actor.tenantId))
        .returning({ id: mailSettings.id })

      if (removed.length === 0) {
        throw new NotFoundException(sentences.noneToRemove)
      }

      await secrets.forget(tx, place(actor.tenantId))
      await rules.whenRemoved?.(tx, new Date())
    })
  }

  async function mailStatusOf(database: Database, actor: Actor): Promise<MailStatus> {
    const row = await database.forTenant(actor, (tx) => settingsOf(tx, actor.tenantId))

    return { configured: row !== null, from: row?.fromAddress ?? null }
  }

  async function requireMailServer(database: Database, actor: Actor): Promise<void> {
    if (!(await mailStatusOf(database, actor)).configured) {
      throw new ConflictException(sentences.notConfigured)
    }
  }

  async function connectionOf(
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

      const secret = await secrets.read(tx, key, place(tenantId))

      return secret.state === 'readable'
        ? {
            state: 'ready',
            configuration: { ...configuration, user: row.username, password: secret.value },
          }
        : { state: 'unreadable' }
    })
  }

  async function sameConnection(
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

  async function configurationToTry(
    database: Database,
    actor: Actor,
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

    const stored = await database.forTenant(actor, (tx) =>
      secrets.read(tx, key, place(actor.tenantId)),
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

  return {
    validMailServer,
    readMailServer,
    saveMailServer,
    removeMailServer,
    mailStatusOf,
    requireMailServer,
    connectionOf,
    sameConnection,
    configurationToTry,
  }
}
