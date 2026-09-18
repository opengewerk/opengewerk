import { distributionBoardKinds } from '@opengewerk/domain'
import { foreignKey, index, integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { installations } from './installations.js'

export const distributionBoardKind = pgEnum('distribution_board_kind', distributionBoardKinds)

export const distributionBoards = pgTable(
  'distribution_boards',
  {
    id: primaryId<'distribution-board'>(),
    ...tenantColumn,
    installationId: reference<'installation'>('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    kind: distributionBoardKind('kind').notNull(),
    designation: text('designation').notNull(),
    location: text('location'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('distribution_boards_installation_idx').on(table.installationId),
  ],
)

/**
 * A section of a board. The unique key over id and board looks redundant next
 * to the primary key, and it is not: a circuit points at both, and that pair
 * is what keeps a circuit from claiming a section of some other board.
 */
export const boardSections = pgTable(
  'board_sections',
  {
    id: primaryId<'board-section'>(),
    ...tenantColumn,
    distributionBoardId: reference<'distribution-board'>('distribution_board_id')
      .notNull()
      .references(() => distributionBoards.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('board_sections_id_board_key').on(table.id, table.distributionBoardId),
    index('board_sections_board_idx').on(table.distributionBoardId),
  ],
)

/**
 * A circuit. It always names its board and names a section only when the board
 * has any: a large main distribution is divided into sections, a small sub
 * distribution in a kitchen is not. The composite foreign key is satisfied
 * when the section is null, which is exactly the small case.
 */
export const circuits = pgTable(
  'circuits',
  {
    id: primaryId<'circuit'>(),
    ...tenantColumn,
    distributionBoardId: reference<'distribution-board'>('distribution_board_id')
      .notNull()
      .references(() => distributionBoards.id, { onDelete: 'cascade' }),
    boardSectionId: reference<'board-section'>('board_section_id'),
    designation: text('designation').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.boardSectionId, table.distributionBoardId],
      foreignColumns: [boardSections.id, boardSections.distributionBoardId],
      name: 'circuits_section_belongs_to_board',
    }).onDelete('set null'),
    index('circuits_board_idx').on(table.distributionBoardId),
  ],
)

/** A device on a circuit: socket, luminaire, motor, whatever is connected. */
export const equipment = pgTable(
  'equipment',
  {
    id: primaryId<'equipment'>(),
    ...tenantColumn,
    circuitId: reference<'circuit'>('circuit_id')
      .notNull()
      .references(() => circuits.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    kind: text('kind'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [tenantIsolation(table.tenantId), index('equipment_circuit_idx').on(table.circuitId)],
)
