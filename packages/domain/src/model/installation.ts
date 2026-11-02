import type {
  DistributionBoard,
  Inverter,
  InverterId,
  IsoDate,
  Synced,
} from '@opengewerk/platform-domain'

import type { GridOperatorId, InstallationId, SiteId } from './identifier.js'

/**
 * What stands in a building and needs looking after. The inverter of a PV
 * system is not one of these: it sits below the system as a component, the
 * way the concept lays out the structure in section 3.2. Storage, meters and
 * the wallbox go the other way round, the same section puts them beside the PV
 * system rather than below it, so each one gets a kind here instead of falling
 * to `other` and losing what it is.
 */
export const installationKinds = [
  'pv_system',
  'battery',
  /** The meter itself, wherever it hangs. */
  'meter',
  /** The cabinet, not the meter inside it, and not a distribution board. */
  'meter_cabinet',
  'wallbox',
  'heating',
  'other',
] as const

export type InstallationKind = (typeof installationKinds)[number]

/** How the screens and the report of a site (#302) name it. */
export const installationKindLabel: Readonly<Record<InstallationKind, string>> = {
  pv_system: 'PV-Anlage',
  battery: 'Speicher',
  meter: 'Zähler',
  meter_cabinet: 'Zählerschrank',
  wallbox: 'Wallbox',
  heating: 'Heizung',
  other: 'Sonstige',
}

/**
 * A system in a building: PV, storage, meter, meter cabinet, wallbox, heating.
 * Carries its own history, its warranty and later its test records. Below it
 * the trade specific structure branches out, electrical or photovoltaic.
 */
export interface Installation extends Synced {
  readonly id: InstallationId
  readonly siteId: SiteId
  readonly kind: InstallationKind
  readonly designation: string
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  readonly commissionedOn: IsoDate | null
  /** End of the warranty period, watched by the deadline engine later. */
  readonly warrantyEndsOn: IsoDate | null
  readonly notes: string | null
  /**
   * The PV system a battery, meter or wallbox belongs to, at the same site
   * (#300). Storage and the rest stay installations of their own, as section
   * 3.2 of the concept puts them beside the PV system rather than below it,
   * and say here where they belong.
   */
  readonly pvSystemId: InstallationId | null
  /** The inverter of that PV system it hangs at, where it hangs at one. */
  readonly inverterId: InverterId | null
  /**
   * What a PV system is planned to yield in a year, in kilowatt hours, typed
   * in from its planning with its source (#305). OpenGewerk asks no service
   * on the internet for it.
   */
  readonly yieldForecastKwh: number | null
  /** Where the forecast comes from: the planning software and its day. */
  readonly yieldForecastSource: string | null
  /**
   * The grid operator a PV system, or a battery or wallbox of its own, is
   * reported to (#306), and the number it is known by there. Kept at the desk
   * and carried to the device only as part of the installation.
   */
  readonly gridOperatorId: GridOperatorId | null
  readonly gridOperatorReference: string | null
}

/** The largest forecast of a year a PV system can have, a hundred gigawatt hours. */
export const largestYieldForecastKwh = 100_000_000

/** What is wrong with a forecast of the yield, or nothing: a whole number of kilowatt hours above none (#305). */
export function yieldForecastProblem(value: unknown): string | null {
  return value === null ||
    value === undefined ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= largestYieldForecastKwh)
    ? null
    : 'Die Ertragsprognose ist eine ganze Zahl von Kilowattstunden im Jahr.'
}

/**
 * A board of this application: the foundation's board (ADR 0014), hanging on
 * an installation.
 */
export interface InstallationBoard extends DistributionBoard {
  readonly installationId: InstallationId
}

/** An inverter of this application, hanging on the installation that is its PV system. */
export interface InstallationInverter extends Inverter {
  readonly installationId: InstallationId
}
