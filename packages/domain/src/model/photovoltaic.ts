import type { InstallationKind } from './installation.js'
import type { InstallationId, InverterId, PvModuleId, PvStringId, Synced } from './identifier.js'

/**
 * The photovoltaic structure below an installation: inverter, string, module.
 * The same reasoning as for the electrical side, section 3.2 of the concept
 * calls it out as the analogous case. Yield data is not here, that is
 * monitoring; storage, meters and the wallbox are installations of their own,
 * which say which PV system they belong to and at which inverter they hang
 * (#300).
 *
 * Power is kept in watts, whole numbers: the inverter at the grid, "10,0 kW"
 * as 10000, a module at its rated peak, "400 Wp" as 400. Nothing on a PV
 * system needs less than a watt, and a whole number compares and adds up
 * without a question of rounding.
 */

export interface Inverter extends Synced {
  readonly id: InverterId
  readonly installationId: InstallationId
  readonly designation: string
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  /** Its rated power at the grid, in watts. */
  readonly ratedPowerW: number | null
  /** How many strings it tracks apart, its MPP inputs. */
  readonly mppInputs: number | null
  readonly position: number
}

/** One string of modules on an inverter input. */
export interface PvString extends Synced {
  readonly id: PvStringId
  readonly inverterId: InverterId
  readonly designation: string
  /** The MPP input of its inverter it is on, from 1. */
  readonly mppInput: number | null
  /** Where it faces, in degrees from north: 0 north, 90 east, 180 south, 270 west. */
  readonly azimuthDeg: number | null
  /** How steep it is, in degrees: 0 flat, 90 upright. */
  readonly tiltDeg: number | null
  readonly position: number
}

export interface PvModule extends Synced {
  readonly id: PvModuleId
  readonly pvStringId: PvStringId
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  /** Its rated peak power, in watts peak. */
  readonly ratedPowerW: number | null
  readonly position: number
}

/** The kinds of installation that may say they belong to a PV system (#300). */
export const pvCompanionKinds: readonly InstallationKind[] = ['battery', 'meter', 'wallbox']

/** Whether an installation of this kind can belong to a PV system. */
export function belongsToPvSystemKind(kind: unknown): boolean {
  return pvCompanionKinds.includes(kind as InstallationKind)
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Why an installation of this kind cannot name a PV system, or null. The
 * form offers the choice only for these kinds and clears it when the kind
 * changes; the check in the database says the same.
 */
export function pvSystemLinkProblem(kind: unknown, pvSystemId: unknown): string | null {
  return !isSet(pvSystemId) || belongsToPvSystemKind(kind)
    ? null
    : 'Zu einer PV-Anlage gehören nur Speicher, Zähler und Wallbox.'
}

/** Why an installation cannot name this inverter, or null: only together with its PV system. */
export function inverterLinkProblem(pvSystemId: unknown, inverterId: unknown): string | null {
  return !isSet(inverterId) || isSet(pvSystemId)
    ? null
    : 'An einem Wechselrichter hängt nur, was zu seiner PV-Anlage gehört.'
}

/**
 * The largest value each figure may take. A house has a few kilowatts, a
 * commercial roof a few hundred; ten megawatts leaves room for the largest
 * a craft business builds and still catches a figure typed in watts where
 * kilowatts were asked. A module of two kilowatts peak does not exist.
 */
export const pvLimits = {
  inverterRatedPowerW: 10_000_000,
  mppInputs: 24,
  moduleRatedPowerW: 2_000,
} as const

function wholeFromTo(value: unknown, least: number, most: number): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most)
  )
}

/**
 * What is wrong with the figures of an inverter, one sentence per field,
 * empty when nothing is. One function for the form, the sync and the
 * database's own check, as for a circuit.
 */
export function inverterProblems(
  inverter: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  if (!wholeFromTo(inverter['ratedPowerW'], 1, pvLimits.inverterRatedPowerW)) {
    problems['ratedPowerW'] = 'Die Nennleistung ist größer als 0 und höchstens 10000 kW.'
  }

  if (!wholeFromTo(inverter['mppInputs'], 1, pvLimits.mppInputs)) {
    problems['mppInputs'] = 'Die MPP-Eingänge sind eine ganze Zahl von 1 bis 24.'
  }

  return problems
}

/** What is wrong with the figures of a string, one sentence per field. */
export function pvStringProblems(
  pvString: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  if (!wholeFromTo(pvString['mppInput'], 1, pvLimits.mppInputs)) {
    problems['mppInput'] = 'Der MPP-Eingang ist eine ganze Zahl von 1 bis 24.'
  }

  if (!wholeFromTo(pvString['azimuthDeg'], 0, 359)) {
    problems['azimuthDeg'] =
      'Die Ausrichtung ist eine ganze Zahl von 0 bis 359 Grad: 0 Nord, 90 Ost, 180 Süd, 270 West.'
  }

  if (!wholeFromTo(pvString['tiltDeg'], 0, 90)) {
    problems['tiltDeg'] = 'Die Neigung ist eine ganze Zahl von 0 bis 90 Grad.'
  }

  return problems
}

/** What is wrong with the figures of a module, one sentence per field. */
export function pvModuleProblems(
  pvModule: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  if (!wholeFromTo(pvModule['ratedPowerW'], 1, pvLimits.moduleRatedPowerW)) {
    problems['ratedPowerW'] = 'Die Leistung eines Moduls ist größer als 0 und höchstens 2000 Wp.'
  }

  return problems
}

const kilowatts = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const kilowattsPeak = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** The power of an inverter as a plate reads it: 10000 as "10,0 kW". */
export function inverterPowerText(watts: number): string {
  return `${kilowatts.format(watts / 1000)} kW`
}

/** The peak power of modules together: 4800 as "4,80 kWp". */
export function peakPowerText(watts: number): string {
  return `${kilowattsPeak.format(watts / 1000)} kWp`
}

/** The peak power of one module: 400 as "400 Wp". */
export function modulePowerText(watts: number): string {
  return `${String(watts)} Wp`
}

const compass = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'] as const

/** Where a string faces in words and degrees: 270 as "West, 270°". */
export function azimuthText(degrees: number): string {
  return `${compass[Math.round(degrees / 45) % 8] ?? 'Nord'}, ${String(degrees)}°`
}

/** The short form for a line: 270 as "West". */
export function azimuthName(degrees: number): string {
  return compass[Math.round(degrees / 45) % 8] ?? 'Nord'
}

/**
 * The peak power of these modules together, in watts, and how many of them
 * have none. A string with some modules without a figure says both, so that
 * nobody reads a sum over half the modules as the string's power.
 */
export function peakPower(modules: readonly { readonly ratedPowerW: number | null }[]): {
  readonly watts: number
  readonly unknown: number
} {
  let watts = 0
  let unknown = 0

  for (const module of modules) {
    if (module.ratedPowerW === null) {
      unknown += 1
    } else {
      watts += module.ratedPowerW
    }
  }

  return { watts, unknown }
}

/** The order modules are listed in on a string: where somebody put them, then the id. */
export function inModuleOrder(
  left: { readonly id: string; readonly position: number },
  right: { readonly id: string; readonly position: number },
): number {
  return left.position - right.position || left.id.localeCompare(right.id)
}

/** How many modules one "Module anlegen" may add at once. */
export const moduleBatchMax = 100
