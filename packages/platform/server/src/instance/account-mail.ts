import type { PasskeyNotice, PasswordResetMail } from '../authentication/notices.js'
import type { Database } from '../database/database.js'
import type { MailContext } from '../mail/context.js'
import { instanceMailConnection } from './mail-server.js'

/**
 * The mails to an account (opengewerk-haustechnik#81): the link to a new
 * password and the notice of a new passkey, sent through the mail server of
 * the instance and through no other.
 *
 * An account belongs to the instance. A mail to it that went out through the
 * mail server of a tenant could be read by whoever set that server up, and
 * the link to a new password is the account. So there is one way out, the
 * server whoever runs the instance entered in its settings, and while there
 * is none, or its password no longer opens, nothing is sent: the way back
 * into an account is then whoever leads a tenant it works in, or
 * `reset-password` on the server.
 *
 * Sent straight away and not through an outbox. An outbox is a table, and a
 * link that works would stand in it, and in the log of it, until it went out.
 * If the mail server does not answer, nothing waits: the person asks again.
 *
 * Whoever sets that server up could read the links there, so a change of it
 * takes a confirmation, goes into the log of every tenant and is told to
 * whoever leads one, through the server of before (`mail-server-notice.ts`),
 * and every reset of a password goes into the log of every tenant of the
 * account (`password-resets.ts`) (opengewerk-haustechnik#360).
 */

/**
 * The words of an application for the mails to an account, under the token
 * the area of the instance is handed them by: it tells whoever leads a tenant
 * of a new mail server in them (`mail-server-notice.ts`).
 */
export const ACCOUNT_MESSAGES = Symbol('AccountMessages')

/** A message as an application words it. */
export interface AccountMessageText {
  readonly subject: string
  readonly body: string
}

/**
 * What an application says in the mails to an account. The words are its
 * own, they name it; when and through what they go out is decided here.
 */
export interface AccountMessages {
  /** The name in front of the address the instance writes from: the name of the application. */
  readonly senderName: string
  /** Where somebody signed in sees their passkeys, as a path of the application: "/konto". */
  readonly accountPath: string
  readonly passwordReset: (facts: {
    readonly name: string
    readonly link: string
  }) => AccountMessageText
  readonly passkeyAdded: (facts: {
    readonly name: string
    readonly passkey: string
    readonly addedAt: Date
    readonly link: string
  }) => AccountMessageText
  /**
   * To whoever leads a tenant on the instance, once the mail server of the
   * instance was set up, changed or removed (opengewerk-haustechnik#360). It
   * goes out through the server that was there before, and never through the
   * new one (`mail-server-notice.ts`). `host` and `fromAddress` are the server
   * now, both null where it was removed; `link` is the instance.
   */
  readonly mailServerChanged: (facts: {
    readonly name: string
    readonly host: string | null
    readonly fromAddress: string | null
    readonly changedAt: Date
    readonly link: string
  }) => AccountMessageText
}

/** Where the link to a new password leads, the address the sign in of the foundation reads the token from. */
const passwordResetPath = '/passwort'

/**
 * The two seams of the authentication, bound to the mail server of the
 * instance.
 *
 * The link to a new password is never awaited by the route that asked, and
 * says nothing about whether it went out: a request for an address with an
 * account would otherwise take as long as a mail server takes, and one for
 * an address without would not. The notice of a passkey is awaited, and a
 * mail server that is set up and refuses it takes the passkey back with it:
 * a passkey nobody could be told of does not stay. Without a mail server the
 * notice does nothing and the passkey stays, as on every instance that sends
 * no mail.
 */
export function accountMails(
  database: Database,
  mail: MailContext,
  messages: AccountMessages,
): { readonly passwordResetMail: PasswordResetMail; readonly passkeyNotice: PasskeyNotice } {
  const send = async (
    to: { readonly name: string; readonly email: string },
    text: AccountMessageText,
  ): Promise<void> => {
    const connection = await instanceMailConnection(database, mail.key)

    if (connection?.state !== 'ready') {
      return
    }

    const transport = mail.connect(connection.configuration)

    try {
      await transport.send({
        from: { name: messages.senderName, address: connection.configuration.from },
        replyTo: null,
        to: { name: to.name || null, address: to.email },
        subject: text.subject,
        text: text.body,
        attachments: [],
      })
    } finally {
      transport.close()
    }
  }

  return {
    passwordResetMail: (requester, token) =>
      send(
        requester,
        messages.passwordReset({
          name: requester.name,
          link: `${mail.origin}${passwordResetPath}/${token}`,
        }),
      ),
    passkeyNotice: (owner, passkey) =>
      send(
        owner,
        messages.passkeyAdded({
          name: owner.name,
          passkey: passkey.name,
          addedAt: new Date(),
          link: `${mail.origin}${messages.accountPath}`,
        }),
      ),
  }
}
