import {
  signaturePathIsValid,
  signerNameProblem,
  type Id,
  type IsoDate,
  type Synced,
} from '@opengewerk/platform-domain'

import type { DefectId, DefectStepId, InstallationId, JobId } from './identifier.js'

/**
 * A defect or a complaint (#311, Feature-Gliederung 4.11): what is wrong with
 * the work, at a job, at an installation or at both. The site records one at
 * the job without a network; the office records one at a job, and a complaint
 * after the acceptance at an installation.
 *
 * Its status is not a field that is written over. Reported is the defect
 * itself; every step after it is an entry of its own, with who took it and
 * when, and the database keeps the step the defect stands at for the queries
 * that need it, out of the same entries. Accepted asks for the customer's name
 * and signature on the device and is the last step: after it the defect
 * changes no more.
 */

/** The most a description may say, as much as a note. */
export const longestDefectDescription = 4000

/** The steps a defect takes after it is reported. */
export const defectSteps = ['in_progress', 'resolved', 'accepted'] as const

export type DefectStep = (typeof defectSteps)[number]

/** Where a defect stands: reported, or the last step it took. */
export const defectStatuses = ['reported', ...defectSteps] as const

export type DefectStatus = (typeof defectStatuses)[number]

export const defectStatusLabel: Readonly<Record<DefectStatus, string>> = {
  reported: 'Gemeldet',
  in_progress: 'In Bearbeitung',
  resolved: 'Behoben',
  accepted: 'Abgenommen',
}

/**
 * Which steps follow which: "in Bearbeitung" may be skipped, a remedy that
 * does not hold goes back to "in Bearbeitung", and only a remedied defect is
 * accepted. The database holds the same list in a trigger.
 */
export const nextDefectSteps: Readonly<Record<DefectStatus, readonly DefectStep[]>> = {
  reported: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: ['in_progress', 'accepted'],
  accepted: [],
}

export interface Defect extends Synced {
  readonly id: DefectId
  readonly jobId: JobId | null
  readonly installationId: InstallationId | null
  readonly description: string
  /** When it was reported, by the clock of the device it was recorded on. */
  readonly reportedAt: Date
  /** Who reported it, from the request; null for one out of an acceptance synced by nobody. */
  readonly createdBy: string | null
  /** The day by which the customer wants it remedied, where they set one. */
  readonly remedyDueOn: string | null
  /** The step it stands at, written by the database out of its steps. */
  readonly status: DefectStatus
  /** The signed acceptance whose reservation it is, and which line of it. */
  readonly acceptanceRecordId: Id<'form-record'> | null
  readonly acceptanceLine: number | null
}

/** A step of a defect: never written over, with who took it and when. */
export interface DefectStepEntry extends Synced {
  readonly id: DefectStepId
  readonly defectId: DefectId
  readonly step: DefectStep
  /** When it was taken, by the clock of the device. */
  readonly takenAt: Date
  readonly createdBy: string | null
  /** Only for "abgenommen": the customer who signed, and the signature. */
  readonly signerName: string | null
  readonly signaturePath: string | null
}

/** What is wrong with the description of a defect, as the sentence the form shows, or null. */
export function defectDescriptionProblem(text: unknown): string | null {
  if (typeof text !== 'string' || text.trim() === '') {
    return 'Ein Mangel braucht eine Beschreibung.'
  }

  if (text.length > longestDefectDescription) {
    return `Eine Beschreibung hat höchstens ${String(longestDefectDescription)} Zeichen.`
  }

  return null
}

/** What is wrong with a moment read off the clock of a device, or null. */
export function defectMomentProblem(moment: unknown): string | null {
  const read =
    moment instanceof Date ? moment : typeof moment === 'string' ? new Date(moment) : null

  return read && !Number.isNaN(read.getTime())
    ? null
    : 'Es fehlt die Uhrzeit, zu der es eingetragen wurde.'
}

const calendarDay = /^\d{4}-\d{2}-\d{2}$/

/** What is wrong with the customer's deadline: none, or a day of the calendar. */
export function remedyDueProblem(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const read =
    typeof value === 'string' && calendarDay.test(value) ? new Date(`${value}T00:00:00Z`) : null

  return read && !Number.isNaN(read.getTime()) && read.toISOString().slice(0, 10) === value
    ? null
    : 'Die Frist des Kunden ist ein Tag, etwa 19.11.2026.'
}

/** What is wrong with where a defect hangs: a job, an installation, or both. */
export function defectHomeProblem(jobId: unknown, installationId: unknown): string | null {
  return (typeof jobId === 'string' && jobId !== '') ||
    (typeof installationId === 'string' && installationId !== '')
    ? null
    : 'Ein Mangel hängt an einem Auftrag oder an einer Anlage.'
}

/**
 * What is wrong with the signature of a step, or null: the acceptance carries
 * the customer's name and signature, every other step neither. The database
 * checks the same.
 */
export function defectSignatureProblem(step: unknown, name: unknown, path: unknown): string | null {
  if (step !== 'accepted') {
    return (name === null || name === undefined) && (path === null || path === undefined)
      ? null
      : 'Unterschrieben wird nur die Abnahme eines Mangels.'
  }

  if (name === null || name === undefined) {
    return 'Die Abnahme braucht die Unterschrift des Kunden.'
  }

  return (
    signerNameProblem(name) ??
    (typeof path === 'string' && signaturePathIsValid(path)
      ? null
      : 'Die Abnahme braucht die Unterschrift des Kunden.')
  )
}

/**
 * What is wrong with a step after the status a defect stands at, or null: one
 * that does not follow, and for "abgenommen" the customer's name and signature.
 */
export function defectStepProblem(
  from: DefectStatus,
  step: DefectStep,
  signer: { readonly name: unknown; readonly path: unknown } | null,
): string | null {
  if (!nextDefectSteps[from].includes(step)) {
    return from === 'accepted'
      ? 'Der Mangel ist abgenommen und ändert sich nicht mehr.'
      : `Auf „${defectStatusLabel[from]}“ folgt nicht „${defectStatusLabel[step]}“.`
  }

  return defectSignatureProblem(step, signer?.name ?? null, signer?.path ?? null)
}

/**
 * Where a defect stands out of its steps: the last one taken, by the clocks of
 * the devices, and reported where it has none. The same answer the database
 * keeps, as long as no two devices took a step at once without a network.
 */
export function defectStatusOf(
  steps: readonly { readonly step: string; readonly takenAt: string | Date; readonly id: string }[],
): DefectStatus {
  const last = [...steps]
    .sort(
      (left, right) =>
        String(
          left.takenAt instanceof Date ? left.takenAt.toISOString() : left.takenAt,
        ).localeCompare(
          String(right.takenAt instanceof Date ? right.takenAt.toISOString() : right.takenAt),
        ) || left.id.localeCompare(right.id),
    )
    .at(-1)

  return last && (defectSteps as readonly string[]).includes(last.step)
    ? (last.step as DefectStep)
    : 'reported'
}

/** Whether a defect is still to be remedied: reported or in progress. */
export function defectIsOpen(status: DefectStatus): boolean {
  return status === 'reported' || status === 'in_progress'
}

/**
 * Whether the day a defect was reported lies within the warranty (#311):
 * before the acceptance, which a reservation of the acceptance is as well,
 * within it, or after it ended. Null where there is no warranty to speak of.
 */
export type DefectWarranty =
  | { readonly kind: 'before_acceptance' }
  | { readonly kind: 'within'; readonly endsOn: IsoDate }
  | { readonly kind: 'after'; readonly endedOn: IsoDate }

/**
 * The warranty a defect is measured against: the one out of the acceptance of
 * its job, else the one of its installation, out of the acceptance of a job
 * there or, where none, the end typed in at the installation, which has no
 * day of acceptance.
 */
export interface WarrantyWindow {
  readonly acceptedOn: IsoDate | null
  readonly endsOn: IsoDate
}

export function defectWarranty(
  reportedOn: IsoDate,
  fromAcceptance: boolean,
  warranty: WarrantyWindow | null,
): DefectWarranty | null {
  if (warranty === null) {
    return null
  }

  if (fromAcceptance || (warranty.acceptedOn !== null && reportedOn < warranty.acceptedOn)) {
    return { kind: 'before_acceptance' }
  }

  return reportedOn <= warranty.endsOn
    ? { kind: 'within', endsOn: warranty.endsOn }
    : { kind: 'after', endedOn: warranty.endsOn }
}

function dayText(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** How the screens and the report say it: "In der Gewährleistung bis 05.11.2031", or null before the acceptance. */
export function defectWarrantyText(warranty: DefectWarranty | null): string | null {
  if (warranty === null || warranty.kind === 'before_acceptance') {
    return null
  }

  return warranty.kind === 'within'
    ? `In der Gewährleistung bis ${dayText(warranty.endsOn)}`
    : `Nach dem Ende der Gewährleistung am ${dayText(warranty.endedOn)}`
}
