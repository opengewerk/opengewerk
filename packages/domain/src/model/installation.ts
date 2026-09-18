import type { InstallationId, IsoDate, SiteId, TenantOwned } from './identifier.js'

/**
 * What stands in a building and needs looking after. The inverter of a PV
 * system is not one of these: it sits below the system as a component, the
 * way the concept lays out the structure in section 3.2.
 */
export const installationKinds = [
  'pv_system',
  'meter_cabinet',
  'wallbox',
  'heating',
  'other',
] as const

export type InstallationKind = (typeof installationKinds)[number]

/**
 * A system in a building: PV, meter cabinet, wallbox, heating. Carries its own
 * history, its warranty and later its test records. Below it the trade
 * specific structure branches out, electrical or photovoltaic.
 */
export interface Installation extends TenantOwned {
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
