import { milliText, type Synced } from '@opengewerk/platform-domain'

import type { ApplianceId, SiteId } from './identifier.js'

/**
 * The protection classes of an appliance, which decide what its test after DGUV
 * Vorschrift 3 measures and against which limit (#303): class I has a
 * protective conductor, class II double insulation and none, class III runs
 * on protective extra-low voltage.
 */
export const protectionClasses = ['I', 'II', 'III'] as const

export type ProtectionClass = (typeof protectionClasses)[number]

/**
 * Whether an appliance is carried about or stays where it is: portable equipment
 * comes under table 1B of the DGUV Vorschrift 3, fixed equipment under 1A.
 */
export const applianceMobilities = ['portable', 'fixed'] as const

export type ApplianceMobility = (typeof applianceMobilities)[number]

/** How the register and the report name it. */
export const applianceMobilityLabel: Readonly<Record<ApplianceMobility, string>> = {
  portable: 'ortsveränderlich',
  fixed: 'ortsfest',
}

/**
 * An appliance that hangs on no circuit (#303): the drill, the coffee machine,
 * the extension lead, a washing machine. It belongs to a site, as the register
 * of section 3.2 of the concept lists it, and carries its test protocols as an
 * installation does. "Gerät" on screen and paper, an appliance in the code:
 * a device is the phone or tablet of the sync, and every synced table keeps
 * the one that wrote it last as `device_id`.
 */
export interface Appliance extends Synced {
  readonly id: ApplianceId
  readonly siteId: SiteId
  /** The number on its test label, as the business keeps it. */
  readonly inventoryNumber: string | null
  readonly designation: string
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  readonly protectionClass: ProtectionClass
  readonly mobility: ApplianceMobility
  /** Where it stands or is kept. */
  readonly location: string | null
  /**
   * The length of its lead in millimetres, which the limit of the protective
   * conductor resistance counts with; null where nobody entered it, and the
   * limit is then the one for up to 5 metres.
   */
  readonly cordLengthMilli: number | null
  readonly notes: string | null
}

/** What the limits of a test are worked out from: the protection class and the lead. */
export type ApplianceFacts = Pick<Appliance, 'protectionClass' | 'cordLengthMilli'>

/** Whether a value is what a limit of an appliance's test is worked out from. */
export function isApplianceFacts(value: unknown): value is ApplianceFacts {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const facts = value as Record<string, unknown>
  const length = facts['cordLengthMilli']

  return (
    (protectionClasses as readonly unknown[]).includes(facts['protectionClass']) &&
    (length === null || (typeof length === 'number' && Number.isInteger(length) && length > 0))
  )
}

/** The longest lead an appliance can have, a kilometre, in millimetres; the database holds the same. */
export const longestCordMilli = 1_000_000

/** What is wrong with the fields of an appliance, by field, in the words of the form. */
export function applianceProblems(appliance: {
  readonly designation?: unknown
  readonly cordLengthMilli?: unknown
}): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  if ('designation' in appliance) {
    const designation = appliance.designation

    if (typeof designation !== 'string' || designation.trim() === '') {
      problems['designation'] = 'Ein Gerät braucht eine Bezeichnung.'
    }
  }

  const length = appliance.cordLengthMilli

  if (
    length !== undefined &&
    length !== null &&
    !(
      typeof length === 'number' &&
      Number.isInteger(length) &&
      length >= 1 &&
      length <= longestCordMilli
    )
  ) {
    problems['cordLengthMilli'] = 'Die Länge ist größer als 0 und höchstens 1000 m.'
  }

  return problems
}

/** The length of the lead as it is read: "1,2 m", or null where none is known. */
export function cordLengthText(appliance: Pick<Appliance, 'cordLengthMilli'>): string | null {
  return appliance.cordLengthMilli === null ? null : `${milliText(appliance.cordLengthMilli)} m`
}

/**
 * An appliance as a list, a task and the paper name it: its inventory number
 * before its designation, "005 Kaffeemaschine", or the designation alone.
 */
export function applianceLabel(
  appliance: Pick<Appliance, 'inventoryNumber' | 'designation'>,
): string {
  const number = appliance.inventoryNumber?.trim() ?? ''

  return number === '' ? appliance.designation : `${number} ${appliance.designation}`
}

/**
 * An appliance with what its limits are worked out from, as the head of a
 * protocol names it: "005 Kaffeemaschine, Schutzklasse I, Anschlussleitung
 * 1,2 m".
 */
export function applianceSubject(
  appliance: Pick<
    Appliance,
    'inventoryNumber' | 'designation' | 'protectionClass' | 'cordLengthMilli'
  >,
): string {
  const lead = cordLengthText(appliance)

  return [
    applianceLabel(appliance),
    `Schutzklasse ${appliance.protectionClass}`,
    ...(lead === null ? [] : [`Anschlussleitung ${lead}`]),
  ].join(', ')
}
