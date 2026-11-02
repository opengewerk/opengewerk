import type { IsoDate } from '@opengewerk/platform-domain'

import type { GridOperatorId } from './identifier.js'
import type { InstallationKind } from './installation.js'

/**
 * A grid operator the business works with (#306, Feature-Gliederung 5.1): a
 * record of its own like a supplier, with what the operator asks for, its
 * portal and a person to ask there. Beside that the entry of the business in
 * the operator's installer directory, with its number, the last day it holds
 * and the electrician who answers for it; before that day a deadline reminds,
 * as with a qualification.
 *
 * Kept at the desk: it goes to no device. Whoever may see an installation
 * prints its papers, which name the operator, without the right to the list.
 */
export interface GridOperator {
  readonly id: GridOperatorId
  readonly name: string
  /** Where it takes applications, an address on the web. */
  readonly portalUrl: string | null
  /** Its forms and papers in its own words, printed on top of every application. */
  readonly requirements: string | null
  readonly contactName: string | null
  readonly contactEmail: string | null
  readonly contactPhone: string | null
  /** The number of the business in the operator's installer directory. */
  readonly registrationNumber: string | null
  /** The last day the entry holds; null where it holds without an end. */
  readonly registeredUntil: IsoDate | null
  /** The responsible electrician the entry names. */
  readonly responsibleElectrician: string | null
}

/** The longest each text may be, as the checks in the database hold them. */
export const gridOperatorLimits = {
  name: 200,
  portalUrl: 500,
  requirements: 2000,
  contact: 200,
  registrationNumber: 64,
  /** The number an installation is known by at its grid operator. */
  reference: 100,
} as const

/** The texts of a grid operator, and the longest each may be. */
const textLimits: Readonly<Record<string, number>> = {
  portalUrl: gridOperatorLimits.portalUrl,
  requirements: gridOperatorLimits.requirements,
  contactName: gridOperatorLimits.contact,
  contactEmail: gridOperatorLimits.contact,
  contactPhone: gridOperatorLimits.contact,
  registrationNumber: gridOperatorLimits.registrationNumber,
  responsibleElectrician: gridOperatorLimits.contact,
}

const calendarDay = /^\d{4}-\d{2}-\d{2}$/

function isDay(value: unknown): boolean {
  if (typeof value !== 'string' || !calendarDay.test(value)) {
    return false
  }

  const at = new Date(`${value}T00:00:00Z`)

  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value
}

/**
 * What is wrong with a grid operator as the office keeps it, by field, empty
 * when nothing is (#306). Only the fields present are judged, so that a change
 * of one field is not refused for another nobody touched; an empty text is
 * null, as the form sends it. A last day needs the number of the entry it
 * belongs to: without one, no deadline could say what runs out.
 */
export function gridOperatorProblems(
  operator: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  if ('name' in operator) {
    const name = operator['name']

    if (typeof name !== 'string' || name.trim() === '') {
      problems['name'] = 'Ein Netzbetreiber braucht einen Namen.'
    } else if (name.trim().length > gridOperatorLimits.name) {
      problems['name'] = `Ein Name hat höchstens ${String(gridOperatorLimits.name)} Zeichen.`
    }
  }

  for (const [field, limit] of Object.entries(textLimits)) {
    const value = operator[field]

    if (value !== undefined && value !== null && typeof value !== 'string') {
      problems[field] = 'Hier steht Text.'
    } else if (typeof value === 'string' && value.length > limit) {
      problems[field] = `Hier stehen höchstens ${String(limit)} Zeichen.`
    }
  }

  const portal = operator['portalUrl']

  // A host with a dot after the scheme, and nothing with a space: an address a
  // browser opens, not a sentence. The form puts "https://" before a bare host.
  if (
    typeof portal === 'string' &&
    problems['portalUrl'] === undefined &&
    !/^https?:\/\/[^\s/?#.]+(\.[^\s/?#.]+)+([/?#]\S*)?$/i.test(portal)
  ) {
    problems['portalUrl'] = 'Das Portal ist eine Adresse, die mit https:// beginnt.'
  }

  const email = operator['contactEmail']

  if (
    typeof email === 'string' &&
    problems['contactEmail'] === undefined &&
    !/^[^\s@]+@[^\s@]+$/.test(email)
  ) {
    problems['contactEmail'] = 'Diese E-Mail-Adresse ist unvollständig.'
  }

  const until = operator['registeredUntil']

  if (until !== undefined && until !== null && !isDay(until)) {
    problems['registeredUntil'] = 'Gültig bis ist ein Tag des Kalenders.'
  } else if (
    typeof until === 'string' &&
    'registrationNumber' in operator &&
    (typeof operator['registrationNumber'] !== 'string' ||
      operator['registrationNumber'].trim() === '')
  ) {
    problems['registeredUntil'] = 'Ein letzter Tag gehört zu einer Eintragung mit Nummer.'
  }

  return problems
}

/**
 * The kinds of installation that name a grid operator (#306): a PV system,
 * a battery and a wallbox, which the operator has to be told about. A battery
 * or a wallbox that belongs to a PV system goes with the papers of the system.
 */
export const gridOperatorKinds: readonly InstallationKind[] = ['pv_system', 'battery', 'wallbox']

/** Whether an installation of this kind names a grid operator. */
export function namesGridOperator(kind: unknown): boolean {
  return gridOperatorKinds.includes(kind as InstallationKind)
}

/**
 * Whether an installation stands on its own before its grid operator: a PV
 * system, or a battery or wallbox that belongs to none. Only these name one
 * in the form and have papers of their own; what belongs to a PV system is on
 * the papers of the system.
 */
export function reportsToGridOperator(kind: unknown, pvSystemId: unknown): boolean {
  return namesGridOperator(kind) && (pvSystemId === null || pvSystemId === undefined)
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Why an installation of this kind cannot name a grid operator, or null. The
 * form offers the choice only for these kinds; the check in the database says
 * the same.
 */
export function gridOperatorLinkProblem(kind: unknown, gridOperatorId: unknown): string | null {
  return !isSet(gridOperatorId) || namesGridOperator(kind)
    ? null
    : 'Einen Netzbetreiber nennt nur eine PV-Anlage, ein Speicher oder eine Wallbox.'
}

/** Why the number at the grid operator cannot be kept, or null. */
export function gridOperatorReferenceProblem(reference: unknown): string | null {
  if (!isSet(reference)) {
    return null
  }

  return typeof reference === 'string' && reference.length <= gridOperatorLimits.reference
    ? null
    : `Die Kennung beim Netzbetreiber hat höchstens ${String(gridOperatorLimits.reference)} Zeichen.`
}

/** Whether the entry of the business in this operator's directory holds on that day. */
export function registrationHolds(
  operator: Pick<GridOperator, 'registrationNumber' | 'registeredUntil'>,
  on: IsoDate,
): boolean {
  return (
    isSet(operator.registrationNumber?.trim()) &&
    (operator.registeredUntil === null || operator.registeredUntil >= on)
  )
}

/**
 * The entry in an installer directory the papers for a grid operator name
 * (#306): the one at that operator where it holds, and otherwise another that
 * still holds, the longest first. § 13 Abs. 2 NAV lets a business work on an
 * installation with the entry in the directory of any grid operator. Null
 * where no entry holds, and the papers then say so.
 */
export function registrationFor<T extends GridOperator>(
  operators: readonly T[],
  operatorId: GridOperatorId | null,
  on: IsoDate,
): T | null {
  const own = operators.find((operator) => operator.id === operatorId)

  if (own && registrationHolds(own, on)) {
    return own
  }

  const others = operators
    .filter((operator) => operator.id !== operatorId && registrationHolds(operator, on))
    .sort(
      (left, right) =>
        // Without an end first, then the one that holds longest, then by name.
        Number(left.registeredUntil !== null) - Number(right.registeredUntil !== null) ||
        (right.registeredUntil ?? '').localeCompare(left.registeredUntil ?? '') ||
        left.name.localeCompare(right.name, 'de'),
    )

  return others[0] ?? null
}
