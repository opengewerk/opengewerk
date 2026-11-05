import { type IsoDate } from '@opengewerk/platform-domain'

import {
  type ErasureRequestChannel,
  erasureRequestChannelPhrase,
  erasureRequestChannels,
} from './customer-erasure.js'
import type { AccessRequestId } from './identifier.js'
import { type PersonalSubject, personalSubjects } from './personal-data.js'

/**
 * A request for access (#318, Art. 15 and 20 DSGVO): a customer, a contact,
 * a lead or somebody of the staff asks what the business holds about them.
 * The answer is due a month after it came in (Art. 12 (3) DSGVO), and it is
 * one ZIP: a PDF to read, the same data as JSON to carry over, and the files
 * the business keeps of the person.
 *
 * Decided by Moritz on 05.11.2026: the ZIP holds all three; access is given
 * only to a request recorded with the day it came in, so that nobody draws
 * everything about somebody quietly; the month is not extended (Art. 12 (3)
 * sentence 2). Decided before: the names of the staff stay in the answer to a
 * customer, the data of other customers do not, and the screen reminds the
 * business to check who is asking.
 */

export const accessRequestStatuses = ['open', 'answered'] as const

export type AccessRequestStatus = (typeof accessRequestStatuses)[number]

export const accessRequestStatusLabel: Readonly<Record<AccessRequestStatus, string>> = {
  open: 'Offen',
  answered: 'Beantwortet',
}

/** What a person is to the business, as the list and the search name it. */
export const accessSubjectLabel: Readonly<Record<PersonalSubject, string>> = {
  customer: 'Kunde',
  contact: 'Ansprechpartner',
  prospect: 'Lead',
  person: 'Mitarbeiter',
}

/** How many months an answered request stays in the list. */
export const answeredShownMonths = 12

export interface AccessRequest {
  readonly id: AccessRequestId
  readonly subject: PersonalSubject
  /**
   * The customer, contact, lead or file the request is about; null once a
   * lead went under the deletion concept, when the request stays without
   * whom it was about.
   */
  readonly subjectId: string | null
  readonly receivedOn: IsoDate
  readonly channel: ErasureRequestChannel
  readonly status: AccessRequestStatus
  /** A month after it came in (Art. 12 (3) DSGVO). */
  readonly answerDueOn: IsoDate
  /** When the ZIP was last made, and by whom; null before the first. */
  readonly producedAt: string | null
  readonly producedBy: string | null
  readonly answeredAt: string | null
  /** Who recorded it. */
  readonly createdBy: string
  readonly createdAt: string
}

/** A request as the office reads it, with whom it is about. */
export interface AccessRequestView {
  readonly request: AccessRequest
  /** The name of the person, or null once it is gone. */
  readonly name: string | null
  /** What the person is to the business, "Ansprechpartner bei Hausverwaltung Nord". */
  readonly detail: string
}

/** A person the office can record a request for, as the search finds them. */
export interface AccessSubjectHit {
  readonly subject: PersonalSubject
  readonly id: string
  readonly name: string
  /** What tells two of the same name apart: kind, place, last contact. */
  readonly detail: string
}

/** What the office sends to record a request. */
export interface AccessRequestInput {
  readonly subject: PersonalSubject
  readonly subjectId: string
  readonly receivedOn: IsoDate
  readonly channel: ErasureRequestChannel
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Why a request cannot be recorded as sent, or null. */
export function accessRequestProblem(body: unknown, today: IsoDate): string | null {
  const { subject, subjectId, receivedOn, channel } =
    typeof body === 'object' && body !== null
      ? (body as {
          subject?: unknown
          subjectId?: unknown
          receivedOn?: unknown
          channel?: unknown
        })
      : {}

  if (
    typeof subject !== 'string' ||
    !(personalSubjects as readonly string[]).includes(subject) ||
    typeof subjectId !== 'string' ||
    !uuid.test(subjectId)
  ) {
    return 'Wer die Auskunft möchte, ist niemand aus der Liste.'
  }

  if (
    typeof receivedOn !== 'string' ||
    !isoDay.test(receivedOn) ||
    Number.isNaN(Date.parse(`${receivedOn}T00:00:00Z`)) ||
    new Date(`${receivedOn}T00:00:00Z`).toISOString().slice(0, 10) !== receivedOn
  ) {
    return 'Wann die Anfrage einging, ist kein Tag.'
  }

  if (receivedOn > today) {
    return 'Eine Anfrage geht nicht in der Zukunft ein.'
  }

  if (
    typeof channel !== 'string' ||
    !(erasureRequestChannels as readonly string[]).includes(channel)
  ) {
    return 'Wie die Anfrage einging, ist keiner der Wege.'
  }

  return null
}

/** "05.11.2026" */
export function accessDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** What names the deadline of a request, without the name of the person: "Auskunftsanfrage vom 02.11.2026". */
export function accessRequestLabel(receivedOn: IsoDate): string {
  return `Auskunftsanfrage vom ${accessDay(receivedOn)}`
}

/** When and how a request came in: "Eingegangen am 02.11.2026 per E-Mail". */
export function accessRequestSentence(
  request: Pick<AccessRequest, 'receivedOn' | 'channel'>,
): string {
  return `Eingegangen am ${accessDay(request.receivedOn)} ${erasureRequestChannelPhrase[request.channel]}`
}

/**
 * The name of the ZIP, "Auskunft Martina Seidel 2026-11-05.zip": only
 * letters, digits, spaces, dots and dashes, so that every system keeps it.
 */
export function accessFileName(name: string, day: IsoDate): string {
  const safe = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} .-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

  return `Auskunft ${safe === '' ? 'Person' : safe} ${day}.zip`
}

/**
 * Why the business processes the data of each kind of person, and on which
 * ground (Art. 15 (1) a, Art. 13 (1) c DSGVO). Written for the person asking,
 * addressed with "Sie".
 */
export const accessPurposes: Readonly<Record<PersonalSubject, string>> = {
  customer:
    'Der Betrieb verarbeitet Ihre Daten, um Ihre Aufträge anzubahnen, auszuführen und abzurechnen und um Gewährleistung und Wartung zu erfüllen (Art. 6 Abs. 1 Buchst. b DSGVO), und weil Gesetze verlangen, Rechnungen und Geschäftsbriefe aufzubewahren (Art. 6 Abs. 1 Buchst. c DSGVO mit § 147 AO und § 257 HGB).',
  contact:
    'Der Betrieb verarbeitet Ihre Daten, um mit Ihnen über die Aufträge des Kunden zu sprechen, für den Sie Ansprechpartner sind (Art. 6 Abs. 1 Buchst. f DSGVO; das berechtigte Interesse ist, diese Aufträge abzuwickeln).',
  prospect:
    'Der Betrieb verarbeitet Ihre Daten, um Ihre Anfrage zu beantworten und Ihnen ein Angebot zu machen (Art. 6 Abs. 1 Buchst. b DSGVO).',
  person:
    'Der Betrieb verarbeitet Ihre Daten für Ihr Beschäftigungsverhältnis: um Einsätze zu planen, Arbeitszeiten und Urlaub zu erfassen, den Lohn abzurechnen und Qualifikationen nachzuhalten (Art. 6 Abs. 1 Buchst. b DSGVO), und weil Gesetze verlangen, Arbeitszeiten und Lohnunterlagen aufzubewahren (Art. 6 Abs. 1 Buchst. c DSGVO mit § 147 AO, § 17 MiLoG und § 16 ArbZG). Standorte aus der Zeiterfassung nur mit Ihrer Einwilligung (Art. 6 Abs. 1 Buchst. a DSGVO), von einer Krankheit nur ihre Dauer (Art. 9 Abs. 2 Buchst. b DSGVO).',
}

/** How long the data stay (Art. 15 (1) d DSGVO), after the deletion concept of the business. */
export const accessStorage: Readonly<Record<PersonalSubject, string>> = {
  customer:
    'Rechnungen acht Jahre, Angebote und andere Geschäftsbriefe sechs Jahre, jeweils ab dem Ende des Jahres (§ 147 AO, § 257 HGB). Objekt, Anlagen und Prüfprotokolle bleiben ohne Ihre Daten bis zehn Jahre nach dem letzten Protokoll (§ 199 Abs. 3 BGB). Alles andere geht, wenn mit Ihnen nichts mehr läuft und lange kein Kontakt war, oder auf Ihre Bitte.',
  contact:
    'Ihre Daten bleiben, solange der Betrieb den Kunden führt, für den Sie Ansprechpartner sind, und gehen mit ihm.',
  prospect:
    'Wird aus Ihrer Anfrage kein Auftrag, gehen Ihre Daten eine Zeit nach dem letzten Kontakt, die der Betrieb festlegt; vorgegeben sind zwölf Monate.',
  person:
    'Eine Krankheit geht zwölf Monate nach ihrem letzten Tag; Arbeitszeiten, Rufbereitschaft und Urlaub eines Jahres gehen sechs Jahre nach dessen Ende (§ 147 AO, § 41 EStG); die Akte geht drei Jahre nach dem Ende des Jahres, in dem Sie ausgetreten sind (§ 195, § 199 BGB).',
}

/**
 * Who got data (Art. 15 (1) c DSGVO), as far as the application knows: the
 * grid operators an installation of the person is registered with, and the
 * mails sent. What the business hands on outside of it, it says itself.
 */
export function accessRecipients(gridOperators: readonly string[], mails: number): string {
  const operators =
    gridOperators.length === 0
      ? ''
      : `Daten bekommen ${gridOperators.length === 1 ? 'hat der Netzbetreiber' : 'haben die Netzbetreiber'} ${gridOperators.join(', ')}, bei ${gridOperators.length === 1 ? 'dem' : 'denen'} eine Anlage angemeldet ist. `
  const sent = mails === 0 ? '' : 'Die E-Mails, die an Sie gingen, stehen unter „E-Mails“. '

  return `${operators}${sent}Was der Betrieb außerhalb dieser Anwendung weitergibt, etwa an seine Steuerberatung, nennt er Ihnen selbst.`
}

/** The rights of the person (Art. 15 (1) e and f DSGVO). */
export const accessRightsText =
  'Sie können verlangen, dass falsche Daten berichtigt (Art. 16), Daten gelöscht (Art. 17) oder ihre Verarbeitung eingeschränkt wird (Art. 18), und der Verarbeitung widersprechen (Art. 21). Eine Einwilligung können Sie jederzeit widerrufen (Art. 7 Abs. 3). Beschweren können Sie sich bei einer Aufsichtsbehörde für den Datenschutz, etwa der Ihres Wohnorts (Art. 77 DSGVO).'

/** Where the data come from, and that nothing is decided by a machine (Art. 15 (1) g and h DSGVO). */
export const accessSource: Readonly<Record<PersonalSubject, string>> = {
  customer:
    'Die Daten stammen von Ihnen selbst und aus der Arbeit des Betriebs für Sie, soweit nicht anders vermerkt. Eine automatisierte Entscheidung nach Art. 22 DSGVO trifft der Betrieb nicht.',
  contact:
    'Die Daten stammen von Ihnen selbst oder von dem Kunden, für den Sie Ansprechpartner sind. Eine automatisierte Entscheidung nach Art. 22 DSGVO trifft der Betrieb nicht.',
  prospect:
    'Die Daten stammen von Ihnen selbst, aus Ihrer Anfrage. Eine automatisierte Entscheidung nach Art. 22 DSGVO trifft der Betrieb nicht.',
  person:
    'Die Daten stammen von Ihnen selbst und aus Ihrer Arbeit im Betrieb. Eine automatisierte Entscheidung nach Art. 22 DSGVO trifft der Betrieb nicht.',
}

/** The kind of the person as it can be checked from outside. */
export function isPersonalSubject(value: unknown): value is PersonalSubject {
  return typeof value === 'string' && (personalSubjects as readonly string[]).includes(value)
}
