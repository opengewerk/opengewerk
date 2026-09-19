import type { InstallationId, IsoDate, SiteId, Synced } from './identifier.js'

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
}
