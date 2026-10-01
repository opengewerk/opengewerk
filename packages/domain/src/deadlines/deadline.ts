import type { IsoDate, TenantId } from '@opengewerk/platform-domain'
import type {
  CustomerId,
  DeadlineId,
  DocumentId,
  InstallationId,
  JobId,
  SiteId,
  TaskId,
} from '../model/identifier.js'
import { addDays } from '../rules/payment.js'

/**
 * The deadline engine of section 1.2 (#283): one record for everything that
 * falls due, whatever module it comes from.
 *
 * A deadline is never typed in. It follows from a source, an issued quote
 * that nothing has followed yet, the next inspection a protocol names, the
 * acceptance of a job, and it follows that source for as long as it is open:
 * when the source changes, the day changes with it, and when the source is
 * gone or has done what the deadline waited for, the deadline drops out by
 * itself. What a person does with one is marking it done, or giving it a lead
 * or a person of its own.
 *
 * The kinds are data, like the forms and the rules. The core brings the ones
 * that are no trade's business, a trade package brings its own in `fristen/`
 * (ADR 0008), and the registry below puts them together; the core names no
 * kind of any trade.
 */

/**
 * Open until it is done or has dropped out. Done is what a person says, or
 * what follows when the task it made is done; dropped is what the engine says
 * when the source no longer asks for the deadline, and it comes back by itself
 * if the source asks again.
 */
export const deadlineStatuses = ['open', 'done', 'dropped'] as const

export type DeadlineStatus = (typeof deadlineStatuses)[number]

/**
 * What happens once a deadline has come within its lead, the four of section
 * 1.2. Each happens once per due day, however often the engine runs and
 * however long the instance was down before it caught up.
 *
 * - `task`: a task for the responsible person, due on the day the deadline is,
 *   written by nobody (the way in #80 left for this).
 * - `reminder`: a reminder to the responsible person through the
 *   notifications of #81 and #284, by mail when the business has a mail server
 *   and by push to every device where that person has switched it on. The
 *   concept's "Erinnerung (Push/E-Mail)", one action and two channels.
 * - `service_job`: a service job in draft at the customer and site of the
 *   source, for the office to plan.
 * - `status`: a change of state at the source, done by the handler the kind
 *   names in the server.
 */
export const deadlineActions = ['task', 'reminder', 'service_job', 'status'] as const

export type DeadlineAction = (typeof deadlineActions)[number]

/**
 * Where a kind of deadline comes from. Each source is a question the server
 * asks the data of a business, and each is built with the first kind that
 * needs it.
 *
 * - `quote`: an issued quote that no document has followed yet. The day it
 *   was issued is the anchor, and the deadline falls due a number of days
 *   later (3.3, the follow-up of an open quote).
 */
export const deadlineSources = ['quote'] as const

export type DeadlineSource = (typeof deadlineSources)[number]

/**
 * Who answers for a deadline when nobody has said otherwise.
 *
 * - `source`: the person the source names: whoever issued the quote.
 * - `owner`: the owner of the business, the longest in it when there are
 *   several.
 */
export const deadlineResponsibles = ['source', 'owner'] as const

export type DeadlineResponsible = (typeof deadlineResponsibles)[number]

/**
 * A kind of deadline, as it sits in a JSON file of the core or of a trade
 * package.
 */
export interface DeadlineKind {
  /** Stable and unique: `quote.follow_up`, and for a trade `<trade>.<name>`. */
  readonly key: string
  /** The trade package it comes from, or null for the core. */
  readonly trade: string | null
  /** What it is called on screen: "Wiedervorlage eines Angebots". */
  readonly title: string
  /** One sentence under the title in the settings: where it comes from. */
  readonly about: string
  readonly source: DeadlineSource
  /**
   * Days from the anchor of the source to the due day, where the source does
   * not name the day itself: the follow-up of a quote is two weeks after it
   * went out. The business can change it for the kind. Null where the source
   * names the day.
   */
  readonly intervalDays: number | null
  /** How many days before the due day it reminds, until the business says otherwise. */
  readonly leadDays: number
  /** Who answers for it until the business names somebody for the kind. */
  readonly responsible: DeadlineResponsible
  readonly actions: readonly DeadlineAction[]
  /**
   * The title of the task it makes, with `{quelle}` where the source goes:
   * "Angebot {quelle} nachfassen".
   */
  readonly taskTitle: string
  /** Where the interval or the kind comes from, when a law or a norm sets it. */
  readonly reference?: string
}

/** The longest lead accepted, a year, as a guard against a typing error. */
export const longestLeadDays = 365

/** The longest interval accepted for a kind the business can set, also a year. */
export const longestIntervalDays = 365

/** What a lead is wrong about, or null when it is a lead. */
export function leadProblem(days: number): string | null {
  if (!Number.isInteger(days) || days < 0) {
    return 'Der Vorlauf ist eine ganze Zahl von Tagen, 0 oder mehr.'
  }

  if (days > longestLeadDays) {
    return `Der Vorlauf ist höchstens ${String(longestLeadDays)} Tage lang.`
  }

  return null
}

/** What an interval is wrong about, or null when it is one. */
export function intervalProblem(days: number): string | null {
  if (!Number.isInteger(days) || days < 1) {
    return 'Die Frist ist eine ganze Zahl von Tagen, mindestens 1.'
  }

  if (days > longestIntervalDays) {
    return `Die Frist ist höchstens ${String(longestIntervalDays)} Tage lang.`
  }

  return null
}

/** The day a deadline reminds: its lead before the day it is due. */
export function remindOn(dueOn: IsoDate, leadDays: number): IsoDate {
  return addDays(dueOn, -leadDays)
}

/**
 * What a business has set for a kind. Every value is optional: what is not
 * set is the kind's own.
 */
export interface DeadlineSetting {
  readonly kind: string
  readonly leadDays: number | null
  readonly intervalDays: number | null
  readonly responsibleUserId: string | null
}

/** The interval that applies to a kind: the business's, else the kind's. */
export function intervalOf(kind: DeadlineKind, setting: DeadlineSetting | null): number | null {
  if (kind.intervalDays === null) {
    return null
  }

  return setting?.intervalDays ?? kind.intervalDays
}

/**
 * The lead that applies to one deadline. Its own first, then the business's
 * for the kind, then the kind's; the same order as a payment term, which goes
 * from the document to the business.
 */
export function leadOf(
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  own: number | null,
): number {
  return own ?? setting?.leadDays ?? kind.leadDays
}

/**
 * One deadline, as the server keeps it. Not synced: a deadline is worked out
 * on the server from what the devices sent, and the office reads it from
 * there.
 */
export interface Deadline {
  readonly id: DeadlineId
  readonly tenantId: TenantId
  readonly kind: string
  /** The record the deadline follows, one deadline per kind and source. */
  readonly sourceId: string
  readonly documentId: DocumentId | null
  readonly installationId: InstallationId | null
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
  /**
   * The day of the source the due day is counted from: the day the quote went
   * out. When it changes, a deadline that was done opens again, because the
   * source asks anew; a change of the interval alone moves only open ones.
   */
  readonly anchorOn: IsoDate
  readonly dueOn: IsoDate
  /** Its own lead, or null for the one of the kind. */
  readonly leadDays: number | null
  /** Its own person, or null for the one of the kind. */
  readonly responsibleUserId: string | null
  /** The person the source names, kept for when nobody else is set. */
  readonly naturalUserId: string | null
  readonly status: DeadlineStatus
  readonly closedAt: Date | null
  /** Who marked it done, null when the engine closed it. */
  readonly closedBy: string | null
  /** The due day its actions ran for, so that they run once per day. */
  readonly remindedFor: IsoDate | null
  readonly remindedAt: Date | null
  /** The task its reminder made, when it made one. */
  readonly taskId: TaskId | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** A key a kind may have: lower case, dots between the parts. */
const kindKeyShape = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

/** What is wrong with one kind, empty when nothing is. */
export function kindProblems(kind: DeadlineKind): readonly string[] {
  const problems: string[] = []

  if (!kindKeyShape.test(kind.key)) {
    problems.push(`${kind.key}: der Schlüssel hat nicht die Form "bereich.name".`)
  }

  if (kind.trade !== null && !kind.key.startsWith(`${kind.trade}.`)) {
    problems.push(`${kind.key}: ein Typ aus dem Paket ${kind.trade} beginnt mit "${kind.trade}.".`)
  }

  if (kind.title.trim() === '' || kind.about.trim() === '') {
    problems.push(`${kind.key}: Titel und Beschreibung fehlen.`)
  }

  if (!(deadlineSources as readonly string[]).includes(kind.source)) {
    problems.push(`${kind.key}: die Quelle ${kind.source} gibt es nicht.`)
  }

  if (!(deadlineResponsibles as readonly string[]).includes(kind.responsible)) {
    problems.push(`${kind.key}: "${kind.responsible}" ist keine Vorgabe für die Person.`)
  }

  const lead = leadProblem(kind.leadDays)

  if (lead !== null) {
    problems.push(`${kind.key}: ${lead}`)
  }

  if (kind.intervalDays !== null) {
    const interval = intervalProblem(kind.intervalDays)

    if (interval !== null) {
      problems.push(`${kind.key}: ${interval}`)
    }
  }

  if (kind.actions.length === 0) {
    problems.push(`${kind.key}: ohne Aktion erinnert der Typ an nichts.`)
  }

  for (const action of kind.actions) {
    if (!(deadlineActions as readonly string[]).includes(action)) {
      problems.push(`${kind.key}: die Aktion ${action} gibt es nicht.`)
    }
  }

  if (new Set(kind.actions).size !== kind.actions.length) {
    problems.push(`${kind.key}: eine Aktion steht doppelt.`)
  }

  if (kind.actions.includes('task') && !kind.taskTitle.includes('{quelle}')) {
    problems.push(`${kind.key}: der Titel der Aufgabe nennt die Quelle nicht ({quelle}).`)
  }

  return problems
}

/** The kinds an instance knows, by key. */
export interface DeadlineRegistry {
  readonly kinds: readonly DeadlineKind[]
  kind(key: string): DeadlineKind | null
}

export class DeadlineRegistryError extends Error {}

/**
 * The kinds of the core and of the trade packages, checked and put together.
 * A kind with a problem, or two with one key, stop the start rather than
 * remind of the wrong thing later.
 */
export function deadlineRegistry(kinds: readonly DeadlineKind[]): DeadlineRegistry {
  const byKey = new Map<string, DeadlineKind>()
  const problems: string[] = []

  for (const kind of kinds) {
    problems.push(...kindProblems(kind))

    if (byKey.has(kind.key)) {
      problems.push(`${kind.key}: der Typ steht zweimal.`)
    }

    byKey.set(kind.key, kind)
  }

  if (problems.length > 0) {
    throw new DeadlineRegistryError(problems.join(' '))
  }

  return {
    kinds: [...byKey.values()],
    kind: (key) => byKey.get(key) ?? null,
  }
}

/** The title of the task a deadline makes, with its source put in. */
export function taskTitleOf(kind: DeadlineKind, source: string): string {
  return kind.taskTitle.replaceAll('{quelle}', source)
}

/**
 * The words the office reads about each source: who it names, what its
 * interval counts from, and the day that interval starts on.
 */
export const sourceWords: Readonly<
  Record<
    DeadlineSource,
    {
      /** The person the source names, as the default of "Verantwortlich". */
      readonly person: string
      /** The field of an interval, and the sentence under it. */
      readonly interval: { readonly label: string; readonly hint: string }
      /** The day the interval counts from, after "nach": "dem Festschreiben". */
      readonly anchor: string
    }
  >
> = {
  quote: {
    person: 'Wer das Angebot festgeschrieben hat',
    interval: {
      label: 'Wiedervorlage nach',
      hint: 'Gezählt ab dem Tag, an dem das Angebot festgeschrieben wurde.',
    },
    anchor: 'dem Festschreiben',
  },
}

/** Who a kind gives a deadline to when nobody has said otherwise, in those words. */
export function defaultResponsibleLabel(
  kind: Pick<DeadlineKind, 'responsible' | 'source'>,
): string {
  return kind.responsible === 'owner' ? 'Der Inhaber' : sourceWords[kind.source].person
}

const actionWords: Readonly<Record<DeadlineAction, string>> = {
  task: 'eine Aufgabe',
  reminder: 'eine Erinnerung per E-Mail und Push',
  service_job: 'ein Serviceauftrag im Entwurf',
  status: 'ein neuer Stand an der Quelle',
}

/**
 * What a kind does when its lead comes, as the settings say it: "Bei
 * Fälligkeit: eine Aufgabe und eine Erinnerung per E-Mail und Push für die
 * verantwortliche Person."
 */
export function actionsSentence(actions: readonly DeadlineAction[]): string {
  const words = actions.map((action) => actionWords[action])
  const listed =
    words.length <= 1
      ? (words[0] ?? 'nichts')
      : `${words.slice(0, -1).join(', ')} und ${words[words.length - 1] ?? ''}`
  const addressed = actions.some((action) => action === 'task' || action === 'reminder')

  return `Bei Fälligkeit: ${listed}${addressed ? ' für die verantwortliche Person' : ''}.`
}
