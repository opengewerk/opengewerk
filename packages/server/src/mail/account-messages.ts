import type { AccountMessages } from '@opengewerk/platform-server'

import {
  mailServerChangedMessage,
  passkeyAddedMessage,
  passwordResetMessage,
} from '../notifications/templates.js'

/**
 * What this application says in the mails to an account
 * (opengewerk-haustechnik#81): the link to a new password and the notice of a
 * new passkey, in its words and under its name, and to whoever owns a
 * business when the mail server of the instance changes
 * (opengewerk-haustechnik#360).
 *
 * When they go out, and through what, is the foundation's: through the mail
 * server of the instance, which whoever runs the instance sets up in its
 * settings, and through the mail server of no business. An account belongs
 * to the instance; a business could otherwise read the link to a new password
 * of an account it had taken in. Without that mail server nothing goes out,
 * and the way back into an account is the owner of a business it works in,
 * or `reset-password` on the server.
 */
export const accountMessages: AccountMessages = {
  senderName: 'OpenGewerk',
  accountPath: '/konto',
  passwordReset: passwordResetMessage,
  passkeyAdded: passkeyAddedMessage,
  mailServerChanged: mailServerChangedMessage,
}
