import type { IsoDate } from '@opengewerk/platform-domain'

import type { Permission } from './authorization.js'
import type { CustomerKind } from './customer.js'
import type { ErasureId } from './identifier.js'
import type { Prospect, ProspectSource } from './prospect.js'

/**
 * What the deletion concept deletes (#317, section 2): a pass proposes what is
 * due and whoever leads the business confirms, or a kind goes by itself once
 * the owner has set it to. Deleting is a step of its own: the record goes, a
 * line in the protocol says when, by whom and what, without naming anybody,
 * and every value of the record in the change log is blacked out (ADR 0013).
 *
 * The first kind is a lead that never became a customer (3.1, #312), the
 * second a customer with whom nothing runs any more or who asked to be
 * deleted (#845). The last three are the staff's (#846): a sickness twelve
 * months after its last day, the time and leave of a year of one person once
 * the payroll no longer needs them, and the file of somebody who left three
 * years after the end of that year, decided on 04.11.2026.
 */
export const erasureKinds = ['prospect', 'customer', 'sickness', 'staff_year', 'person'] as const

export type ErasureKind = (typeof erasureKinds)[number]

export interface ErasureKindWords {
  /** The kind of deadline that proposes a record of the kind. */
  readonly deadline: string
  /**
   * The right that reads a record of the kind. Who it is that is due is shown
   * only to whoever has it, and only whoever has it confirms (the security
   * review of #847): reading the settings is not reading the leads.
   */
  readonly read: Permission
  /** One record of the kind, as a column of the lists says it. */
  readonly one: string
  /** The kind as the switch for going by itself names it. */
  readonly title: string
  /**
   * Why the values in the change log were blacked out, as the log says it at
   * each value. No name: the reason stays where the value went.
   */
  readonly reason: string
}

export const erasureKindWords: Readonly<Record<ErasureKind, ErasureKindWords>> = {
  prospect: {
    deadline: 'privacy.prospect_erasure',
    read: 'prospect.read',
    one: 'Lead',
    title: 'Leads, die nie Kunde wurden',
    reason: 'Gelöscht nach dem Löschkonzept: ein Lead, der nie Kunde wurde.',
  },
  customer: {
    deadline: 'privacy.customer_erasure',
    read: 'customer.read',
    one: 'Kunde',
    title: 'Kunden, mit denen nichts mehr läuft',
    reason:
      'Gelöscht nach dem Löschkonzept: ein Kunde, mit dem nichts mehr läuft, oder einer, der um das Löschen gebeten hat.',
  },
  // Who sees which kind an absence is (#288): a sickness is a health datum.
  sickness: {
    deadline: 'privacy.sickness_erasure',
    read: 'absence.write',
    one: 'Krankheit',
    title: 'Krankheiten nach zwölf Monaten',
    reason: 'Gelöscht nach dem Löschkonzept: eine Krankheit, zwölf Monate nach ihrem letzten Tag.',
  },
  // A year of somebody's file: who reads the files reads it.
  staff_year: {
    deadline: 'privacy.staff_year_erasure',
    read: 'person.read',
    one: 'Jahr',
    title: 'Arbeitszeiten und Urlaub eines Jahres',
    reason:
      'Gelöscht nach dem Löschkonzept: Arbeitszeiten und Urlaub eines Jahres, nachdem sie als Lohnunterlage nicht mehr aufzubewahren waren.',
  },
  person: {
    deadline: 'privacy.person_erasure',
    read: 'person.read',
    one: 'Akte',
    title: 'Akten nach dem Austritt',
    reason:
      'Gelöscht nach dem Löschkonzept: die Akte einer Person, drei Jahre nach dem Ende des Jahres, in dem sie ausgetreten ist.',
  },
}

/** The kind of erasure a kind of deadline proposes, or null for every other kind. */
export function erasureKindOfDeadline(deadlineKind: string): ErasureKind | null {
  return erasureKinds.find((kind) => erasureKindWords[kind].deadline === deadlineKind) ?? null
}

function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

const fromSource: Readonly<Record<ProspectSource, string>> = {
  referral: 'aus einer Empfehlung',
  website: 'von der Website',
  phone: 'aus einem Anruf',
  email: 'aus einer E-Mail',
  other: 'aus einer anderen Quelle',
}

/**
 * What a lead is called where its name must not go: the deadline that
 * proposes it and the line of the protocol that says it was deleted. Both
 * outlive the lead, so neither may hold what the deletion takes away.
 */
export function prospectErasureLabel(prospect: Pick<Prospect, 'source' | 'lastContactOn'>): string {
  return `Lead ${fromSource[prospect.source]}, letzter Kontakt ${germanDay(prospect.lastContactOn)}`
}

const customerKindWords: Readonly<Record<CustomerKind, string>> = {
  private: 'Privatkunde',
  business: 'Gewerbekunde',
  property_management: 'Hausverwaltung',
  general_contractor: 'Generalunternehmer',
}

/**
 * What a customer is called where its name must not go, as for a lead: its
 * kind, and either the day it asked to be deleted or its last contact.
 */
export function customerErasureLabel(customer: {
  readonly kind: CustomerKind
  readonly lastContactOn: IsoDate
  readonly requestedOn: IsoDate | null
}): string {
  const kind = customerKindWords[customer.kind]

  return customer.requestedOn === null
    ? `${kind}, letzter Kontakt ${germanDay(customer.lastContactOn)}`
    : `${kind} auf Löschanfrage vom ${germanDay(customer.requestedOn)}`
}

/**
 * What a sickness is called where its name must not go: the day it ended.
 * The deadline that proposes it is shown only to whoever sees the kind of an
 * absence, and the line of the protocol names nobody.
 */
export function sicknessErasureLabel(lastDay: IsoDate): string {
  return `Krankheit, letzter Tag ${germanDay(lastDay)}`
}

/** What a year of somebody's time and leave is called where the name must not go. */
export function staffYearErasureLabel(year: number): string {
  return `Arbeitszeiten und Urlaub ${String(year)}`
}

/** What the file of somebody who left is called where the name must not go. */
export function personErasureLabel(leftOn: IsoDate): string {
  return `Akte, Austritt ${germanDay(leftOn)}`
}

/** A record that is due, as the office reads it before confirming. */
export interface DueErasure {
  /** The deadline that proposes it. */
  readonly deadlineId: string
  readonly kind: ErasureKind
  /** The record that would go. */
  readonly recordId: string
  /** Who it is, from the record itself, for as long as it is there. */
  readonly name: string
  /** What else tells it apart, from the record as well. */
  readonly detail: string
  readonly dueOn: IsoDate
}

/** A line of the protocol: one record deleted. */
export interface Erasure {
  readonly id: ErasureId
  readonly kind: ErasureKind
  /** What it was, without a name (`prospectErasureLabel`). */
  readonly label: string
  /** The day it fell due, or null when it went before that. */
  readonly dueOn: IsoDate | null
  readonly erasedAt: string
  /** Who deleted it, or in whose name the pass did. */
  readonly erasedBy: string
  /** Whether the pass deleted it by itself. */
  readonly automatic: boolean
  /** How many values of it the change log blacked out. */
  readonly redactions: number
}

/** A kind the pass deletes by itself, in the name of who switched it on. */
export interface ErasureAutomation {
  readonly kind: ErasureKind
  readonly enabledBy: string
  readonly enabledAt: string
}

/** The most records one confirmation deletes. */
export const mostErasuresAtOnce = 200

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a confirmation asks for, once it is checked. */
export interface ErasureConfirmation {
  readonly kind: ErasureKind
  readonly ids: readonly string[]
}

/** Why a confirmation is not one, or null when it is. */
export function erasureConfirmationProblem(body: unknown): string | null {
  const { kind, ids } =
    typeof body === 'object' && body !== null ? (body as { kind?: unknown; ids?: unknown }) : {}

  if (typeof kind !== 'string' || !erasureKinds.includes(kind as ErasureKind)) {
    return 'Was gelöscht werden soll, ist keine Art des Löschkonzepts.'
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return 'Ausgewählt ist nichts.'
  }

  if (ids.length > mostErasuresAtOnce) {
    return `Auf einmal gehen höchstens ${String(mostErasuresAtOnce)}.`
  }

  if (!ids.every((id) => typeof id === 'string' && uuidPattern.test(id))) {
    return 'Eine Auswahl ist keine Kennung.'
  }

  if (new Set(ids.map((id) => (id as string).toLowerCase())).size !== ids.length) {
    return 'Eine Auswahl steht zweimal da.'
  }

  return null
}
