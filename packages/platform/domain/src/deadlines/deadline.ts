import { addDays, addMonths } from '../model/calendar.js'
import type { IsoDate } from '../model/identifier.js'

/**
 * The deadline engine (ADR 0010, opengewerk-haustechnik#24): one record for
 * everything that falls due, whatever part of an application it comes from.
 *
 * A deadline is never typed in. It follows from a source, a record of the
 * application that asks for something to happen by a certain day, and it
 * follows that source for as long as it is open: when the source changes, the
 * day changes with it, and when the source is gone or has done what the
 * deadline waited for, the deadline drops out by itself. What a person does
 * with one is marking it done, or giving it a lead or a person of its own.
 *
 * The kinds are data. Where a kind comes from, which sources there are and
 * what an action does, beside the reminder, is the application's business:
 * it hands its lists in, and the registry here checks every kind against
 * them.
 */

/**
 * Open until it is done or has dropped out. Done is what a person says, or
 * what follows when what the deadline made has been done; dropped is what the
 * engine says when the source no longer asks for the deadline, and it comes
 * back by itself if the source asks again.
 */
export const deadlineStatuses = ['open', 'done', 'dropped'] as const

export type DeadlineStatus = (typeof deadlineStatuses)[number]

/**
 * The one action the foundation knows itself: a reminder to the responsible
 * person, through the occasions of the notifications (#23), by mail and by
 * push where that person takes them. Every other action, a task, a record of
 * the application in draft, a change of state at the source, the application
 * names and brings the handler for.
 */
export const reminderAction = 'reminder'

/**
 * Who answers for a deadline when nobody has said otherwise.
 *
 * - `source`: the person the source names, whoever issued what the deadline
 *   follows.
 * - `lead`: whoever leads the tenant, the one longest in it when there are
 *   several. Found by the flag of a role and never by its name.
 */
export const deadlineResponsibles = ['source', 'lead'] as const

export type DeadlineResponsible = (typeof deadlineResponsibles)[number]

/**
 * A kind of deadline, as it sits in a JSON file of an application or of one
 * of its packages. An application may give its kinds more fields; the
 * registry passes them through and lets the application check them.
 */
export interface DeadlineKind<Source extends string = string, Action extends string = string> {
  /** Stable and unique, with a dot between the parts: `area.name`. */
  readonly key: string
  /** What it is called on screen. */
  readonly title: string
  /** One sentence under the title in the settings: where it comes from. */
  readonly about: string
  readonly source: Source
  /**
   * Days from the anchor of the source to the due day, where the source does
   * not name the day itself and the kind counts in days. The tenant can
   * change it for the kind. Null where the source names the day, or where the
   * kind counts in months.
   */
  readonly intervalDays: number | null
  /**
   * Months from the anchor to the due day, for a kind that counts in months,
   * as duties of an operator mostly do. Absent or null for every other kind;
   * a kind has an interval in days or in months, never both.
   */
  readonly intervalMonths?: number | null
  /** How many days before the due day it reminds, until the tenant says otherwise. */
  readonly leadDays: number
  /** Who answers for it until the tenant names somebody for the kind. */
  readonly responsible: DeadlineResponsible
  readonly actions: readonly Action[]
  /** Where the interval or the kind comes from, when a law or a norm sets it. */
  readonly reference?: string
}

/** An interval in one unit: whole days, or whole months. */
export type DeadlineInterval = { readonly days: number } | { readonly months: number }

/** The day an interval after another day ends on. */
export function addInterval(on: IsoDate, interval: DeadlineInterval): IsoDate {
  return 'days' in interval ? addDays(on, interval.days) : addMonths(on, interval.months)
}

/** The longest lead accepted, a year, as a guard against a typing error. */
export const longestLeadDays = 365

/** The longest interval in days accepted for a kind the tenant can set, also a year. */
export const longestIntervalDays = 365

/**
 * The longest interval in months accepted, fifty years. Records some duties
 * call for are kept for decades, and a guard against a typing error must not
 * stand in their way.
 */
export const longestIntervalMonths = 600

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

/** What an interval in days is wrong about, or null when it is one. */
export function intervalProblem(days: number): string | null {
  if (!Number.isInteger(days) || days < 1) {
    return 'Die Frist ist eine ganze Zahl von Tagen, mindestens 1.'
  }

  if (days > longestIntervalDays) {
    return `Die Frist ist höchstens ${String(longestIntervalDays)} Tage lang.`
  }

  return null
}

/** What an interval in months is wrong about, or null when it is one. */
export function intervalMonthsProblem(months: number): string | null {
  if (!Number.isInteger(months) || months < 1) {
    return 'Die Frist ist eine ganze Zahl von Monaten, mindestens 1.'
  }

  if (months > longestIntervalMonths) {
    return `Die Frist ist höchstens ${String(longestIntervalMonths)} Monate lang.`
  }

  return null
}

/** The day a deadline reminds: its lead before the day it is due. */
export function remindOn(dueOn: IsoDate, leadDays: number): IsoDate {
  return addDays(dueOn, -leadDays)
}

/**
 * The columns of the list of deadlines that every application has, as the
 * list heads them and its table names them (opengewerk-haustechnik#236). An
 * application puts its own between "Betrifft" and "Verantwortlich".
 */
export const deadlineListColumns = {
  due: 'Fällig am',
  late: 'Überfällig',
  subject: 'Betrifft',
  kind: 'Art',
  responsible: 'Verantwortlich',
  reminder: 'Erinnerung',
} as const

/** A day as the office writes it: 02.10.2026. */
function dayWords(day: string): string {
  const [year, month, date] = day.slice(0, 10).split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** The part of a moment that is its day, from the moment or from its text. */
function dayOf(moment: Date | string): string {
  return (typeof moment === 'string' ? moment : moment.toISOString()).slice(0, 10)
}

/** What a list says about the reminder of a deadline: done, dropped, reminded, or when it will. */
export interface DeadlineReminderFacts {
  readonly status: DeadlineStatus
  readonly dueOn: IsoDate
  readonly remindOn: IsoDate
  readonly remindedFor: IsoDate | null
  readonly remindedAt: Date | string | null
  readonly closedAt: Date | string | null
}

/**
 * The column "Erinnerung" in words: "erledigt am 02.10.2026", "entfallen",
 * "erinnert am 28.09.2026" for the day it is due, or the day it will remind.
 */
export function deadlineReminderWords(deadline: DeadlineReminderFacts): string {
  if (deadline.status === 'done') {
    return deadline.closedAt ? `erledigt am ${dayWords(dayOf(deadline.closedAt))}` : 'erledigt'
  }

  if (deadline.status === 'dropped') {
    return deadline.closedAt ? `entfallen am ${dayWords(dayOf(deadline.closedAt))}` : 'entfallen'
  }

  if (deadline.remindedFor === deadline.dueOn && deadline.remindedAt) {
    return `erinnert am ${dayWords(dayOf(deadline.remindedAt))}`
  }

  return `am ${dayWords(deadline.remindOn)}`
}

/** Whether an open deadline is past its day. */
export function deadlineIsLate(
  deadline: Pick<DeadlineReminderFacts, 'status' | 'dueOn'>,
  today: IsoDate,
): boolean {
  return deadline.status === 'open' && deadline.dueOn < today
}

/**
 * What a tenant has set for a kind. Every value is optional: what is not set
 * is the kind's own. An interval is set in the unit the kind counts in.
 */
export interface DeadlineSetting {
  readonly kind: string
  readonly leadDays: number | null
  readonly intervalDays: number | null
  readonly intervalMonths: number | null
  readonly responsibleUserId: string | null
  /** How a deadline of the kind reminds; null is the way of the kind, by mail and by push. */
  readonly reminder: DeadlineReminder | null
}

/**
 * The ways a deadline of a kind reminds the person who answers for it
 * (opengewerk-haustechnik#269). By mail and by push is what a kind does on
 * its own; mail alone leaves the devices quiet; no message at all leaves the
 * deadline in the list, and whatever else the kind does when its lead comes,
 * a task or a work order, it still does.
 *
 * "Push alone" is not one of them: push reaches only somebody who switched it
 * on for themselves, and a deadline that reminded only that way could
 * remind nobody (Moritz, 14.10.2026).
 */
export const deadlineReminders = ['email_and_push', 'email', 'none'] as const

export type DeadlineReminder = (typeof deadlineReminders)[number]

/** The ways of reminding, in the words of the settings of the deadlines. */
export const deadlineReminderLabel: Readonly<Record<DeadlineReminder, string>> = {
  email_and_push: 'E-Mail und Push',
  email: 'Nur E-Mail',
  none: 'Keine Nachricht',
}

/** Whether a value is one of the ways of reminding. */
export function isDeadlineReminder(value: unknown): value is DeadlineReminder {
  return typeof value === 'string' && (deadlineReminders as readonly string[]).includes(value)
}

/** The channels a reminder can go out on. */
export type ReminderChannel = 'mail' | 'push'

/**
 * Whether a deadline of a kind reminds on a channel, by what the tenant set
 * for the kind. Nothing set is both.
 */
export function remindsBy(reminder: DeadlineReminder | null, channel: ReminderChannel): boolean {
  switch (reminder ?? 'email_and_push') {
    case 'email_and_push':
      return true
    case 'email':
      return channel === 'mail'
    case 'none':
      return false
  }
}

/**
 * The ways of reminding that keep a channel quiet, for a query that leaves
 * out the deadlines of the kinds set so (`deadlineRemindsOn` on the server).
 */
export function remindersQuietOn(channel: ReminderChannel): readonly DeadlineReminder[] {
  return deadlineReminders.filter((reminder) => !remindsBy(reminder, channel))
}

/**
 * The interval that applies to a kind: the tenant's, else the kind's, in the
 * unit of the kind. Null where the source names the day.
 */
export function intervalOf(
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
): DeadlineInterval | null {
  if (kind.intervalDays !== null) {
    return { days: setting?.intervalDays ?? kind.intervalDays }
  }

  if (kind.intervalMonths !== undefined && kind.intervalMonths !== null) {
    return { months: setting?.intervalMonths ?? kind.intervalMonths }
  }

  return null
}

/**
 * The lead that applies to one deadline. Its own first, then the tenant's for
 * the kind, then the kind's.
 */
export function leadOf(
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  own: number | null,
): number {
  return own ?? setting?.leadDays ?? kind.leadDays
}

/** What an application says about its kinds: its sources, its actions and what else it checks. */
export interface DeadlineCatalogue<Kind extends DeadlineKind> {
  /** The sources the application asks, by the name a kind gives them. */
  readonly sources: readonly Kind['source'][]
  /** Every action a kind may name, the reminder included where it is one of them. */
  readonly actions: readonly Kind['actions'][number][]
  /** What the application finds wrong with a kind beside what is wrong with any kind. */
  readonly problems?: (kind: Kind) => readonly string[]
}

/** A key a kind may have: lower case, dots between the parts. */
const kindKeyShape = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

/** What is wrong with one kind, empty when nothing is. */
export function deadlineKindProblems<Kind extends DeadlineKind>(
  kind: Kind,
  catalogue: DeadlineCatalogue<Kind>,
): readonly string[] {
  const problems: string[] = []

  if (!kindKeyShape.test(kind.key)) {
    problems.push(`${kind.key}: der Schlüssel hat nicht die Form "bereich.name".`)
  }

  if (kind.title.trim() === '' || kind.about.trim() === '') {
    problems.push(`${kind.key}: Titel und Beschreibung fehlen.`)
  }

  if (!(catalogue.sources as readonly string[]).includes(kind.source)) {
    problems.push(`${kind.key}: die Quelle ${kind.source} gibt es nicht.`)
  }

  if (!(deadlineResponsibles as readonly string[]).includes(kind.responsible)) {
    problems.push(`${kind.key}: "${kind.responsible}" ist keine Vorgabe für die Person.`)
  }

  const lead = leadProblem(kind.leadDays)

  if (lead !== null) {
    problems.push(`${kind.key}: ${lead}`)
  }

  const months = kind.intervalMonths ?? null

  if (kind.intervalDays !== null && months !== null) {
    problems.push(`${kind.key}: die Frist zählt in Tagen oder in Monaten, nicht in beiden.`)
  }

  if (kind.intervalDays !== null) {
    const interval = intervalProblem(kind.intervalDays)

    if (interval !== null) {
      problems.push(`${kind.key}: ${interval}`)
    }
  }

  if (months !== null) {
    const interval = intervalMonthsProblem(months)

    if (interval !== null) {
      problems.push(`${kind.key}: ${interval}`)
    }
  }

  if (kind.actions.length === 0) {
    problems.push(`${kind.key}: ohne Aktion erinnert der Typ an nichts.`)
  }

  for (const action of kind.actions) {
    if (!(catalogue.actions as readonly string[]).includes(action)) {
      problems.push(`${kind.key}: die Aktion ${action} gibt es nicht.`)
    }
  }

  if (new Set(kind.actions).size !== kind.actions.length) {
    problems.push(`${kind.key}: eine Aktion steht doppelt.`)
  }

  problems.push(...(catalogue.problems?.(kind) ?? []))

  return problems
}

/** The kinds an instance knows, by key. */
export interface DeadlineRegistry<Kind extends DeadlineKind = DeadlineKind> {
  readonly kinds: readonly Kind[]
  kind(key: string): Kind | null
}

export class DeadlineRegistryError extends Error {}

/**
 * The kinds of an application, checked and put together. A kind with a
 * problem, or two with one key, stop the start rather than remind of the
 * wrong thing later.
 */
export function deadlineRegistry<Kind extends DeadlineKind>(
  kinds: readonly Kind[],
  catalogue: DeadlineCatalogue<Kind>,
): DeadlineRegistry<Kind> {
  const byKey = new Map<string, Kind>()
  const problems: string[] = []

  for (const kind of kinds) {
    problems.push(...deadlineKindProblems(kind, catalogue))

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
