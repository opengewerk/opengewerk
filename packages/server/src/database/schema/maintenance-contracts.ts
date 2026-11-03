import {
  contractPriceKinds,
  maintenanceContractLimits,
  paymentRhythms,
  renewalKinds,
} from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { customers } from './customers.js'
import { documents } from './documents.js'
import { sites } from './sites.js'

function listOf(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

/**
 * The maintenance contracts of the business (#294): which installations at a
 * site of a customer it looks after, every how many months, for which term,
 * with what notice, and at what price. Out of an issued quote, one contract
 * per quote.
 *
 * No sync columns: the office keeps them at a desk, and they go to no device.
 * What reaches a device is the service job each maintenance makes, which
 * names the contract. Deleted for real, like a funding programme, but only
 * while no service job names it: the key of `jobs` holds that.
 *
 * The installations are a list of identifiers rather than a table of their
 * own: the route checks that each is one of the site's, and an installation
 * removed later stays in the list without harm, as a name the contract once
 * covered.
 */
export const maintenanceContracts = pgTable(
  'maintenance_contracts',
  {
    id: primaryId<'maintenance-contract'>(),
    ...tenantColumn,
    number: text('number').notNull(),
    designation: text('designation').notNull(),
    customerId: reference<'customer'>('customer_id').notNull(),
    siteId: reference<'site'>('site_id'),
    quoteId: reference<'document'>('quote_id').notNull(),
    installationIds: uuid('installation_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    services: text('services'),
    startsOn: date('starts_on').notNull(),
    firstVisitOn: date('first_visit_on').notNull(),
    intervalMonths: integer('interval_months').notNull(),
    termMonths: integer('term_months').notNull(),
    renewal: text('renewal').notNull(),
    renewalMonths: integer('renewal_months'),
    noticeMonths: integer('notice_months').notNull(),
    priceKind: text('price_kind').notNull(),
    flatCents: integer('flat_cents'),
    paymentRhythm: text('payment_rhythm').notNull().default('visit'),
    issueByItself: boolean('issue_by_itself').notNull().default(false),
    cancelledOn: date('cancelled_on'),
    endsOn: date('ends_on'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('maintenance_contracts_tenant_id_key').on(table.tenantId, table.id),
    unique('maintenance_contracts_number_key').on(table.tenantId, table.number),
    unique('maintenance_contracts_quote_key').on(table.tenantId, table.quoteId),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'maintenance_contracts_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'maintenance_contracts_site_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.quoteId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'maintenance_contracts_quote_in_tenant',
    }).onDelete('restrict'),
    check(
      'maintenance_contracts_texts_fit',
      sql`char_length(${table.designation}) between 1 and ${sql.raw(String(maintenanceContractLimits.designation))}
        and char_length(coalesce(${table.services}, '')) <= ${sql.raw(String(maintenanceContractLimits.services))}
        and char_length(${table.number}) between 1 and 40`,
    ),
    check(
      'maintenance_contracts_visits',
      sql`${table.intervalMonths} between 1 and ${sql.raw(String(maintenanceContractLimits.intervalMonths))}
        and ${table.firstVisitOn} >= ${table.startsOn}
        and cardinality(${table.installationIds}) <= ${sql.raw(String(maintenanceContractLimits.installations))}`,
    ),
    check(
      'maintenance_contracts_term',
      sql`${table.termMonths} between 1 and ${sql.raw(String(maintenanceContractLimits.termMonths))}
        and ${table.noticeMonths} between 0 and ${sql.raw(String(maintenanceContractLimits.noticeMonths))}
        and ${table.renewal} in (${sql.raw(listOf(renewalKinds))})
        and (${table.renewal} = 'fixed') = (${table.renewalMonths} is not null)
        and coalesce(${table.renewalMonths}, 1) between 1 and ${sql.raw(String(maintenanceContractLimits.renewalMonths))}`,
    ),
    check(
      'maintenance_contracts_price',
      sql`${table.priceKind} in (${sql.raw(listOf(contractPriceKinds))})
        and (${table.priceKind} = 'flat') = (${table.flatCents} is not null)
        and coalesce(${table.flatCents}, 0) between 0 and ${sql.raw(String(maintenanceContractLimits.flatCents))}
        and ${table.paymentRhythm} in (${sql.raw(listOf(paymentRhythms))})
        and (${table.paymentRhythm} = 'visit' or ${table.priceKind} = 'flat')
        and (not ${table.issueByItself} or ${table.paymentRhythm} <> 'visit')`,
    ),
    check(
      'maintenance_contracts_notice',
      sql`(${table.cancelledOn} is null) = (${table.endsOn} is null)
        and (${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn})`,
    ),
    index('maintenance_contracts_customer_idx').on(table.tenantId, table.customerId),
    index('maintenance_contracts_site_idx').on(table.tenantId, table.siteId),
  ],
)
