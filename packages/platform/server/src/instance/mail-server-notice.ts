import type { TenantId } from '@opengewerk/platform-domain'

import type { Database } from '../database/database.js'
import type { MailContext } from '../mail/context.js'
import type { MailConnection } from '../mail/server-settings.js'
import { accountMailServerChanges } from '../schema.js'
import type { AccountMessages } from './account-mail.js'
import { listInstanceTenants } from './tenants.js'

/**
 * What every tenant learns of a change of the mail server of the instance
 * (opengewerk-haustechnik#360).
 *
 * The link to a new password goes out through that server and through no
 * other (`account-mail.ts`), so whoever sets it up could read the links there
 * and choose the password of anybody on the instance. Setting it up takes a
 * confirmation with the password (`instance.controller.ts`), and that is not
 * all: no tenant should only learn of a new server once its people are locked
 * out. So a change goes two ways.
 *
 * Into the log of every tenant, through `account_mail_server_changes`, as the
 * person who made it. A row there is written once and stays, and whoever runs
 * the instance has no way to take it out of a log that is not theirs.
 *
 * And by mail to whoever leads a tenant on the instance, through the server
 * that was there before the change. The new one is the one in question: a
 * server set up to read the links could just as well hold back the mail that
 * says so. Where there was none before, or its password no longer opens,
 * nothing goes out and the log says it alone.
 */

/** A mail server as a tenant is told of it: its name, and the address it sends from. */
export interface MailServerNamed {
  readonly host: string
  readonly fromAddress: string
}

/**
 * Writes the change into every tenant on the instance, one transaction each,
 * before the change itself is saved: should the save fail after this, the
 * log says too much rather than too little. A tenant that fails stops the
 * rest and throws, and nothing is saved.
 */
export async function recordMailServerChange(
  database: Database,
  userId: string,
  before: MailServerNamed | null,
  after: MailServerNamed | null,
): Promise<void> {
  for (const tenant of await listInstanceTenants(database, userId)) {
    const tenantId = tenant.id as TenantId

    await database.forTenant({ tenantId, userId, reason: 'instance.mail-server' }, (tx) =>
      tx.insert(accountMailServerChanges).values({
        tenantId,
        hostBefore: before?.host ?? null,
        fromBefore: before?.fromAddress ?? null,
        hostAfter: after?.host ?? null,
        fromAfter: after?.fromAddress ?? null,
      }),
    )
  }
}

/**
 * Tells whoever leads a tenant on the instance, each once however many they
 * lead, through the connection of before. A refused address keeps none of the
 * others from being told; what went wrong is written to the log of the
 * process and to nobody else.
 */
export async function tellWhoLeads(
  database: Database,
  mail: MailContext,
  messages: AccountMessages,
  previous: MailConnection | null,
  after: MailServerNamed | null,
  userId: string,
): Promise<void> {
  if (previous?.state !== 'ready') {
    return
  }

  const people = new Map<string, { readonly name: string; readonly email: string }>()

  for (const tenant of await listInstanceTenants(database, userId)) {
    for (const lead of tenant.leads) {
      people.set(lead.email.toLowerCase(), lead)
    }
  }

  if (people.size === 0) {
    return
  }

  const changedAt = new Date()
  const transport = mail.connect(previous.configuration)

  try {
    for (const person of people.values()) {
      const text = messages.mailServerChanged({
        name: person.name,
        host: after?.host ?? null,
        fromAddress: after?.fromAddress ?? null,
        changedAt,
        link: mail.origin,
      })

      try {
        await transport.send({
          from: { name: messages.senderName, address: previous.configuration.from },
          replyTo: null,
          to: { name: person.name || null, address: person.email },
          subject: text.subject,
          text: text.body,
          attachments: [],
        })
      } catch (error) {
        console.error(
          'Die Nachricht über den geänderten Mailserver der Instanz ging an eine Adresse nicht hinaus.',
          error,
        )
      }
    }
  } finally {
    transport.close()
  }
}
