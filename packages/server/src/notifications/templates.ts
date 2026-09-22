import type { IssuerContent } from '@opengewerk/domain'

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
 * The business at the foot of a message, the way its letterhead has it.
 *
 * Every template ends with it, which is what the issue means by the data of
 * the business at the head of every message: whoever reads a message from
 * OpenGewerk learns who sent it and how to answer, and not only that a piece
 * of software did.
 */
export function signatureOf(issuer: IssuerContent): string {
  const street = [issuer.street, issuer.houseNumber].filter(Boolean).join(' ')
  const town = [issuer.postalCode, issuer.city].filter(Boolean).join(' ')

  return [
    issuer.name,
    street || null,
    town || null,
    issuer.phone ? `Telefon ${issuer.phone}` : null,
    issuer.email,
    issuer.website,
  ]
    .filter((line): line is string => line !== null && line.length > 0)
    .join('\n')
}

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
    signatureOf(facts.issuer),
  ].join('\n')

  return { subject: `Heute fällig: ${task.title}`, body }
}
