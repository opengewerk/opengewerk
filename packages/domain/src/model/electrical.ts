import type {
  BoardSectionId,
  CircuitId,
  DistributionBoardId,
  EquipmentId,
  InstallationId,
  TenantOwned,
} from './identifier.js'

/**
 * The electrical structure below an installation: board, section, circuit,
 * equipment. It exists now because two things later hang off it that cannot
 * hang off anything else, the test records under VDE 0100-600 and 0105-100,
 * whose readings are taken per circuit, and the circuit chart printed for the
 * distribution board.
 *
 * What is here is the structure and what identifies a part. The technical
 * attributes per circuit (fuse, RCD, cable) and the measured values arrive
 * with the circuit chart and the test records. Migrations are immutable once
 * merged, so those columns get added, not rewritten.
 */

export const distributionBoardKinds = [
  /** Niederspannungshauptverteilung. */
  'main_distribution',
  /** Unterverteilung. */
  'sub_distribution',
  'meter_cabinet',
] as const

export type DistributionBoardKind = (typeof distributionBoardKinds)[number]

export interface DistributionBoard extends TenantOwned {
  readonly id: DistributionBoardId
  readonly installationId: InstallationId
  readonly kind: DistributionBoardKind
  /** `HV`, `UV Küche`, whatever is written on the door. */
  readonly designation: string
  /** Where it hangs: `Keller, Raum 2`. */
  readonly location: string | null
  readonly position: number
}

/**
 * A section of a board. Large boards are divided into them, a small sub
 * distribution is not, which is why a circuit may point straight at its board.
 */
export interface BoardSection extends TenantOwned {
  readonly id: BoardSectionId
  readonly distributionBoardId: DistributionBoardId
  readonly designation: string
  readonly position: number
}

export interface Circuit extends TenantOwned {
  readonly id: CircuitId
  readonly distributionBoardId: DistributionBoardId
  /** Set when the board is divided into sections, null when it is not. */
  readonly boardSectionId: BoardSectionId | null
  /** `F3`, `Steckdosen Bad`. */
  readonly designation: string
  readonly position: number
}

/** A device on a circuit: socket, luminaire, motor, whatever is connected. */
export interface Equipment extends TenantOwned {
  readonly id: EquipmentId
  readonly circuitId: CircuitId
  readonly designation: string
  readonly kind: string | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  readonly position: number
}
