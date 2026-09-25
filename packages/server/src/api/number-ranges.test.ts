import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { assignDocumentNumber } from '../database/number-ranges.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { yearInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The number ranges under "Einstellungen". What is held on to here is less the
 * screen than the promise behind it: a changed pattern applies from the next
 * document, and the counter never moves back, because a number lower than the
 * next one is a number some document already carries.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd' }

// The year the server numbers with, which is the one in Germany: on the last
// evening of a year the machine running this may already be in the next.
const year = yearInGermany()

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

const owner = (tenant = north) => as(tenant.id, 'owner')
const office = (tenant = north) => as(tenant.id, 'office')

function change(key: string, body: Record<string, unknown>, identity = owner()) {
  return http().put(`/settings/number-ranges/${key}`).set('x-test-identity', identity).send(body)
}

async function ranges(identity = owner()) {
  const answer = await http()
    .get('/settings/number-ranges')
    .set('x-test-identity', identity)
    .expect(200)

  return answer.body as { key: string; pattern: string; nextValue: number; next: string }[]
}

/** Issues an invoice number the way issuing a document does. */
function issueInvoiceNumber(tenant = north) {
  return database.forTenant({ tenantId: tenant.id, userId: 'test' }, (tx) =>
    assignDocumentNumber(tx, tenant.id, 'final_invoice', new Date()),
  )
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  for (const tenant of [north, south]) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from number_ranges')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the number ranges of a business', () => {
  it('are all shown, with the defaults for the ones nothing has drawn from yet', async () => {
    expect(await ranges(office())).toEqual([
      {
        key: 'job',
        pattern: 'AU-{year}-{number:4}',
        nextValue: 1,
        next: `AU-${String(year)}-0001`,
      },
      {
        key: 'quote',
        pattern: 'AN-{year}-{number:4}',
        nextValue: 1,
        next: `AN-${String(year)}-0001`,
      },
      {
        key: 'order_confirmation',
        pattern: 'AB-{year}-{number:4}',
        nextValue: 1,
        next: `AB-${String(year)}-0001`,
      },
      {
        key: 'delivery_note',
        pattern: 'LS-{year}-{number:4}',
        nextValue: 1,
        next: `LS-${String(year)}-0001`,
      },
      {
        key: 'report',
        pattern: 'RB-{year}-{number:4}',
        nextValue: 1,
        next: `RB-${String(year)}-0001`,
      },
      {
        key: 'invoice',
        pattern: 'RE-{year}-{number:4}',
        nextValue: 1,
        next: `RE-${String(year)}-0001`,
      },
    ])
  })

  it('are changed by the owner and not by the office', async () => {
    const refused = await change('invoice', { pattern: 'R{number:5}' }, office()).expect(403)

    expect((refused.body as { message: string }).message).toContain('Einstellungen ändern')
  })

  it('number the next document with the new pattern, and keep what was handed out', async () => {
    expect(await issueInvoiceNumber()).toBe(`RE-${String(year)}-0001`)

    const changed = await change('invoice', { pattern: 'R-{number:5}' }).expect(200)

    expect(changed.body).toMatchObject({ pattern: 'R-{number:5}', nextValue: 2, next: 'R-00002' })
    expect(await issueInvoiceNumber()).toBe('R-00002')

    // The log keeps the old pattern next to the new one.
    const { rows } = await admin.query<{ old_value: string; new_value: string }>(
      `select old_value, new_value from audit_entries
        where table_name = 'number_ranges' and field = 'pattern' and old_value is not null`,
    )

    expect(rows).toEqual([{ old_value: 'RE-{year}-{number:4}', new_value: 'R-{number:5}' }])
  })

  /**
   * A business that comes from another program continues its count, and it
   * can do that once and in one direction: back would hand out a number again.
   */
  it('move the counter forward on request, and never back', async () => {
    const moved = await change('invoice', {
      pattern: 'RE-{year}-{number:4}',
      nextValue: 153,
    }).expect(200)

    expect(moved.body).toMatchObject({ nextValue: 153, next: `RE-${String(year)}-0153` })
    expect(await issueInvoiceNumber()).toBe(`RE-${String(year)}-0153`)

    const refused = await change('invoice', {
      pattern: 'RE-{year}-{number:4}',
      nextValue: 100,
    }).expect(400)

    expect((refused.body as { message: string }).message).toContain(
      'Die nächste Nummer kann nur steigen. Bis 153 ist schon vergeben',
    )
    expect((await ranges()).find((range) => range.key === 'invoice')?.nextValue).toBe(154)
  })

  it('refuse a pattern that would number wrongly, with the sentence of the form', async () => {
    const refused = await change('quote', { pattern: 'AN-{year}' }).expect(400)

    expect((refused.body as { message: string }).message).toContain('Es fehlt {number}')
    await change('quote', { pattern: 'AN-{number}', nextValue: 0 }).expect(400)
    await change('lieferschein', { pattern: 'LS-{number}' }).expect(404)
    expect((await ranges()).find((range) => range.key === 'quote')?.pattern).toBe(
      'AN-{year}-{number:4}',
    )
  })

  it('belong to their business', async () => {
    await change('invoice', { pattern: 'NORD-{number}' }).expect(200)

    expect((await ranges(owner(south))).find((range) => range.key === 'invoice')?.pattern).toBe(
      'RE-{year}-{number:4}',
    )
  })
})
