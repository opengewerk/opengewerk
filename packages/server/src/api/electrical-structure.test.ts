import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { InstallationId, TenantId } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import * as schema from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  foreignKeyViolation,
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import {
  boardOf,
  changed,
  created,
  deleted,
  installationOf,
  push as pushVia,
} from './test-structure.js'

/**
 * The structure below an installation, as a device builds it: board, section,
 * circuit, equipment, each one an operation in the outbox, written in the
 * office or in front of the board without a network.
 *
 * Two businesses on the instance, because the part of this that matters most
 * is the one nobody would notice: a circuit hanging on somebody else's board.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const northInstallation = { id: '' }
const southInstallation = { id: '' }

function http() {
  return request(app.getHttpServer())
}

/** One transmission from the device in the cellar. */
function push(who: string, operations: unknown[], expected = 201) {
  return pushVia(app, who, operations, expected)
}

async function pull(who: string) {
  const answer = await http().get('/sync?since=0').set('x-test-identity', who).expect(200)

  return answer.body as {
    changes: { entity: string; rows: Record<string, unknown>[] }[]
  }
}

function rowsOf(pulled: Awaited<ReturnType<typeof pull>>, entity: string) {
  return pulled.changes.find((change) => change.entity === entity)?.rows ?? []
}

async function setUp(tenantId: TenantId, into: { id: string }) {
  into.id = await installationOf(app, tenantId)
}

/** A board with one section, straight through the outbox, for the tests that need one. */
function board(tenantId: TenantId, installationId: string) {
  return boardOf(app, tenantId, installationId)
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  await setUp(north.id, northInstallation)
  await setUp(south.id, southInstallation)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a board written down in the office', () => {
  it('arrives whole, down to the equipment and every figure of its circuits', async () => {
    const boardId = newId<'distribution-board'>()
    const sectionId = newId<'board-section'>()
    const circuitId = newId<'circuit'>()
    const equipmentId = newId<'equipment'>()

    const answer = await push(as(north.id, 'office'), [
      created('distribution_boards', boardId, {
        installationId: northInstallation.id,
        kind: 'main_distribution',
        designation: 'HV',
        location: 'Keller, Raum 2',
        position: 0,
      }),
      created('board_sections', sectionId, {
        distributionBoardId: boardId,
        designation: 'Feld 1',
        position: 0,
      }),
      created('circuits', circuitId, {
        distributionBoardId: boardId,
        boardSectionId: sectionId,
        designation: 'F3',
        consumer: 'Steckdosen Küche',
        overcurrentDevice: 'circuit_breaker',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 16_000,
        rcdType: 'a',
        ratedResidualCurrentMilli: 30,
        cableType: 'NYM-J',
        cableCores: 3,
        cableCrossSectionMilli: 2_500,
        cableLengthMilli: 18_500,
        cableInstallationMethod: 'c',
        position: 0,
      }),
      created('equipment', equipmentId, {
        circuitId,
        designation: 'Steckdose Arbeitsplatte',
        kind: 'Steckdose',
        manufacturer: 'Busch-Jaeger',
        model: '20 EUC-914',
        serialNumber: null,
        position: 0,
      }),
    ])

    expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
    ])

    const pulled = await pull(as(north.id, 'office'))
    const circuit = rowsOf(pulled, 'circuits').find((row) => row['id'] === circuitId)

    expect(circuit).toMatchObject({
      distributionBoardId: boardId,
      boardSectionId: sectionId,
      consumer: 'Steckdosen Küche',
      overcurrentDevice: 'circuit_breaker',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      rcdType: 'a',
      ratedResidualCurrentMilli: 30,
      cableType: 'NYM-J',
      cableCores: 3,
      cableCrossSectionMilli: 2_500,
      cableLengthMilli: 18_500,
      cableInstallationMethod: 'c',
      tenantId: north.id,
    })
    expect(rowsOf(pulled, 'equipment').find((row) => row['id'] === equipmentId)).toMatchObject({
      circuitId,
      model: '20 EUC-914',
    })
  })
})

describe('a technician in front of a board', () => {
  it('adds the circuit that is missing, without the office', async () => {
    const { boardId } = await board(north.id, northInstallation.id)
    const circuitId = newId<'circuit'>()

    const answer = await push(as(north.id, 'technician'), [
      created('circuits', circuitId, {
        distributionBoardId: boardId,
        designation: 'F7',
        consumer: 'Außensteckdose',
        position: 7,
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })
  })

  it('fills in what the breaker says afterwards, one figure at a time', async () => {
    const { boardId } = await board(north.id, northInstallation.id)
    const circuitId = newId<'circuit'>()

    await push(as(north.id, 'technician'), [
      created('circuits', circuitId, {
        distributionBoardId: boardId,
        designation: 'F1',
        position: 0,
      }),
    ])

    const answer = await push(as(north.id, 'technician'), [
      changed('circuits', circuitId, {
        overcurrentDevice: { from: null, to: 'fuse_d0' },
        tripCharacteristic: { from: null, to: 'gg' },
        ratedCurrentMilli: { from: null, to: 25_000 },
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })
  })
})

describe('a part of the structure', () => {
  it('stays in the business it was made in, whatever id a device sends', async () => {
    // The ids of the other business are ones a device could know: somebody
    // who works for both, or a list copied from one to the other. A key on
    // the id alone takes them, because PostgreSQL checks it past row level
    // security, and the board would hang in the other business's cabinet.
    const southBoard = await board(south.id, southInstallation.id)
    const southCircuit = newId<'circuit'>()
    await push(as(south.id, 'office'), [
      created('circuits', southCircuit, {
        distributionBoardId: southBoard.boardId,
        designation: 'F1',
        position: 0,
      }),
    ])

    const answer = await push(as(north.id, 'office'), [
      created('distribution_boards', newId<'distribution-board'>(), {
        installationId: southInstallation.id,
        kind: 'sub_distribution',
        designation: 'Untergeschoben',
        position: 0,
      }),
      created('board_sections', newId<'board-section'>(), {
        distributionBoardId: southBoard.boardId,
        designation: 'Untergeschoben',
        position: 0,
      }),
      created('circuits', newId<'circuit'>(), {
        distributionBoardId: southBoard.boardId,
        designation: 'Untergeschoben',
        position: 0,
      }),
      created('equipment', newId<'equipment'>(), {
        circuitId: southCircuit,
        designation: 'Untergeschoben',
        position: 0,
      }),
    ])

    expect(
      answer.receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields })),
    ).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['installationId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['distributionBoardId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['distributionBoardId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['circuitId'] },
    ])

    const { rows } = await admin.query<{ count: number }>(
      `select (select count(*) from distribution_boards where designation = 'Untergeschoben')
            + (select count(*) from board_sections where designation = 'Untergeschoben')
            + (select count(*) from circuits where designation = 'Untergeschoben')
            + (select count(*) from equipment where designation = 'Untergeschoben') as count`,
    )
    expect(Number(rows[0]?.count)).toBe(0)
  })

  it('is held in its business by the database too, for every other way in', async () => {
    const southBoard = await board(south.id, southInstallation.id)

    // Straight at the table through the role the application uses, past the
    // check in the sync. The key over tenant and id is what refuses it.
    expect(
      await refusedBy(
        database.forTenant({ tenantId: north.id }, (tx) =>
          tx.insert(schema.circuits).values({
            tenantId: north.id,
            distributionBoardId: southBoard.boardId,
            designation: 'Untergeschoben',
          }),
        ),
      ),
    ).toEqual({ code: foreignKeyViolation, constraint: 'circuits_board_in_tenant' })

    expect(
      await refusedBy(
        database.forTenant({ tenantId: north.id }, (tx) =>
          tx.insert(schema.distributionBoards).values({
            tenantId: north.id,
            installationId: southInstallation.id as InstallationId,
            kind: 'sub_distribution',
            designation: 'Untergeschoben',
          }),
        ),
      ),
    ).toEqual({
      code: foreignKeyViolation,
      constraint: 'distribution_boards_installation_in_tenant',
    })
  })

  it('cannot claim a section of another board, and the rest of the queue still lands', async () => {
    const kitchen = await board(north.id, northInstallation.id)
    const hall = await board(north.id, northInstallation.id)
    const fine = newId<'circuit'>()

    const answer = await push(as(north.id, 'technician'), [
      created('circuits', newId<'circuit'>(), {
        distributionBoardId: hall.boardId,
        boardSectionId: kitchen.sectionId,
        designation: 'F2 falsch zugeordnet',
        position: 0,
      }),
      created('circuits', fine, {
        distributionBoardId: kitchen.boardId,
        boardSectionId: kitchen.sectionId,
        designation: 'F2',
        position: 0,
      }),
    ])

    expect(answer.receipts.map(({ outcome, fields }) => ({ outcome, fields }))).toEqual([
      { outcome: 'conflict', fields: ['boardSectionId'] },
      { outcome: 'applied', fields: [] },
    ])
  })

  it('cannot be moved to another board while it keeps the section of the old one', async () => {
    const kitchen = await board(north.id, northInstallation.id)
    const hall = await board(north.id, northInstallation.id)
    const circuitId = newId<'circuit'>()

    await push(as(north.id, 'office'), [
      created('circuits', circuitId, {
        distributionBoardId: kitchen.boardId,
        boardSectionId: kitchen.sectionId,
        designation: 'F4',
        position: 0,
      }),
    ])

    const kept = await push(as(north.id, 'office'), [
      changed('circuits', circuitId, {
        distributionBoardId: { from: kitchen.boardId, to: hall.boardId },
      }),
    ])
    expect(kept.receipts[0]).toMatchObject({ outcome: 'conflict', fields: ['boardSectionId'] })

    const moved = await push(as(north.id, 'office'), [
      changed('circuits', circuitId, {
        distributionBoardId: { from: kitchen.boardId, to: hall.boardId },
        boardSectionId: { from: kitchen.sectionId, to: hall.sectionId },
      }),
    ])
    expect(moved.receipts[0]).toMatchObject({ outcome: 'applied' })
  })

  it('arriving for a board the office removed meanwhile is a conflict, not a lost queue', async () => {
    const { boardId } = await board(north.id, northInstallation.id)
    await push(as(north.id, 'office'), [deleted('distribution_boards', boardId)])

    const report = newId<'circuit'>()
    const answer = await push(as(north.id, 'technician'), [
      created('circuits', newId<'circuit'>(), {
        distributionBoardId: boardId,
        designation: 'F9',
        position: 0,
      }),
      created('circuits', report, {
        distributionBoardId: (await board(north.id, northInstallation.id)).boardId,
        designation: 'F1',
        position: 0,
      }),
    ])

    expect(answer.receipts.map(({ outcome, reason }) => ({ outcome, reason }))).toEqual([
      { outcome: 'conflict', reason: 'record_missing' },
      { outcome: 'applied', reason: null },
    ])
  })
})

describe('the figures of a circuit', () => {
  it('are refused out of bounds as a mistake of the client, in the words its form uses', async () => {
    const { boardId } = await board(north.id, northInstallation.id)

    const answer = await push(
      as(north.id, 'office'),
      [
        created('circuits', newId<'circuit'>(), {
          distributionBoardId: boardId,
          designation: 'F1',
          ratedCurrentMilli: 0,
          position: 0,
        }),
      ],
      400,
    )

    expect(answer.message).toBe('Der Nennstrom ist größer als 0 und höchstens 6300 A.')
  })

  it('are judged as the circuit stands afterwards, a curve against the device already there', async () => {
    const { boardId } = await board(north.id, northInstallation.id)
    const circuitId = newId<'circuit'>()

    await push(as(north.id, 'office'), [
      created('circuits', circuitId, {
        distributionBoardId: boardId,
        designation: 'F1',
        overcurrentDevice: 'fuse_d0',
        position: 0,
      }),
    ])

    const answer = await push(
      as(north.id, 'office'),
      [changed('circuits', circuitId, { tripCharacteristic: { from: null, to: 'b' } })],
      400,
    )

    expect(answer.message).toMatch(/passt nicht zur gewählten Schutzeinrichtung/)
  })

  it('refuse a kind of board nobody knows before the database would', async () => {
    const answer = await push(
      as(north.id, 'office'),
      [
        created('distribution_boards', newId<'distribution-board'>(), {
          installationId: northInstallation.id,
          kind: 'meter_cabinet',
          designation: 'Zählerschrank',
          position: 0,
        }),
      ],
      400,
    )

    expect(answer.message).toBe('Diese Art von Verteiler kennt OpenGewerk nicht.')
  })
})

describe('a board marked as deleted', () => {
  it('takes its sections, circuits and equipment along, and every device hears of each', async () => {
    const { boardId, sectionId } = await board(north.id, northInstallation.id)
    const inSection = newId<'circuit'>()
    const onBoard = newId<'circuit'>()
    const socket = newId<'equipment'>()

    await push(as(north.id, 'office'), [
      created('circuits', inSection, {
        distributionBoardId: boardId,
        boardSectionId: sectionId,
        designation: 'F1',
        position: 0,
      }),
      created('circuits', onBoard, {
        distributionBoardId: boardId,
        designation: 'F2',
        position: 1,
      }),
      created('equipment', socket, { circuitId: inSection, designation: 'Steckdose', position: 0 }),
    ])

    const before = await admin.query<{ highest: string }>(
      'select max(change_sequence) as highest from circuits',
    )

    const answer = await push(as(north.id, 'office'), [deleted('distribution_boards', boardId)])
    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })

    const { rows } = await admin.query<{ entity: string; marked: boolean; sequence: string }>(
      `select 'board_sections' as entity, deleted_at is not null as marked, change_sequence as sequence
         from board_sections where id = $1
       union all
       select 'circuits', deleted_at is not null, change_sequence from circuits where id in ($2, $3)
       union all
       select 'equipment', deleted_at is not null, change_sequence from equipment where id = $4`,
      [sectionId, inSection, onBoard, socket],
    )

    expect(rows).toHaveLength(4)
    expect(rows.every((row) => row.marked)).toBe(true)
    // Each child moved in the change stream, so a device that pulls after
    // this hears that the rows are gone rather than keeping them forever.
    expect(rows.every((row) => Number(row.sequence) > Number(before.rows[0]?.highest))).toBe(true)

    const audited = await admin.query<{ count: string }>(
      `select count(*) from audit_entries
        where record_id in ($1, $2, $3, $4) and field = 'deleted_at'`,
      [sectionId, inSection, onBoard, socket],
    )
    expect(Number(audited.rows[0]?.count)).toBe(4)
  })

  it('takes a removed section with its circuits, and leaves the rest of the board alone', async () => {
    const { boardId, sectionId } = await board(north.id, northInstallation.id)
    const inSection = newId<'circuit'>()
    const onBoard = newId<'circuit'>()

    await push(as(north.id, 'office'), [
      created('circuits', inSection, {
        distributionBoardId: boardId,
        boardSectionId: sectionId,
        designation: 'F1',
        position: 0,
      }),
      created('circuits', onBoard, {
        distributionBoardId: boardId,
        designation: 'F2',
        position: 1,
      }),
    ])

    await push(as(north.id, 'office'), [deleted('board_sections', sectionId)])

    const { rows } = await admin.query<{ id: string; marked: boolean }>(
      'select id, deleted_at is not null as marked from circuits where id in ($1, $2)',
      [inSection, onBoard],
    )

    expect(Object.fromEntries(rows.map((row) => [row.id, row.marked]))).toEqual({
      [inSection]: true,
      [onBoard]: false,
    })
  })
})
