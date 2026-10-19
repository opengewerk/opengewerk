import { getTableConfig, index, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { reference } from './columns.js'
import { electricalSchema } from './electrical.js'
import { photovoltaicSchema } from './photovoltaic.js'

// The tables of the electrical and the PV structure as an application makes
// them (ADR 0014), asked of the tables themselves and of no database. That a
// database made by an older migration is the one they describe, the
// application finds with `drizzle-kit generate`; what the database makes of
// them, its tests of the routes and the sync hold.

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

/** The keys a table has besides the one every table has to its tenant. */
const ownKeysOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.filter((key) => !key.getName().endsWith('_tenants_id_fk'))

const namesOf = (table: Parameters<typeof getTableConfig>[0]) => {
  const config = getTableConfig(table)

  return [
    ...config.foreignKeys.map((key) => key.getName()),
    ...config.checks.map((check) => check.name),
    ...config.indexes.map((made) => made.config.name),
    ...config.uniqueConstraints.map((unique) => unique.getName()),
  ]
}

describe('the electrical structure', () => {
  it('hangs on nothing of its own: what a board hangs on, the application gives it', () => {
    const plain = electricalSchema()
    const own = electricalSchema({
      boards: { columns: { assetId: reference<'asset'>('asset_id').notNull() } },
    })

    expect(columnsOf(plain.distributionBoards)).not.toContain('asset_id')
    expect(columnsOf(own.distributionBoards)).toContain('asset_id')
    expect(columnsOf(own.distributionBoards)).toEqual(
      expect.arrayContaining(columnsOf(plain.distributionBoards)),
    )
  })

  it('takes columns and constraints of the application at every table', () => {
    const made = electricalSchema({
      boards: { columns: { area: text('area') } },
      sections: { columns: { area: text('area') } },
      circuits: {
        columns: { area: text('area') },
        constraints: (table) => [index('circuits_area_idx').on(table.area)],
      },
      equipment: {
        columns: { area: text('area') },
        constraints: (table) => [index('equipment_area_idx').on(table.area)],
      },
    })

    for (const table of [
      made.distributionBoards,
      made.boardSections,
      made.circuits,
      made.equipment,
    ]) {
      expect(columnsOf(table)).toContain('area')
    }
    expect(namesOf(made.circuits)).toContain('circuits_area_idx')
    expect(namesOf(made.equipment)).toContain('equipment_area_idx')
  })

  it('refuses a column of the application under a name a table has', () => {
    expect(() => electricalSchema({ circuits: { columns: { consumer: text('who') } } })).toThrow(
      'The circuits have these columns already: consumer.',
    )
    expect(() => electricalSchema({ boards: { columns: { kind: text('sort') } } })).toThrow(
      'The distribution boards have these columns already: kind.',
    )
  })

  it('keeps every part in the tenant of its parent, and a section on its own board', () => {
    const made = electricalSchema()
    const keys = (table: Parameters<typeof getTableConfig>[0]) =>
      ownKeysOf(table).map((key) => ({
        name: key.getName(),
        columns: key.reference().columns.map((column) => column.name),
        onDelete: key.onDelete,
      }))

    expect(keys(made.boardSections)).toEqual([
      {
        name: 'board_sections_board_in_tenant',
        columns: ['tenant_id', 'distribution_board_id'],
        onDelete: 'cascade',
      },
    ])
    expect(keys(made.circuits)).toEqual([
      {
        name: 'circuits_board_in_tenant',
        columns: ['tenant_id', 'distribution_board_id'],
        onDelete: 'cascade',
      },
      {
        name: 'circuits_section_belongs_to_board',
        columns: ['board_section_id', 'distribution_board_id'],
        onDelete: 'set null',
      },
    ])
    expect(keys(made.equipment)).toEqual([
      {
        name: 'equipment_circuit_in_tenant',
        columns: ['tenant_id', 'circuit_id'],
        onDelete: 'cascade',
      },
    ])
  })

  it('holds the bounds of a circuit, and makes the tables under the names they had', () => {
    const made = electricalSchema()

    expect(getTableConfig(made.circuits).checks.map((check) => check.name)).toEqual([
      'circuits_rated_current',
      'circuits_rated_residual_current',
      'circuits_cable_cores',
      'circuits_cable_cross_section',
      'circuits_cable_length',
    ])
    expect(
      [made.distributionBoards, made.boardSections, made.circuits, made.equipment].map(
        (table) => getTableConfig(table).name,
      ),
    ).toEqual(['distribution_boards', 'board_sections', 'circuits', 'equipment'])
    expect(made.distributionBoardKind.enumName).toBe('distribution_board_kind')
    expect(made.cableInstallationMethod.enumValues).toContain('c')
  })
})

describe('the PV structure', () => {
  it('hangs on what the application gives an inverter, and keeps strings and modules in its tenant', () => {
    const plain = photovoltaicSchema()
    const own = photovoltaicSchema({
      inverters: { columns: { assetId: reference<'asset'>('asset_id').notNull() } },
      modules: { columns: { area: text('area') } },
    })

    expect(columnsOf(plain.inverters)).not.toContain('asset_id')
    expect(columnsOf(own.inverters)).toContain('asset_id')
    expect(columnsOf(own.pvModules)).toContain('area')
    expect(ownKeysOf(own.pvStrings).map((key) => key.getName())).toEqual([
      'pv_strings_inverter_in_tenant',
    ])
    expect(ownKeysOf(own.pvModules).map((key) => key.getName())).toEqual([
      'pv_modules_string_in_tenant',
    ])
    expect(getTableConfig(own.inverters).checks.map((check) => check.name)).toEqual([
      'inverters_rated_power',
      'inverters_mpp_inputs',
    ])
  })

  it('refuses a column of the application under a name a table has', () => {
    expect(() => photovoltaicSchema({ strings: { columns: { tiltDeg: text('tilt') } } })).toThrow(
      'The PV strings have these columns already: tiltDeg.',
    )
  })
})
