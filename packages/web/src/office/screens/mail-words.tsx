import {
  type IssuerContent,
  renderSignature,
  signaturePlaceholders,
  unknownPlaceholders,
} from '@opengewerk/domain'
import {
  type MailServerWords,
  type MailStatusWords,
  SignaturePreviews,
} from '@opengewerk/platform-web/office'
import { accountQuery } from '@opengewerk/platform-web/session'
import { useQuery } from '@tanstack/react-query'

import { letterhead, type LetterheadView } from '../../session/letterhead.js'

/**
 * What this application says where the foundation draws the mail server of a
 * business (ADR 0010, opengewerk-haustechnik#126): what goes out through it,
 * that the name of the sender is the one of the letterhead, and a signature
 * with the two placeholders `{benutzer}` and `{briefkopf}`.
 */

/**
 * The business as the letterhead has it, for the preview of `{briefkopf}`:
 * everything the signature prints, the register and who represents the
 * business included (#278). The tax number and the bank stay out, as they
 * stay out of every mail.
 */
function issuerOf(view: LetterheadView): IssuerContent {
  return {
    name: view.companyName ?? view.businessName,
    street: view.street,
    houseNumber: view.houseNumber,
    postalCode: view.postalCode,
    city: view.city,
    country: view.country ?? 'DE',
    phone: view.phone,
    email: view.email,
    website: view.website,
    taxNumber: null,
    vatId: view.vatId,
    iban: null,
    bic: null,
    bankName: null,
    registerCourt: view.registerCourt,
    registerNumber: view.registerNumber,
    managingDirectors: view.managingDirectors,
    logo: null,
  }
}

/** How the signature reads under a message somebody sent, and under one that went by itself. */
function SignatureCases({ template }: { readonly template: string | null }) {
  const account = useQuery(accountQuery)
  const head = useQuery({ queryKey: ['letterhead'], queryFn: letterhead })

  if (!head.data) {
    return null
  }

  const issuer = issuerOf(head.data)

  return (
    <SignaturePreviews
      cases={[
        {
          title: 'Von Ihnen verschickt',
          text: renderSignature(template, { issuer, sender: account.data?.name || 'Ihr Name' }),
        },
        {
          title: 'Automatisch verschickt',
          text: renderSignature(template, { issuer, sender: null }),
        },
      ]}
    />
  )
}

export const mailServerWords: MailServerWords = {
  what:
    'Über diesen Mailserver verschickt OpenGewerk alle E-Mails des Betriebs: Belege an Kunden, ' +
    'Einladungen neuer Zugänge und fällige Aufgaben.',
  senderName: 'Der Name davor kommt aus dem Briefkopf.',
  signature: {
    placeholder: 'Viele Grüße\n{benutzer}\n\n{briefkopf}',
    hint:
      'Steht unter jeder E-Mail. {benutzer} ist der Name dessen, der die E-Mail ' +
      'verschickt; bei automatischen E-Mails fällt die Zeile weg. {briefkopf} ist der ' +
      'Briefkopf. Leer lassen für den Briefkopf allein.',
    problem: (template) => {
      const unknown = unknownPlaceholders(template)

      return unknown.length > 0
        ? `Unbekannt: ${unknown.join(', ')}. Möglich sind ${signaturePlaceholders.join(' und ')}.`
        : undefined
    },
    Previews: SignatureCases,
  },
}

export const mailStatusWords: MailStatusWords = {
  set: (from) =>
    `Eingerichtet. Dieser Betrieb verschickt von ${from}; als Absender steht der Name aus dem ` +
    'Briefkopf davor. Den Mailserver richtet der Inhaber hier ein.',
  missing:
    'Nicht eingerichtet, dieser Betrieb verschickt deshalb keine E-Mails. Den Mailserver ' +
    'richtet der Inhaber hier ein.',
}
