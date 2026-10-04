import type { TenantId } from '@opengewerk/domain'
import type { Database, PasswordResetMail } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { type MailContext } from '@opengewerk/platform-server'

import { memberships, tenants } from '../database/schema/index.js'
import { passwordResetMessage } from '../notifications/templates.js'
import { mayMailAccounts } from './account-mail.js'
import { connectionOf } from './server-settings.js'

/**
 * The mail with the link to a new password (#126), the way this application
 * sends what the authentication only says is due.
 *
 * An account belongs to the instance and to no business, but every mail
 * server belongs to a business: each sets up its own under
 * "E-Mail-Einstellungen". So the link goes through the mail server of a
 * business the account works in and is not blocked in, the one it joined
 * first that sends mail at all. An account in no such business gets no mail;
 * the way back is then the owner, or `reset-password` on the command line.
 *
 * Sent straight away and not through the outbox, unlike every other message.
 * The outbox is a table, and a link that works would stand in it, and in the
 * audit log of it, until it went out; the invitation avoids that by making its
 * token only when the message leaves, which a link from better-auth cannot.
 * If the mail server does not answer, nothing waits: the person asks again.
 *
 * Never awaited by the route. A request for an address that exists would
 * otherwise take as long as a mail server takes, and one for an address that
 * does not would not, and the difference would say which addresses have an
 * account here.
 *
 * Only on an instance with one business (`mayMailAccounts`): with a second,
 * its lead could have the link sent through a mail server of their own.
 */
export function passwordResetMails(database: Database, mail: MailContext): PasswordResetMail {
  return async (requester, token) => {
    if (!(await mayMailAccounts(database))) {
      return
    }

    const businesses = await database.forInstance(
      (tx) =>
        tx
          .select({ tenantId: memberships.tenantId, name: tenants.name })
          .from(memberships)
          .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
          .where(and(eq(memberships.userId, requester.id), isNull(memberships.blockedAt)))
          .orderBy(asc(memberships.createdAt)),
      requester.id,
    )

    for (const business of businesses) {
      const connection = await connectionOf(database, business.tenantId as TenantId, mail.key)

      if (connection?.state !== 'ready') {
        continue
      }

      const transport = mail.connect(connection.configuration)

      try {
        const message = passwordResetMessage({
          name: requester.name,
          link: `${mail.origin}/passwort/${token}`,
          business: business.name,
        })

        await transport.send({
          from: { name: business.name, address: connection.configuration.from },
          replyTo: null,
          to: { name: requester.name || null, address: requester.email },
          subject: message.subject,
          text: message.body,
          attachments: [],
        })
      } finally {
        transport.close()
      }

      return
    }
  }
}
