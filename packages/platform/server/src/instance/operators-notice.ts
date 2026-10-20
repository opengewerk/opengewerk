import type { Database } from '../database/database.js'
import type { MailContext } from '../mail/context.js'
import type { AccountMessages } from './account-mail.js'
import { instanceMailConnection } from './mail-server.js'
import { listOperators } from './operators.js'

/**
 * What everybody who runs the instance learns when somebody is named to run
 * it or taken off (opengewerk-haustechnik#360).
 *
 * Whoever runs the instance sets up its mail server, and through that server
 * goes the link to a new password of every account. A change of the server
 * takes a confirmation and is told to every tenant (`mail-server-notice.ts`);
 * naming somebody else who could then change it takes a confirmation as well
 * (`instance.controller.ts`), and is told here, by mail to each of them and
 * to the one taken off, so that a name nobody chose does not go unnoticed.
 * The area has it in its log already.
 *
 * Through the mail server of the instance as it is, the one a person named
 * there could change only afterwards. Without one, or while its password no
 * longer opens, nothing goes out, as with every mail to an account.
 */
export async function tellOperators(
  database: Database,
  mail: MailContext,
  messages: AccountMessages,
  change: { readonly appointed: boolean; readonly name: string; readonly email: string },
  userId: string,
): Promise<void> {
  const connection = await instanceMailConnection(database, mail.key)

  if (connection?.state !== 'ready') {
    return
  }

  const people = new Map<string, { readonly name: string; readonly email: string }>()

  for (const operator of await listOperators(database, userId)) {
    people.set(operator.email.toLowerCase(), operator)
  }

  people.set(change.email.toLowerCase(), change)

  const changedAt = new Date()
  const transport = mail.connect(connection.configuration)

  try {
    for (const person of people.values()) {
      const text = messages.operatorsChanged({
        name: person.name,
        appointed: change.appointed,
        person: change.name,
        personEmail: change.email,
        changedAt,
        link: mail.origin,
      })

      try {
        await transport.send({
          from: { name: messages.senderName, address: connection.configuration.from },
          replyTo: null,
          to: { name: person.name || null, address: person.email },
          subject: text.subject,
          text: text.body,
          attachments: [],
        })
      } catch (error) {
        console.error(
          'Die Nachricht über die Verwaltung der Instanz ging an eine Adresse nicht hinaus.',
          error,
        )
      }
    }
  } finally {
    transport.close()
  }
}
