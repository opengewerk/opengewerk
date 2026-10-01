import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

/** Which entry a device opens OpenGewerk in, and so where a tap on a message leads. */
export const pushEntry = pgEnum('push_entry', ['office', 'site'])

/**
 * What a message is about: one of the occasions a person can switch off
 * (`pushOccasions` in `domain`, which a test holds this list to), or the test
 * from "Konto".
 */
export const pushKind = pgEnum('push_kind', ['task_due', 'deadline_due', 'test'])

/** Where a message stands, as in the mail outbox. */
export const pushStatus = pgEnum('push_status', ['pending', 'sent', 'failed'])

/**
 * A device that takes push messages for one person in one business (#284).
 *
 * What the browser handed over when it subscribed: the address at its push
 * service and the two keys a message is encrypted with. Written by the device
 * itself through `PUT /push/subscription`, and again at every start while push
 * is on there, which keeps the row bound to the session the device is signed
 * in with now.
 *
 * `session_id` is that binding. A message goes only while the session exists:
 * a device signed out, from itself or from "Angemeldete Geräte", or all of
 * them by a new password, gets nothing more, although its browser still holds
 * the subscription. Null only where there is no session at all, in the
 * preview.
 *
 * Per business and not per account: a message names what is due in one
 * business, and a telephone that works in two gets the messages of the one it
 * was switched on in.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: primaryId<'push-subscription'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    sessionId: text('session_id'),
    entry: pushEntry('entry').notNull(),
    /** What the device is, "Chrome auf Windows", as the list of devices says it. */
    label: text('label').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'push_subscriptions_person_works_here',
    }).onDelete('cascade'),
    unique('push_subscriptions_tenant_id_key').on(table.tenantId, table.id),
    unique('push_subscriptions_once_per_endpoint').on(table.tenantId, table.endpoint),
    index('push_subscriptions_person_idx').on(table.tenantId, table.userId),
  ],
)

/**
 * An occasion a person does not want as push (#284). Every occasion is on
 * until somebody switches it off, which is a row here; switching it on again
 * removes the row. For every device of that person in the business at once.
 */
export const pushOptOuts = pgTable(
  'push_opt_outs',
  {
    id: primaryId<'push-opt-out'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    occasion: text('occasion').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'push_opt_outs_person_works_here',
    }).onDelete('cascade'),
    unique('push_opt_outs_once').on(table.tenantId, table.userId, table.occasion),
  ],
)

/**
 * Every push message, one row per device, before and after it went out; the
 * push counterpart of `mail_outbox`.
 *
 * Title, text and link are fixed when the row is written, and none of them
 * carries a name or an address: the message passes through the push service
 * of the browser's maker, encrypted, and says only what is due. What it is
 * about in detail the device shows after the tap, from its own data.
 *
 * `cause` makes a message happen once per cause and device, like a mail once
 * per cause. `expires_at` is when it is no use any more: a task due this
 * morning is not worth a message tomorrow, so a message that could not go out
 * by then is given up rather than sent late.
 */
export const pushOutbox = pgTable(
  'push_outbox',
  {
    id: primaryId<'push-message'>(),
    ...tenantColumn,
    kind: pushKind('kind').notNull(),
    cause: text('cause').notNull(),
    subscriptionId: reference<'push-subscription'>('subscription_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Where a tap leads, a path of the entry the device uses. */
    url: text('url').notNull(),
    status: pushStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.subscriptionId],
      foreignColumns: [pushSubscriptions.tenantId, pushSubscriptions.id],
      name: 'push_outbox_subscription_in_tenant',
    }).onDelete('cascade'),
    unique('push_outbox_once_per_cause').on(table.tenantId, table.cause, table.subscriptionId),
    index('push_outbox_due_idx').on(table.tenantId, table.status, table.nextAttemptAt),
    index('push_outbox_subscription_idx').on(table.tenantId, table.subscriptionId),
  ],
)
