import {
  cableInstallationMethods,
  distributionBoardKinds,
  overcurrentDevices,
  rcdTypes,
  tripCharacteristics,
} from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { type OwnColumns, ownColumnsOf, type OwnTable, type TableWithOwn } from './own-columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

// The electrical structure as a building block (ADR 0014): board, section,
// circuit, equipment. Tables an application makes with this function, under
// the names they had before they moved here, so that a database made by an
// older migration of an application is the database this schema describes.
// What a board hangs on is a column of the application's own, with its key.

export const distributionBoardKind = pgEnum('distribution_board_kind', distributionBoardKinds)
export const overcurrentDevice = pgEnum('overcurrent_device', overcurrentDevices)
export const tripCharacteristic = pgEnum('trip_characteristic', tripCharacteristics)
export const rcdType = pgEnum('rcd_type', rcdTypes)
export const cableInstallationMethod = pgEnum('cable_installation_method', cableInstallationMethods)

function boardParts() {
  return {
    id: primaryId<'distribution-board'>(),
    ...tenantColumn,
    kind: distributionBoardKind('kind').notNull(),
    designation: text('designation').notNull(),
    location: text('location'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  }
}

function sectionParts() {
  return {
    id: primaryId<'board-section'>(),
    ...tenantColumn,
    distributionBoardId: reference<'distribution-board'>('distribution_board_id').notNull(),
    designation: text('designation').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  }
}

function circuitParts() {
  return {
    id: primaryId<'circuit'>(),
    ...tenantColumn,
    distributionBoardId: reference<'distribution-board'>('distribution_board_id').notNull(),
    boardSectionId: reference<'board-section'>('board_section_id'),
    designation: text('designation').notNull(),
    consumer: text('consumer'),
    overcurrentDevice: overcurrentDevice('overcurrent_device'),
    tripCharacteristic: tripCharacteristic('trip_characteristic'),
    ratedCurrentMilli: integer('rated_current_milli'),
    rcdType: rcdType('rcd_type'),
    ratedResidualCurrentMilli: integer('rated_residual_current_milli'),
    cableType: text('cable_type'),
    cableCores: integer('cable_cores'),
    cableCrossSectionMilli: integer('cable_cross_section_milli'),
    cableLengthMilli: integer('cable_length_milli'),
    cableInstallationMethod: cableInstallationMethod('cable_installation_method'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  }
}

function equipmentParts() {
  return {
    id: primaryId<'equipment'>(),
    ...tenantColumn,
    circuitId: reference<'circuit'>('circuit_id').notNull(),
    designation: text('designation').notNull(),
    kind: text('kind'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  }
}

/** The columns every table of boards has, whatever an application hangs a board on. */
export type BoardColumns = ReturnType<typeof boardParts>
export type SectionColumns = ReturnType<typeof sectionParts>
export type CircuitColumns = ReturnType<typeof circuitParts>
export type EquipmentColumns = ReturnType<typeof equipmentParts>

/** The tables of the electrical structure of an application. */
export interface ElectricalTables<
  OwnBoard extends OwnColumns = Record<never, never>,
  OwnSection extends OwnColumns = Record<never, never>,
  OwnCircuit extends OwnColumns = Record<never, never>,
  OwnEquipment extends OwnColumns = Record<never, never>,
> {
  readonly distributionBoardKind: typeof distributionBoardKind
  readonly overcurrentDevice: typeof overcurrentDevice
  readonly tripCharacteristic: typeof tripCharacteristic
  readonly rcdType: typeof rcdType
  readonly cableInstallationMethod: typeof cableInstallationMethod
  readonly distributionBoards: TableWithOwn<'distribution_boards', BoardColumns, OwnBoard>
  readonly boardSections: TableWithOwn<'board_sections', SectionColumns, OwnSection>
  readonly circuits: TableWithOwn<'circuits', CircuitColumns, OwnCircuit>
  readonly equipment: TableWithOwn<'equipment', EquipmentColumns, OwnEquipment>
}

/**
 * What an application says about its electrical structure: at every table
 * columns and constraints of its own. At the boards that is what they hang
 * on, at the others whatever the application keeps on every record with a
 * place.
 */
export interface ElectricalOptions<
  OwnBoard extends OwnColumns,
  OwnSection extends OwnColumns,
  OwnCircuit extends OwnColumns,
  OwnEquipment extends OwnColumns,
> {
  readonly boards?: OwnTable<'distribution_boards', BoardColumns, OwnBoard>
  readonly sections?: OwnTable<'board_sections', SectionColumns, OwnSection>
  readonly circuits?: OwnTable<'circuits', CircuitColumns, OwnCircuit>
  readonly equipment?: OwnTable<'equipment', EquipmentColumns, OwnEquipment>
}

/**
 * The electrical structure of an application (ADR 0014): four tables with
 * the columns of the application's own. Called without options it is the
 * structure as the foundation knows it, hanging on nothing.
 *
 * Every part of the structure hangs on its parent through the tenant as well
 * as the id, and that is what keeps it in the tenant it was made in. A key on
 * the id alone would not. PostgreSQL checks a foreign key past row level
 * security, so a device of one tenant that sends the id of another tenant's
 * board gets a circuit accepted under it: invisible to the other side, but
 * hanging on its board, taken along when that board is removed, and in the
 * way when it should be. With the tenant in the key the parent has to be in
 * the same tenant, and the policy already sees to it that the row itself is.
 * The unique keys over tenant and id look redundant next to the primary
 * keys, and they are what these keys point at. The key of a board on what it
 * hangs on is the application's, and should be built the same way.
 */
export function electricalSchema<
  OwnBoard extends OwnColumns = Record<never, never>,
  OwnSection extends OwnColumns = Record<never, never>,
  OwnCircuit extends OwnColumns = Record<never, never>,
  OwnEquipment extends OwnColumns = Record<never, never>,
>(
  options: ElectricalOptions<OwnBoard, OwnSection, OwnCircuit, OwnEquipment> = {},
): ElectricalTables<OwnBoard, OwnSection, OwnCircuit, OwnEquipment> {
  const boardBase = boardParts()
  const ownBoard = ownColumnsOf('distribution boards', boardBase, options.boards?.columns)
  const distributionBoards = pgTable(
    'distribution_boards',
    { ...boardBase, ...ownBoard } as BoardColumns & OwnBoard,
    (table) => [
      tenantIsolation(table.tenantId),
      unique('distribution_boards_tenant_id_key').on(table.tenantId, table.id),
      ...(options.boards?.constraints?.(table) ?? []),
    ],
  )

  // A section of a board. The unique key over id and board looks redundant
  // next to the primary key, and it is not: a circuit points at both, and
  // that pair is what keeps a circuit from claiming a section of some other
  // board.
  const sectionBase = sectionParts()
  const ownSection = ownColumnsOf('board sections', sectionBase, options.sections?.columns)
  const boardSections = pgTable(
    'board_sections',
    { ...sectionBase, ...ownSection } as SectionColumns & OwnSection,
    (table) => [
      tenantIsolation(table.tenantId),
      unique('board_sections_id_board_key').on(table.id, table.distributionBoardId),
      foreignKey({
        columns: [table.tenantId, table.distributionBoardId],
        foreignColumns: [distributionBoards.tenantId, distributionBoards.id],
        name: 'board_sections_board_in_tenant',
      }).onDelete('cascade'),
      index('board_sections_board_idx').on(table.distributionBoardId),
      ...(options.sections?.constraints?.(table) ?? []),
    ],
  )

  // A circuit. It always names its board and names a section only when the
  // board has any: a large main distribution is divided into sections, a
  // small sub distribution in a kitchen is not. The composite foreign key is
  // satisfied when the section is null, which is exactly the small case.
  //
  // Removing a section leaves its circuits on the board, without one. Written
  // so in the migration of an application and not here: drizzle knows no
  // column list for `set null`, and without one PostgreSQL empties both
  // columns of the key, the board included, which its `not null` refuses.
  //
  // The figures are thousandths, see `Circuit` in `platform-domain`. The
  // checks hold the same bounds as `circuitProblems` for every way in that is
  // not the sync; the sync asks that function first (`structureProblem`), so
  // that a figure out of bounds is refused as this one operation and not with
  // the whole transmission.
  const circuitBase = circuitParts()
  const ownCircuit = ownColumnsOf('circuits', circuitBase, options.circuits?.columns)
  const circuits = pgTable(
    'circuits',
    { ...circuitBase, ...ownCircuit } as CircuitColumns & OwnCircuit,
    (table) => [
      tenantIsolation(table.tenantId),
      unique('circuits_tenant_id_key').on(table.tenantId, table.id),
      foreignKey({
        columns: [table.tenantId, table.distributionBoardId],
        foreignColumns: [distributionBoards.tenantId, distributionBoards.id],
        name: 'circuits_board_in_tenant',
      }).onDelete('cascade'),
      foreignKey({
        columns: [table.boardSectionId, table.distributionBoardId],
        foreignColumns: [boardSections.id, boardSections.distributionBoardId],
        name: 'circuits_section_belongs_to_board',
      }).onDelete('set null'),
      check(
        'circuits_rated_current',
        sql`${table.ratedCurrentMilli} is null or ${table.ratedCurrentMilli} between 1 and 6300000`,
      ),
      check(
        'circuits_rated_residual_current',
        sql`${table.ratedResidualCurrentMilli} is null or ${table.ratedResidualCurrentMilli} between 1 and 30000`,
      ),
      check(
        'circuits_cable_cores',
        sql`${table.cableCores} is null or ${table.cableCores} between 1 and 100`,
      ),
      check(
        'circuits_cable_cross_section',
        sql`${table.cableCrossSectionMilli} is null or ${table.cableCrossSectionMilli} between 1 and 1000000`,
      ),
      check(
        'circuits_cable_length',
        sql`${table.cableLengthMilli} is null or ${table.cableLengthMilli} between 1 and 100000000`,
      ),
      index('circuits_board_idx').on(table.distributionBoardId),
      ...(options.circuits?.constraints?.(table) ?? []),
    ],
  )

  // A device on a circuit: socket, luminaire, motor, whatever is connected.
  const equipmentBase = equipmentParts()
  const ownEquipment = ownColumnsOf('equipment', equipmentBase, options.equipment?.columns)
  const equipment = pgTable(
    'equipment',
    { ...equipmentBase, ...ownEquipment } as EquipmentColumns & OwnEquipment,
    (table) => [
      tenantIsolation(table.tenantId),
      foreignKey({
        columns: [table.tenantId, table.circuitId],
        foreignColumns: [circuits.tenantId, circuits.id],
        name: 'equipment_circuit_in_tenant',
      }).onDelete('cascade'),
      index('equipment_circuit_idx').on(table.circuitId),
      ...(options.equipment?.constraints?.(table) ?? []),
    ],
  )

  return {
    distributionBoardKind,
    overcurrentDevice,
    tripCharacteristic,
    rcdType,
    cableInstallationMethod,
    distributionBoards,
    boardSections,
    circuits,
    equipment,
  } as ElectricalTables<OwnBoard, OwnSection, OwnCircuit, OwnEquipment>
}
