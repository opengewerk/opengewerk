import { signatureMaxLength, unknownPlaceholders } from '@opengewerk/domain'
import { mailServers } from '@opengewerk/platform-server'

import { secretsOfBusinesses } from '../secrets/store.js'
import { giveUpPending } from './outbox.js'

/**
 * The mail servers of the businesses. How one is checked, kept and opened is
 * the foundation's (`mailServers`, ADR 0010); this binds it to the sealed
 * credentials of this application, to its signature with `{benutzer}` and
 * `{briefkopf}`, to its outbox and to the sentences that name a business.
 */
export const mailServersOfBusinesses = mailServers({
  secrets: secretsOfBusinesses,
  purpose: 'smtp_password',
  signatureProblem(signature) {
    const unknown = unknownPlaceholders(signature)

    if (unknown.length > 0) {
      return (
        `In der Signatur steht ${unknown.join(', ')}. Möglich sind {benutzer} für den Namen ` +
        'dessen, der die E-Mail verschickt, und {briefkopf} für den Briefkopf.'
      )
    }

    return signature.length > signatureMaxLength
      ? `Die Signatur ist länger als ${String(signatureMaxLength)} Zeichen.`
      : null
  },
  // Messages still waiting are given up on with the reason rather than left to
  // go out whenever a server is set up again: a reminder for a task that was
  // due three weeks ago is not what somebody switching mail back on wants to
  // send.
  whenRemoved: (tx, now) =>
    giveUpPending(tx, 'Der Mailserver wurde entfernt, bevor die E-Mail hinausging.', now),
  sentences: {
    notConfigured:
      'Für diesen Betrieb ist kein Mailserver eingerichtet, deshalb verschickt er keine ' +
      'E-Mails. Einrichten lässt er sich unter "E-Mail-Einstellungen".',
    noneToRemove: 'Für diesen Betrieb ist kein Mailserver eingerichtet.',
    senderName: 'Der Name davor kommt aus dem Briefkopf.',
  },
})

export const {
  configurationToTry,
  connectionOf,
  mailStatusOf,
  readMailServer,
  removeMailServer,
  requireMailServer,
  sameConnection,
  saveMailServer,
  validMailServer,
} = mailServersOfBusinesses
