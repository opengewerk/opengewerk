import type { INestApplication } from '@nestjs/common'
import type { TenantId } from '@opengewerk/domain'
import request from 'supertest'

import { newId } from '../database/identifier.js'
import { as } from './test-identity.js'

/**
 * Operations as a device's outbox sends them, for the tests of the structure
 * below an installation. Written here once because two test files build
 * boards through the sync, and the shape of an operation is the one thing
 * both must get exactly right.
 */

export type Value = string | number | boolean | null

/** An operation that creates a record with these fields. */
export function created(entity: string, recordId: string, fields: Record<string, Value>) {
  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'create' as const,
    baseVersion: null,
    patches: Object.entries(fields).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date().toISOString(),
  }
}

/** An operation that changes these fields, each with what the device saw in it. */
export function changed(
  entity: string,
  recordId: string,
  fields: Record<string, { from: Value; to: Value }>,
) {
  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'update' as const,
    baseVersion: null,
    patches: Object.entries(fields).map(([field, { from, to }]) => ({ field, from, to })),
    recordedAt: new Date().toISOString(),
  }
}

export function deleted(entity: string, recordId: string) {
  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'delete' as const,
    baseVersion: null,
    patches: [],
    recordedAt: new Date().toISOString(),
  }
}

export interface Receipt {
  readonly operationId: string
  readonly outcome: string
  readonly reason: string | null
  readonly fields: readonly string[]
}

/** One transmission, answered with its receipts, or with the message of a refusal. */
export async function push(
  app: INestApplication,
  who: string,
  operations: unknown[],
  expected = 201,
) {
  const answer = await request(app.getHttpServer())
    .post('/sync')
    .set('x-test-identity', who)
    .send({ deviceId: 'geraet-im-keller', operations })
    .expect(expected)

  return answer.body as { receipts: Receipt[]; message?: string; operationId?: string }
}

/** A customer, a site and an installation, the way the office creates them. */
export async function installationOf(app: INestApplication, tenantId: TenantId) {
  const office = as(tenantId, 'office')
  const http = () => request(app.getHttpServer())

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office)
    .send({ kind: 'private', name: 'Familie Berg' })
    .expect(201)
  const site = await http()
    .post('/sites')
    .set('x-test-identity', office)
    .send({
      customerId: customer.body.id,
      designation: 'Einfamilienhaus',
      street: 'Hauptstraße',
      houseNumber: '1',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
    })
    .expect(201)
  const installation = await http()
    .post('/installations')
    .set('x-test-identity', office)
    .send({ siteId: site.body.id, kind: 'meter_cabinet', designation: 'Zählerschrank' })
    .expect(201)

  return String(installation.body.id)
}

/** A board with one section, straight through the outbox. */
export async function boardOf(
  app: INestApplication,
  tenantId: TenantId,
  installationId: string,
  designation = 'UV Küche',
) {
  const boardId = newId<'distribution-board'>()
  const sectionId = newId<'board-section'>()

  await push(app, as(tenantId, 'office'), [
    created('distribution_boards', boardId, {
      installationId,
      kind: 'sub_distribution',
      designation,
      position: 0,
    }),
    created('board_sections', sectionId, {
      distributionBoardId: boardId,
      designation: 'Feld 1',
      position: 0,
    }),
  ])

  return { boardId, sectionId }
}
