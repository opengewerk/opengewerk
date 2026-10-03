import {
  type DeadlineCatalogue,
  type DeadlineKind as FoundationDeadlineKind,
  deadlineKindProblems,
  type DeadlineRegistry as FoundationDeadlineRegistry,
  deadlineRegistry as registryOf,
  type DeadlineStatus,
  type IsoDate,
  type TenantId,
} from '@opengewerk/platform-domain'
import type {
  CustomerId,
  DeadlineId,
  DocumentId,
  InstallationId,
  JobId,
  SiteId,
  TaskId,
} from '../model/identifier.js'

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
 *
 * The mechanism is the foundation's (ADR 0010, opengewerk-haustechnik#24):
 * the states, the lead and the interval, what a business sets for a kind and
 * the checks every kind has to pass. What stays here is what only this
 * application knows: its sources and actions, the trade a kind comes from,
 * the title of the task it makes and the words the office reads.
 */

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
 * A kind of deadline, as it sits in a JSON file of the core or of a trade
 * package: what every kind has (the foundation's), the trade it comes from and
 * the title of the task it makes.
 */
export interface DeadlineKind extends FoundationDeadlineKind<DeadlineSource, DeadlineAction> {
  /** The trade package it comes from, or null for the core. */
  readonly trade: string | null
  /**
   * The title of the task it makes, with `{quelle}` where the source goes:
   * "Angebot {quelle} nachfassen".
   */
  readonly taskTitle: string
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

/**
 * The sources and actions of this application, and what it checks beside
 * what every kind has to pass: a kind of a trade begins with the name of its
 * trade, and the title of the task names the source.
 */
const catalogue: DeadlineCatalogue<DeadlineKind> = {
  sources: deadlineSources,
  actions: deadlineActions,
  problems: (kind) => {
    const problems: string[] = []

    if (kind.trade !== null && !kind.key.startsWith(`${kind.trade}.`)) {
      problems.push(
        `${kind.key}: ein Typ aus dem Paket ${kind.trade} beginnt mit "${kind.trade}.".`,
      )
    }

    if (kind.actions.includes('task') && !kind.taskTitle.includes('{quelle}')) {
      problems.push(`${kind.key}: der Titel der Aufgabe nennt die Quelle nicht ({quelle}).`)
    }

    return problems
  },
}

/** What is wrong with one kind, empty when nothing is. */
export function kindProblems(kind: DeadlineKind): readonly string[] {
  return deadlineKindProblems(kind, catalogue)
}

/** The kinds an instance knows, by key. */
export type DeadlineRegistry = FoundationDeadlineRegistry<DeadlineKind>

/**
 * The kinds of the core and of the trade packages, checked and put together.
 * A kind with a problem, or two with one key, stop the start rather than
 * remind of the wrong thing later.
 */
export function deadlineRegistry(kinds: readonly DeadlineKind[]): DeadlineRegistry {
  return registryOf(kinds, catalogue)
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
  return kind.responsible === 'lead' ? 'Der Inhaber' : sourceWords[kind.source].person
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
