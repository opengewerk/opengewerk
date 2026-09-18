import type {
  InstallationId,
  InverterId,
  PvModuleId,
  PvStringId,
  TenantOwned,
} from './identifier.js'

/**
 * The photovoltaic structure below an installation: inverter, string, module.
 * The same reasoning as for the electrical side, section 3.2 of the concept
 * calls it out as the analogous case. Yield data, storage, meters and the
 * wallbox are not here: the first is monitoring, the rest are installations of
 * their own.
 */

export interface Inverter extends TenantOwned {
  readonly id: InverterId
  readonly installationId: InstallationId
  readonly designation: string
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  readonly position: number
}

/** One string of modules on an inverter input. */
export interface PvString extends TenantOwned {
  readonly id: PvStringId
  readonly inverterId: InverterId
  readonly designation: string
  readonly position: number
}

export interface PvModule extends TenantOwned {
  readonly id: PvModuleId
  readonly pvStringId: PvStringId
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  readonly position: number
}
