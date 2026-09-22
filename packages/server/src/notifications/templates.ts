import {
  type DocumentContent,
  type DocumentKind,
  type IssuerContent,
  isInvoice,
  showsPrices,
} from '@opengewerk/domain'

import { documentTitle } from '../documents/template.js'

/** A message as it is written into the outbox: what it says, not how it travels. */
export interface MessageText {
  readonly subject: string
  readonly body: string
}

/** "22.09.2026", the way a date is written in a letter. */
function germanDate(day: string): string {
  const [year, month, date] = day.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/**
 * Every template ends with the signature of the business, handed in finished.
 *
 * That is what the issue means by the data of the business at the head of
 * every message: whoever reads a message from OpenGewerk learns who sent it
 * and how to answer, and not only that a piece of software did. Which lines
 * it has is the business's to write under "E-Mail", with the letterhead as the
 * default; `renderSignature` in `domain` puts it together, so that the screen
 * shows the same thing the customer gets.
 */

/** What a task due today is about, gathered by the caller. */
export interface DueTask {
  readonly title: string
  readonly notes: string | null
  readonly dueOn: string
  readonly customer: string | null
  readonly site: string | null
  readonly job: string | null
}

/**
 * The morning note to whoever is responsible for a task due today.
 *
 * Plain text and short: what, where it belongs, and the way to the list. The
 * task itself is the message; everything it hangs on is named so that the
 * reader knows which customer it is about before opening anything.
 */
export function taskDueMessage(facts: {
  readonly task: DueTask
  readonly recipientName: string | null
  readonly issuer: IssuerContent
  /** Where the instance is reached, for the link to the list. */
  readonly origin: string
  readonly signature: string
}): MessageText {
  const { task } = facts
  const hangsOn = [
    task.customer ? `Kunde: ${task.customer}` : null,
    task.site ? `Objekt: ${task.site}` : null,
    task.job ? `Auftrag: ${task.job}` : null,
  ].filter((line): line is string => line !== null)

  const body = [
    facts.recipientName ? `Hallo ${facts.recipientName},` : 'Hallo,',
    '',
    `heute, am ${germanDate(task.dueOn)}, ist diese Aufgabe fällig:`,
    '',
    task.title,
    ...(task.notes ? ['', task.notes] : []),
    ...(hangsOn.length > 0 ? ['', ...hangsOn] : []),
    '',
    `Alle Aufgaben: ${facts.origin}/aufgaben`,
    '',
    '-- ',
    facts.signature,
  ].join('\n')

  return { subject: `Heute fällig: ${task.title}`, body }
}

/** A document as the object of a sentence: "erhalten Sie die Schlussrechnung". */
const asObject: Readonly<Record<DocumentKind, string>> = {
  cost_estimate: 'den Kostenvoranschlag',
  quote: 'das Angebot',
  order_confirmation: 'die Auftragsbestätigung',
  delivery_note: 'den Lieferschein',
  time_and_material_report: 'den Regiebericht',
  progress_invoice: 'die Abschlagsrechnung',
  partial_invoice: 'die Teilrechnung',
  final_invoice: 'die Schlussrechnung',
  credit_note: 'die Gutschrift',
  cancellation_invoice: 'die Stornorechnung',
  recurring_invoice: 'die Dauerrechnung',
}

const euros = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

/** Which file goes along, as the office chose it when the message was written. */
export type DocumentAttachment = 'pdf' | 'zugferd' | 'xrechnung'

/**
 * The message a document goes to its customer with.
 *
 * Short, because the document is the letter: which one it is, from when and
 * over how much, and for an e-invoice one sentence on what the customer is
 * holding. The amount is what the customer is asked to pay, the one at the
 * bottom of the invoice after what earlier invoices took off; a report and a
 * delivery note carry no prices, and a cancellation says in the document why
 * its amount is negative, which a sentence here could only muddle.
 */
export function documentMessage(facts: {
  readonly content: DocumentContent
  readonly attachment: DocumentAttachment
  readonly issuer: IssuerContent
  readonly signature: string
}): MessageText {
  const { content } = facts
  const number = content.number ?? ''
  const amount =
    showsPrices(content.kind) && content.kind !== 'cancellation_invoice'
      ? ` über ${euros.format(
          (isInvoice(content.kind) ? content.billed.grossCents : content.totals.grossCents) / 100,
        )}`
      : ''

  const electronic =
    facts.attachment === 'zugferd'
      ? [
          '',
          'Sie ist eine E-Rechnung im Format ZUGFeRD: die Rechnungsdaten stecken als XML im PDF ' +
            'und lassen sich ohne Abtippen übernehmen.',
        ]
      : facts.attachment === 'xrechnung'
        ? ['', 'Sie ist eine E-Rechnung im Format XRechnung.']
        : []

  const body = [
    'Guten Tag,',
    '',
    `im Anhang erhalten Sie ${asObject[content.kind]} ${number} vom ` +
      `${germanDate(content.documentDate)}${amount}.`,
    ...electronic,
    '',
    'Mit freundlichen Grüßen',
    '',
    '-- ',
    facts.signature,
  ].join('\n')

  return {
    subject: `${documentTitle(content.kind)} ${number} von ${facts.issuer.name}`,
    body,
  }
}

/**
 * The message a report goes to its customer with, right after the signature.
 *
 * It has no number yet when it is signed; the office gives it one later, and
 * the invoice made out of it names that. So the report is named by its day,
 * and the sentence says what the customer did with it, which is why it comes.
 */
export function signedReportMessage(facts: {
  readonly content: DocumentContent
  readonly signedOn: string
  readonly issuer: IssuerContent
  readonly signature: string
}): MessageText {
  const { content } = facts
  const named = content.number
    ? `${documentTitle(content.kind)} ${content.number}`
    : `${documentTitle(content.kind)} vom ${germanDate(content.documentDate)}`

  const body = [
    'Guten Tag,',
    '',
    `im Anhang erhalten Sie ${asObject[content.kind]} vom ${germanDate(content.documentDate)}, ` +
      `den Sie am ${germanDate(facts.signedOn)} unterschrieben haben.`,
    '',
    'Mit freundlichen Grüßen',
    '',
    '-- ',
    facts.signature,
  ].join('\n')

  return { subject: `${named} von ${facts.issuer.name}`, body }
}

/**
 * Where the link of an invitation goes in its message.
 *
 * The message is written with this in place of the link, and the job puts the
 * link in when it sends: the token is made at that moment and exists in the
 * outgoing mail only. A row in the outbox, and the entries the audit log keeps
 * of it, never hold a way into the business.
 */
export const invitationLink = '{{link}}'

/**
 * The message a new colleague is invited with.
 *
 * Who invites them to what, the link, and the two things a one time link
 * comes with: it works once and not after its day. And one sentence for the
 * address that got it by mistake, which is the one person who can do nothing
 * else with it.
 */
export function invitationMessage(facts: {
  readonly name: string
  readonly inviter: string | null
  readonly expiresAt: Date
  readonly issuer: IssuerContent
  readonly signature: string
}): MessageText {
  const until = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(facts.expiresAt)

  const body = [
    `Hallo ${facts.name},`,
    '',
    `${facts.inviter ?? 'Jemand'} hat Sie eingeladen, bei ${facts.issuer.name} mit OpenGewerk ` +
      'zu arbeiten. Über diesen Link legen Sie Ihr Passwort fest und sind danach angemeldet:',
    '',
    invitationLink,
    '',
    `Der Link gilt bis zum ${until} und funktioniert genau einmal. Wenn Sie mit dieser ` +
      'Einladung nichts anfangen können, ignorieren Sie sie einfach.',
    '',
    '-- ',
    facts.signature,
  ].join('\n')

  return { subject: `Einladung zu OpenGewerk von ${facts.issuer.name}`, body }
}
