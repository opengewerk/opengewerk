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
  /**
   * End of the warranty period as typed in, for an installation without an
   * acceptance. Where a job at it has a signed acceptance, the warranty
   * follows from that (#310) and the screens say so.
   */
  readonly warrantyEndsOn: IsoDate | null
  /** The last day of a guarantee of the manufacturer, apart from the warranty of the business (#310). */
  readonly manufacturerWarrantyEndsOn: IsoDate | null
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
  /**
   * What a battery delivers of its charge, in watt hours, and the power a
   * battery or a wallbox is rated for, in watts, from the data sheet (#307).
   * The papers for the grid operator, the register and a funding programme
   * name them, and a commissioning protocol starts with them.
   */
  readonly usableCapacityWh: number | null
  readonly ratedPowerW: number | null
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

/** The kinds that name a usable capacity, and those that name a rated power (#307). */
export const capacityKinds: readonly InstallationKind[] = ['battery']
export const ratedPowerKinds: readonly InstallationKind[] = ['battery', 'wallbox']

/** The largest capacity and power an installation names: a hundred megawatt hours, a hundred megawatts. */
export const largestRating = 100_000_000

/**
 * What is wrong with the usable capacity or the rated power of an
 * installation, or nothing (#307): a whole number of watt hours or watts
 * above none, at a kind that has it. As `installations_ratings` holds.
 */
export function ratingProblem(
  field: 'usableCapacityWh' | 'ratedPowerW',
  kind: unknown,
  value: unknown,
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const capacity = field === 'usableCapacityWh'

  if (!(capacity ? capacityKinds : ratedPowerKinds).includes(kind as InstallationKind)) {
    return capacity
      ? 'Eine nutzbare Kapazität nennt nur ein Speicher.'
      : 'Eine Bemessungsleistung nennen nur ein Speicher und eine Wallbox.'
  }

  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= largestRating
    ? null
    : capacity
      ? 'Die nutzbare Kapazität ist größer als null und höchstens 100.000 kWh.'
      : 'Die Bemessungsleistung ist größer als null und höchstens 100.000 kW.'
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
