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
 * - `customer_reminder`: a reminder to the customer of the source (#316), by
 *   mail or, without an address, a task to call them, where the customer may
 *   be reminded and the business has switched it on.
 * - `erasure`: the source deleted under the deletion concept (#317), where
 *   the business has set its kind to go by itself, in the name of whoever
 *   did so while that person leads it. Otherwise nothing: the deadline stays
 *   open, and the office confirms it under "Datenschutz".
 */
export const deadlineActions = [
  'task',
  'reminder',
  'service_job',
  'status',
  'customer_reminder',
  'erasure',
] as const

export type DeadlineAction = (typeof deadlineActions)[number]

/**
 * Where a kind of deadline comes from. Each source is a question the server
 * asks the data of a business, and each is built with the first kind that
 * needs it.
 *
 * - `quote`: an issued quote that no document has followed yet. The day it
 *   was issued is the anchor, and the deadline falls due a number of days
 *   later (3.3, the follow-up of an open quote).
 * - `store_minimum`: an article below the minimum its store keeps (#298, 4.5).
 *   Due on the day of the booking that took it there, and gone again once the
 *   stock is back at the minimum: one deadline for each article and store, as
 *   long as it lies below.
 * - `qualification`: a qualification of a person in the files that runs out
 *   (#287, 4.9). Due on its last day; a later day moves the deadline, and a
 *   qualification taken out, or a person who left, lets it drop.
 * - `inspection`: the last signed protocol of an installation that names its
 *   next inspection (#301, `nextInspectionOn`). One deadline per
 *   installation, due when that protocol says; a newer protocol moves it, an
 *   installation deleted lets it drop. The person it names is who signed.
 * - `appliance_inspection`: the same for an appliance of the register (#303): the
 *   last signed protocol of an appliance that names its next test. One deadline
 *   per appliance, which drops with the appliance.
 * - `installer_registration`: the entry of the business in the installer
 *   directory of a grid operator (#306), due on its last day. A later day moves
 *   it; a grid operator removed, or an entry without a last day, lets it drop.
 * - `acceptance`: the last signed acceptance of a job (#310), due on the last
 *   day of the warranty that runs from it. A newer protocol moves it; with the
 *   job it drops.
 * - `defect`: the day by which a customer wants a defect remedied (#311),
 *   as it stands at the defect. It drops once the defect is remedied.
 * - `maintenance_visit`: the next day a maintenance contract is due (#294)
 *   whose service job is not made yet. One deadline per contract that moves
 *   on to the next day once the job of this one exists; a contract given
 *   notice has none after the day it ends, a contract deleted lets it drop.
 * - `maintenance_notice`: the last day a notice still ends a maintenance
 *   contract at the end of the term running now (#294). Only for a contract
 *   that renews and has no notice yet, and for one that runs on without end
 *   only before its first term ends.
 * - `maintenance_period`: the start of the next period of a contract paid per
 *   period that has no invoice yet (#295). One deadline per contract that
 *   moves on to the next period once the invoice of this one exists.
 * - `prospect`: a lead that never became a customer (#317), due the months
 *   of the interval after its last contact. A later contact moves it; the
 *   lead becoming a customer or being deleted lets it drop.
 * - `customer`: a customer with whom nothing runs (#845), due the months of
 *   the interval after its last contact, or the day it asked to be deleted,
 *   and not before the day after its last document to keep and its last
 *   warranty (`customerErasureDueOn`). An open job or a running contract
 *   lets it drop, a later contact moves it.
 * - `erasure_request`: a request for deletion not answered yet (#845), due a
 *   month after it came in (Art. 12 (3) DSGVO). The answer lets it drop.
 * - `sickness`: a sickness a year after its last day (#846,
 *   `sicknessErasureDueOn`); deleting it lets it drop.
 * - `staff_year`: the time and leave of one year of one person, six years
 *   after the end of the year (#846, `staffYearErasureDueOn`).
 * - `person`: the file of somebody who left, three years after the end of the
 *   year they left (#846, `personErasureDueOn`). Coming back lets it drop.
 *
 * The three of the staff come only once they are due: a deadline years ahead
 * for every sickness and every year would fill the list and say nothing.
 */
export const deadlineSources = [
  'quote',
  'store_minimum',
  'qualification',
  'inspection',
  'appliance_inspection',
  'installer_registration',
  'acceptance',
  'defect',
  'maintenance_visit',
  'maintenance_notice',
  'maintenance_period',
  'prospect',
  'customer',
  'erasure_request',
  'sickness',
  'staff_year',
  'person',
] as const

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
   * "Angebot {quelle} nachfassen". A title that names the site with
   * `{objekt}` instead makes one task for all deadlines of the kind due the
   * same day for the same person at the same site (1.2, #303): the test of a
   * hundred appliances at a customer is one task and not a hundred.
   */
  readonly taskTitle: string
  /**
   * What the reminder to the customer calls what is due (#316), with
   * `{quelle}` and `{objekt}` like the title of the task: "Wiederholungsprüfung
   * der Anlage {quelle}". A kind with the action `customer_reminder` has one.
   */
  readonly customerTitle?: string
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

    if (
      kind.actions.includes('task') &&
      !kind.taskTitle.includes('{quelle}') &&
      !kind.taskTitle.includes('{objekt}')
    ) {
      problems.push(
        `${kind.key}: der Titel der Aufgabe nennt weder die Quelle ({quelle}) noch das Objekt ({objekt}).`,
      )
    }

    if (kind.actions.includes('customer_reminder') && !kind.customerTitle) {
      problems.push(
        `${kind.key}: eine Erinnerung an den Kunden braucht einen Titel für ihn (customerTitle).`,
      )
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

/**
 * The title of the task a deadline makes, with its source and its site put
 * in; a deadline at no site leaves the site out with the word before it.
 */
export function taskTitleOf(
  kind: DeadlineKind,
  source: string,
  site: string | null = null,
): string {
  const withSite =
    site === null
      ? kind.taskTitle.replaceAll(' am Objekt {objekt}', '').replaceAll('{objekt}', '')
      : kind.taskTitle.replaceAll('{objekt}', site)

  return withSite.replaceAll('{quelle}', source)
}

/** What a reminder to the customer calls what is due, with its source and its site put in, as the task does. */
export function customerTitleOf(
  kind: DeadlineKind,
  source: string,
  site: string | null = null,
): string {
  return taskTitleOf({ ...kind, taskTitle: kind.customerTitle ?? kind.title }, source, site)
}

/** Whether the tasks of a kind are shared by the deadlines of a site, as `{objekt}` says. */
export function sharesTasksBySite(kind: Pick<DeadlineKind, 'taskTitle'>): boolean {
  return kind.taskTitle.includes('{objekt}') && !kind.taskTitle.includes('{quelle}')
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
  // Due on the day the stock fell below its minimum, without an interval (#298).
  store_minimum: {
    person: 'Wer zuletzt gebucht hat',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig am Tag der Buchung, die den Bestand unter den Mindestbestand gebracht hat.',
    },
    anchor: 'der Buchung',
  },
  // Due on the last day of the qualification, without an interval (#287).
  qualification: {
    person: 'Die Person, deren Qualifikation abläuft',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig am letzten Tag, an dem die Qualifikation gilt.',
    },
    anchor: 'dem letzten Tag',
  },
  // Due when the last protocol says, without an interval of the kind (#301).
  inspection: {
    person: 'Wer die letzte Prüfung unterschrieben hat',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig nach der Prüffrist, die das letzte unterschriebene Protokoll der Anlage nennt.',
    },
    anchor: 'der letzten Prüfung',
  },
  // The same for an appliance of the register (#303).
  appliance_inspection: {
    person: 'Wer das Gerät zuletzt geprüft hat',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig nach der Prüffrist, die das letzte unterschriebene Protokoll des Geräts nennt.',
    },
    anchor: 'der letzten Prüfung',
  },
  // Due on the last day of the entry, without an interval (#306). The entry
  // is the business's and names nobody, so the deadline waits with the owner.
  installer_registration: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig am letzten Tag, an dem die Eintragung im Installateurverzeichnis gilt.',
    },
    anchor: 'dem letzten Tag',
  },
  // Due on the last day of the warranty that runs from an acceptance (#310),
  // without an interval: its length comes from the rules. The owner answers for it.
  acceptance: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig am letzten Tag der Gewährleistung, gezählt ab dem Tag der Abnahme.',
    },
    anchor: 'der Abnahme',
  },
  // Due on the day the customer set to remedy a defect (#311), without an
  // interval. The owner answers for it, as for the warranty it belongs to.
  defect: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig an dem Tag, bis zu dem der Kunde den Mangel beseitigt haben will.',
    },
    anchor: 'der Frist des Kunden',
  },
  // Due on the day of the maintenance, without an interval (#294): the lead is
  // how long before it the service job is made. The owner answers for it.
  maintenance_visit: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig am Tag der Wartung, wie der Vertrag sie zählt.',
    },
    anchor: 'dem Beginn des Vertrags',
  },
  // Due on the last day a notice still ends the term (#294), without an interval.
  maintenance_notice: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig am letzten Tag, an dem eine Kündigung den Vertrag noch zum Ende der Laufzeit beendet.',
    },
    anchor: 'dem Beginn des Vertrags',
  },
  // Due on the first day of a period, without an interval (#295).
  maintenance_period: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig am ersten Tag eines Zeitraums, den der Vertrag abrechnet.',
    },
    anchor: 'dem Beginn des Vertrags',
  },
  // Due the months of the interval after the last contact (#317).
  prospect: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Gezählt ab dem letzten Kontakt mit dem Lead.',
    },
    anchor: 'dem letzten Kontakt',
  },
  // Due the months of the interval after the last contact, and not before the
  // papers and the warranty let the customer go (#845).
  customer: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Gezählt ab dem letzten Kontakt mit dem Kunden; nicht bevor Belege und Gewährleistung ihn freigeben.',
    },
    anchor: 'dem letzten Kontakt',
  },
  // Due a month after the request came in (#845), without an interval.
  erasure_request: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig einen Monat nach dem Eingang der Anfrage.',
    },
    anchor: 'dem Eingang der Anfrage',
  },
  // The three of the staff (#846): due from the rule package, without an interval.
  sickness: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig ein Jahr nach dem letzten Tag der Krankheit.',
    },
    anchor: 'dem letzten Tag der Krankheit',
  },
  staff_year: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig sechs Jahre nach dem Ende des Jahres, wenn die Lohnunterlagen gehen dürfen.',
    },
    anchor: 'dem Ende des Jahres',
  },
  person: {
    person: 'Der Inhaber',
    interval: {
      label: 'Fällig nach',
      hint: 'Fällig drei Jahre nach dem Ende des Jahres, in dem die Person ausgetreten ist.',
    },
    anchor: 'dem Ende des Austrittsjahres',
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
  customer_reminder: 'eine Erinnerung an den Kunden',
  erasure: 'das Löschen, wenn es unter Datenschutz auf automatisch steht',
}

/**
 * What a kind does when its lead comes, as the settings say it: "Bei
 * Fälligkeit: eine Aufgabe und eine Erinnerung per E-Mail und Push für die
 * verantwortliche Person." The reminder to the customer comes after the
 * rest, since the person is not who it goes to: "..., dazu eine Erinnerung an
 * den Kunden."
 */
export function actionsSentence(actions: readonly DeadlineAction[]): string {
  const own = actions.filter((action) => action !== 'customer_reminder')
  const words = own.map((action) => actionWords[action])
  const listed =
    words.length <= 1
      ? (words[0] ?? (own.length < actions.length ? '' : 'nichts'))
      : `${words.slice(0, -1).join(', ')} und ${words[words.length - 1] ?? ''}`
  const addressed = own.some((action) => action === 'task' || action === 'reminder')
  const toCustomer = own.length < actions.length ? actionWords.customer_reminder : ''
  const sentence = [`${listed}${addressed ? ' für die verantwortliche Person' : ''}`, toCustomer]
    .filter((part) => part !== '')
    .join(', dazu ')

  return `Bei Fälligkeit: ${sentence}.`
}
