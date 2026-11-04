import { addDays, addMonths, type IsoDate, type RuleSet } from '@opengewerk/platform-domain'

import type { DocumentKind, DocumentStatus } from './document.js'
import type { CustomerId, ErasureRequestId } from './identifier.js'
import { type RetentionKind, retentionOf } from './retention.js'

/**
 * When a customer may go under the deletion concept (#845, Feature-Gliederung
 * section 2): once nothing runs with it any more, and then either after the months
 * the business set without contact, or at once when it asked to be deleted
 * (Art. 17 DSGVO). Decided by Moritz on 04.11.2026: nothing runs means no
 * document still to be kept, no warranty, no open job and no maintenance
 * contract still running, and the months are three years by default
 * (section 195 BGB) and the business's to set.
 */

/**
 * What still holds a customer.
 *
 * - `open_job`: a job of it is a draft or active.
 * - `running_contract`: a maintenance contract of it has not ended.
 * - `retention`: a document of it has to be kept (#317, the package
 *   `retention`), until the last day of the longest.
 * - `warranty`: the warranty of a job of it runs (#310), until its last day.
 *
 * The first two hold it for as long as they last, which nobody knows; the
 * other two until a day.
 */
export const customerHoldKinds = ['open_job', 'running_contract', 'retention', 'warranty'] as const

export type CustomerHoldKind = (typeof customerHoldKinds)[number]

export interface CustomerHold {
  readonly kind: CustomerHoldKind
  /** The last day it holds, or null for one that holds until it ends. */
  readonly until: IsoDate | null
}

/** What `customerHolds` reads of a customer. */
export interface CustomerFacts {
  readonly documents: readonly {
    readonly kind: DocumentKind
    readonly status: DocumentStatus
    readonly documentDate: IsoDate
  }[]
  /** The last day of each warranty that runs from an acceptance of its jobs. */
  readonly warrantiesEndOn: readonly IsoDate[]
  readonly openJobs: number
  readonly runningContracts: number
}

const invoices: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'progress_invoice',
  'partial_invoice',
  'final_invoice',
  'credit_note',
  'cancellation_invoice',
  'recurring_invoice',
])

/**
 * The kind of paper a document is for its retention, or null for one that
 * is kept for no one: a draft never left the business. Every invoice,
 * credit note and cancellation is a booking voucher (section 147 (1) no. 4
 * AO, section 14b UStG); every other document that was issued or signed is
 * a business letter sent (section 147 (1) no. 3 AO, section 257 (1) no. 3
 * HGB). A cancelled document was issued and is kept as what it was.
 */
export function documentRetentionKind(
  kind: DocumentKind,
  status: DocumentStatus,
): RetentionKind | null {
  if (status === 'draft') {
    return null
  }

  return invoices.has(kind) ? 'booking_vouchers' : 'business_letters'
}

function latest(days: readonly IsoDate[]): IsoDate | null {
  return days.reduce<IsoDate | null>(
    (last, day) => (last === null || day > last ? day : last),
    null,
  )
}

/**
 * What holds a customer today, one of each kind at most: a retention or a
 * warranty only while its last day is today or later. Counted from the
 * document's date, the day it came about.
 */
export function customerHolds(
  facts: CustomerFacts,
  today: IsoDate,
  rules: RuleSet,
): CustomerHold[] {
  const holds: CustomerHold[] = []

  if (facts.openJobs > 0) {
    holds.push({ kind: 'open_job', until: null })
  }

  if (facts.runningContracts > 0) {
    holds.push({ kind: 'running_contract', until: null })
  }

  const kept = latest(
    facts.documents.flatMap((document) => {
      const kind = documentRetentionKind(document.kind, document.status)

      return kind === null ? [] : [retentionOf(kind, document.documentDate, today, rules).lastDay]
    }),
  )

  if (kept !== null && kept >= today) {
    holds.push({ kind: 'retention', until: kept })
  }

  const warranty = latest(facts.warrantiesEndOn)

  if (warranty !== null && warranty >= today) {
    holds.push({ kind: 'warranty', until: warranty })
  }

  return holds
}

/**
 * The day a customer falls due for deletion, or null while a job or a
 * contract runs, which ends on no known day. The later of: the months
 * without contact (or the day it asked, which waives them) and the day after
 * the last hold.
 */
export function customerErasureDueOn(input: {
  readonly holds: readonly CustomerHold[]
  readonly lastContactOn: IsoDate
  readonly contactMonths: number
  readonly requestedOn: IsoDate | null
}): IsoDate | null {
  if (input.holds.some((hold) => hold.until === null)) {
    return null
  }

  const free = input.requestedOn ?? addMonths(input.lastContactOn, input.contactMonths)
  const held = latest(input.holds.flatMap((hold) => (hold.until === null ? [] : [hold.until])))
  const after = held === null ? null : addDays(held, 1)

  return after !== null && after > free ? after : free
}

function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** A hold as the office reads it. */
export function customerHoldSentence(hold: CustomerHold): string {
  switch (hold.kind) {
    case 'open_job':
      return 'Ein Auftrag ist noch offen.'
    case 'running_contract':
      return 'Ein Wartungsvertrag läuft noch.'
    case 'retention':
      return `Belege sind bis ${germanDay(hold.until as IsoDate)} aufzubewahren.`
    case 'warranty':
      return `Die Gewährleistung läuft bis ${germanDay(hold.until as IsoDate)}.`
  }
}

/**
 * A request for deletion (Art. 17 DSGVO) from the request to its end (#845):
 * open until the business answers, restricted while a document or a warranty
 * still holds the customer (Art. 18), erased once the customer went.
 */
export const erasureRequestStatuses = ['open', 'restricted', 'erased'] as const

export type ErasureRequestStatus = (typeof erasureRequestStatuses)[number]

export const erasureRequestStatusLabel: Readonly<Record<ErasureRequestStatus, string>> = {
  open: 'Offen',
  restricted: 'Gesperrt',
  erased: 'Erledigt',
}

/** How the request came in. */
export const erasureRequestChannels = ['letter', 'email', 'phone', 'in_person', 'other'] as const

export type ErasureRequestChannel = (typeof erasureRequestChannels)[number]

export const erasureRequestChannelLabel: Readonly<Record<ErasureRequestChannel, string>> = {
  letter: 'Brief',
  email: 'E-Mail',
  phone: 'Telefon',
  in_person: 'Persönlich',
  other: 'Anders',
}

/** How the request came in, within a sentence: "Löschanfrage vom 01.11.2026 per E-Mail". */
export const erasureRequestChannelPhrase: Readonly<Record<ErasureRequestChannel, string>> = {
  letter: 'per Brief',
  email: 'per E-Mail',
  phone: 'am Telefon',
  in_person: 'persönlich',
  other: 'auf anderem Weg',
}

/** A request as the file of its customer heads it: "Löschanfrage vom 01.11.2026 per E-Mail". */
export function erasureRequestTitle(
  request: Pick<ErasureRequest, 'receivedOn' | 'channel'>,
): string {
  return `Löschanfrage vom ${germanDay(request.receivedOn)} ${erasureRequestChannelPhrase[request.channel]}`
}

/** A request in one sentence, for the office: when and how it came in. */
export function erasureRequestSentence(
  request: Pick<ErasureRequest, 'receivedOn' | 'channel'>,
): string {
  return `Eingegangen am ${germanDay(request.receivedOn)} ${erasureRequestChannelPhrase[request.channel]}`
}

export interface ErasureRequest {
  readonly id: ErasureRequestId
  readonly customerId: CustomerId
  readonly receivedOn: IsoDate
  readonly channel: ErasureRequestChannel
  readonly status: ErasureRequestStatus
  /** The last day of the month the answer is due in (Art. 12 (3) DSGVO). */
  readonly answerDueOn: IsoDate
  readonly restrictedAt: string | null
  readonly erasedAt: string | null
  /** Who recorded it. */
  readonly createdBy: string
  readonly createdAt: string
}

/** A request as the office reads it, with what holds its customer today. */
export interface ErasureRequestView {
  readonly request: ErasureRequest
  /** Who asked, from the customer, for as long as it is there. */
  readonly customerName: string
  readonly holds: readonly CustomerHold[]
  /** How it can be answered today (`erasureRequestAnswer`). */
  readonly answer: 'erase' | 'restrict' | null
  /** The day the customer falls due for deletion, or null while a job or a contract runs. */
  readonly dueOn: IsoDate | null
}

/**
 * The day the answer to a request is due: a month after it came in, the
 * same day of the next month or the last day of that month where it lacks
 * the day (Art. 12 (3) DSGVO, sections 187 (1) and 188 (2), (3) BGB).
 */
export function answerDueOf(receivedOn: IsoDate): IsoDate {
  return addMonths(receivedOn, 1)
}

/**
 * How a request can be answered today: erase once nothing holds the
 * customer, restrict while only a document or a warranty does, neither while
 * a job or a contract runs, which the office ends first.
 */
export function erasureRequestAnswer(holds: readonly CustomerHold[]): 'erase' | 'restrict' | null {
  if (holds.some((hold) => hold.until === null)) {
    return null
  }

  return holds.length === 0 ? 'erase' : 'restrict'
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/

/** Why a recorded request is not one, or null when it is. */
export function erasureRequestProblem(body: unknown, today: IsoDate): string | null {
  const { receivedOn, channel } =
    typeof body === 'object' && body !== null
      ? (body as { receivedOn?: unknown; channel?: unknown })
      : {}

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
