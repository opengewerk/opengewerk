import type { INestApplication } from '@nestjs/common'
import type { Pool } from 'pg'
import request from 'supertest'

/**
 * What an invoice needs before it can be issued, for the tests that issue one
 * to look at something else: the numbering, the rights, the sync.
 *
 * Since #71 an invoice without the mandatory details of section 14 UStG is
 * refused at issuing, and rightly. Those tests are not about section 14, so
 * what it asks for sits here in one place, and a test that issues an invoice
 * says what it is about rather than which paragraph it has to satisfy first.
 * What the check itself does is tested in `issuing.test.ts`.
 */

/**
 * A letterhead with an address and a tax number, straight into the table.
 * Through the superuser pool, because the tests that need it set up their
 * businesses the same way.
 */
export async function readyToInvoice(admin: Pool, ...tenantIds: readonly string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    await admin.query(
      `insert into letterheads (tenant_id, street, house_number, postal_code, city, tax_number)
       values ($1, 'Hafenstraße', '12', '20457', 'Hamburg', '22/815/08154')
       on conflict (tenant_id) do nothing`,
      [tenantId],
    )
  }
}

/** The address a customer needs to be sent an invoice. */
export const invoiceable = {
  street: 'Lindenweg',
  houseNumber: '3',
  postalCode: '22301',
  city: 'Hamburg',
} as const

/** A final invoice, dated, with the period the work was done in. */
export const finalInvoice = {
  kind: 'final_invoice',
  documentDate: '2026-09-18',
  serviceFrom: '2026-09-01',
  serviceUntil: '2026-09-15',
} as const

/** One line of a thousand euros net, well above a small amount. */
export const oneLine = {
  designation: 'Unterverteilung erneuert',
  quantityMilli: 1000,
  unit: 'flat_rate',
  unitPriceCents: 100000,
} as const

/**
 * A final invoice that can be issued: the fields above and one line. Returns
 * the id of the draft.
 */
export async function issuableDraft(
  app: INestApplication,
  identity: string,
  customerId: string,
  document: Record<string, unknown> = {},
): Promise<string> {
  const draft = await request(app.getHttpServer())
    .post('/documents')
    .set('x-test-identity', identity)
    .send({ customerId, ...finalInvoice, ...document })
    .expect(201)

  const id = (draft.body as { id: string }).id

  await request(app.getHttpServer())
    .post(`/documents/${id}/lines`)
    .set('x-test-identity', identity)
    .send(oneLine)
    .expect(201)

  return id
}
