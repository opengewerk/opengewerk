import { berlinWall } from './appointment.js'

/**
 * The confirmation mails to a customer (#315, Feature-Gliederung 3.4, decided
 * on 27.09.2026): about an appointment of their job that is arranged, moved
 * or cancelled, with a calendar file, and about a service call the office
 * took, which for a consumer carries the instructions about the right of
 * withdrawal (#292). Each occasion has a text: a snippet for mails the
 * business wrote for it, or the one shipped here.
 */
export const mailOccasions = [
  'appointment_arranged',
  'appointment_moved',
  'appointment_cancelled',
  'job_received',
  'due_reminder',
] as const

export type MailOccasion = (typeof mailOccasions)[number]

export const mailOccasionLabel: Readonly<Record<MailOccasion, string>> = {
  appointment_arranged: 'Termin vereinbart',
  appointment_moved: 'Termin verschoben',
  appointment_cancelled: 'Termin abgesagt',
  job_received: 'Auftragseingang',
  due_reminder: 'Erinnerung an Prüfung oder Wartung',
}

/** A mail as a snippet holds it: the subject as its title, the text below. */
export interface MailText {
  readonly subject: string
  readonly text: string
}

/** The texts for an occasion the business wrote none for; the board of the canvas, version 127, uses the same words. */
export const shippedMails: Readonly<Record<MailOccasion, MailText>> = {
  appointment_arranged: {
    subject: 'Ihr Termin am {termin}',
    text: 'Guten Tag {kunde},\n\nfür Ihren Auftrag {auftrag} haben wir einen Termin vereinbart: {termin}.\n\nDie Kalenderdatei im Anhang trägt ihn in Ihren Kalender ein.',
  },
  appointment_moved: {
    subject: 'Ihr Termin ist verschoben: {termin}',
    text: 'Guten Tag {kunde},\n\nden Termin für Ihren Auftrag {auftrag} mussten wir verschieben. Neu ist: {termin}.\n\nDie Kalenderdatei im Anhang ersetzt den bisherigen Eintrag in Ihrem Kalender.',
  },
  appointment_cancelled: {
    subject: 'Ihr Termin am {termin} entfällt',
    text: 'Guten Tag {kunde},\n\nder Termin am {termin} für Ihren Auftrag {auftrag} entfällt. Für einen neuen Termin melden wir uns.\n\nDie Kalenderdatei im Anhang nimmt den Eintrag aus Ihrem Kalender.',
  },
  job_received: {
    subject: 'Ihr Auftrag {auftrag}',
    text: 'Guten Tag {kunde},\n\nvielen Dank für Ihren Auftrag. Wir haben ihn unter {auftrag} aufgenommen und melden uns mit einem Termin.',
  },
  due_reminder: {
    subject: 'Fällig am {datum}: {frist}',
    text: 'Guten Tag {kunde},\n\nam {datum} ist fällig: {frist}.\n\nGern vereinbaren wir dafür einen Termin mit Ihnen. Antworten Sie einfach auf diese E-Mail oder rufen Sie uns an.',
  },
}

/**
 * The sentence the confirmation of a service call for a consumer ends with,
 * after the business's text, when the instructions go with it: the text is
 * the business's, the attachment is the law's.
 */
export const instructionsSentence =
  'Im Anhang finden Sie die Widerrufsbelehrung mit dem Muster-Widerrufsformular und den Vordruck, mit dem Sie verlangen können, dass wir vor Ablauf der Widerrufsfrist beginnen.'

/** The placeholders a snippet for mails may hold, in the order the screen explains them. */
export const mailPlaceholders = [
  'kunde',
  'termin',
  'auftrag',
  'frist',
  'datum',
  'benutzer',
  'briefkopf',
] as const

export type MailPlaceholder = (typeof mailPlaceholders)[number]

export const mailPlaceholderLabel: Readonly<Record<MailPlaceholder, string>> = {
  kunde: 'der Name des Kunden',
  termin: 'Tag und Uhrzeit des Termins',
  auftrag: 'Nummer und Bezeichnung des Auftrags',
  frist: 'was fällig ist, etwa die Wiederholungsprüfung einer Anlage',
  datum: 'der Tag, an dem es fällig ist',
  benutzer: 'wer die E-Mail verschickt; bei automatischen E-Mails leer',
  briefkopf: 'der Briefkopf, wie in der Signatur',
}

/** What the placeholders stand for in one mail; null where the mail has none, which fills in as nothing. */
export type MailFacts = Readonly<Record<MailPlaceholder, string | null>>

/**
 * A text with its placeholders filled in. A line that holds a placeholder
 * which stays empty goes, the way the signature drops the line of the user
 * under an automatic mail (`renderSignature`); braces that name no
 * placeholder stay as they are.
 */
export function filledMailText(text: string, facts: MailFacts): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  return lines
    .filter((line) =>
      Array.from(line.matchAll(/\{([a-z]+)\}/g)).every(
        ([, key]) => !(key !== undefined && key in facts && !facts[key as MailPlaceholder]),
      ),
    )
    .map((line) =>
      line.replace(/\{([a-z]+)\}/g, (whole, key: string) =>
        key in facts ? (facts[key as MailPlaceholder] ?? '') : whole,
      ),
    )
    .join('\n')
}

/** A subject with its placeholders filled in, on one line: a letterhead in a subject is a list. */
export function filledMailSubject(subject: string, facts: MailFacts): string {
  return filledMailText(subject, facts)
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ')
}

const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function dayText(day: string): string {
  const weekday = weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? ''

  return `${weekday}, ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

function clockText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/**
 * When an appointment is, as `{termin}` says it, in German time: "Mittwoch,
 * 04.11.2026, 13:30 bis 15:00 Uhr", or with both days when it runs over one.
 */
export function appointmentWhen(startsAt: Date, endsAt: Date): string {
  const start = berlinWall(startsAt)
  const end = berlinWall(endsAt)

  return start.day === end.day
    ? `${dayText(start.day)}, ${clockText(start.minute)} bis ${clockText(end.minute)} Uhr`
    : `${dayText(start.day)}, ${clockText(start.minute)} Uhr bis ${dayText(end.day)}, ${clockText(end.minute)} Uhr`
}

/** The longest subject of a snippet for mails. */
export const longestMailSubject = 200

/**
 * What is wrong with the occasion and subject of a snippet, or null: a
 * snippet for mails names its occasion and has a subject on one line; a
 * snippet for a document has no occasion.
 */
export function mailSnippetProblem(
  purpose: unknown,
  occasion: unknown,
  title: unknown,
): string | null {
  if (purpose !== 'mail') {
    return occasion === null || occasion === undefined
      ? null
      : 'Einen Anlass hat nur ein Textbaustein für E-Mails.'
  }

  if (typeof occasion !== 'string' || !(mailOccasions as readonly string[]).includes(occasion)) {
    return 'Ein Textbaustein für E-Mails braucht seinen Anlass.'
  }

  if (typeof title !== 'string' || title.trim() === '' || /[\r\n]/.test(title)) {
    return 'Der Betreff steht auf einer Zeile.'
  }

  return title.length > longestMailSubject
    ? `Der Betreff hat höchstens ${String(longestMailSubject)} Zeichen.`
    : null
}
