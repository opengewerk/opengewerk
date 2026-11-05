import { accessRequestStatuses, erasureRequestChannels, personalSubjects } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { customers } from './customers.js'
import { people } from './people.js'
import { prospects } from './prospects.js'

export const personalSubject = pgEnum('personal_subject', personalSubjects)

export const accessRequestStatus = pgEnum('access_request_status', accessRequestStatuses)

/**
 * How a request came in: the same ways as a request for deletion, in a type
 * of its own, so that taking back 0130 does not have to take back 0133.
 */
export const accessRequestChannel = pgEnum('access_request_channel', erasureRequestChannels)

/**
 * A request for access (#318, Art. 15 and 20 DSGVO), from the request to its
 * answer: whom it is about, a customer, a contact, a lead or the file of
 * somebody of the staff, when and how it came in, when the answer is due,
 * when the ZIP was last drawn and by whom, and when it was answered.
 *
 * Exactly one of the four keys names the person, the one of its kind. A lead
 * that goes under the deletion concept takes its key with it
 * (`ON DELETE SET NULL (prospect_id)`), and the request stays without whom it
 * was about, as a record that it was answered; a customer and a file stay as
 * empty rows when they go, and the contact has no key (see below). One request runs per person at a
 * time. Drawing the ZIP and answering are the only changes, and every one of
 * them stands in the change log. It goes to no device.
 */
export const accessRequests = pgTable(
  'access_requests',
  {
    id: primaryId<'access-request'>(),
    ...tenantColumn,
    subject: personalSubject('subject').notNull(),
    customerId: reference<'customer'>('customer_id'),
    contactId: reference<'contact'>('contact_id'),
    prospectId: reference<'prospect'>('prospect_id'),
    personId: reference<'person'>('person_id'),
    receivedOn: date('received_on').notNull(),
    channel: accessRequestChannel('channel').notNull(),
    status: accessRequestStatus('status').notNull().default('open'),
    answerDueOn: date('answer_due_on').notNull(),
    producedAt: timestamp('produced_at', { withTimezone: true }),
    producedBy: text('produced_by'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('access_requests_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'access_requests_customer_in_tenant',
    }).onDelete('restrict'),
    // No key to `contacts`: the foundation's table has no unique key over
    // tenant and id, and every key between two records of a business runs
    // over the tenant. A trigger of 0133 checks the contact's business instead.
    // The migration narrows this to `SET NULL (prospect_id)`: the tenant stays.
    foreignKey({
      columns: [table.tenantId, table.prospectId],
      foreignColumns: [prospects.tenantId, prospects.id],
      name: 'access_requests_prospect_in_tenant',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.tenantId, table.personId],
      foreignColumns: [people.tenantId, people.id],
      name: 'access_requests_person_in_tenant',
    }).onDelete('restrict'),
    uniqueIndex('access_requests_one_open_customer')
      .on(table.tenantId, table.customerId)
      .where(sql`${table.status} = 'open'`),
    uniqueIndex('access_requests_one_open_contact')
      .on(table.tenantId, table.contactId)
      .where(sql`${table.status} = 'open'`),
    uniqueIndex('access_requests_one_open_prospect')
      .on(table.tenantId, table.prospectId)
      .where(sql`${table.status} = 'open'`),
    uniqueIndex('access_requests_one_open_person')
      .on(table.tenantId, table.personId)
      .where(sql`${table.status} = 'open'`),
    check(
      'access_requests_one_subject',
      sql`num_nonnulls(${table.customerId}, ${table.contactId}, ${table.prospectId}, ${table.personId}) <= 1
        and (${table.customerId} is null or ${table.subject} = 'customer')
        and (${table.contactId} is null or ${table.subject} = 'contact')
        and (${table.prospectId} is null or ${table.subject} = 'prospect')
        and (${table.personId} is null or ${table.subject} = 'person')`,
    ),
    check(
      'access_requests_stand',
      sql`(${table.status} = 'open' and ${table.answeredAt} is null)
        or (${table.status} = 'answered' and ${table.answeredAt} is not null and ${table.producedAt} is not null)`,
    ),
    check(
      'access_requests_produced_by_somebody',
      sql`(${table.producedAt} is null) = (${table.producedBy} is null)`,
    ),
    check('access_requests_answer_after', sql`${table.answerDueOn} >= ${table.receivedOn}`),
  ],
)
