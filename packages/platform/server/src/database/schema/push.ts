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

import { primaryId, reference, timestamps } from './columns.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/** The kind of a push message a person sends themselves from their account, to see that push works. */
export const pushTestKind = 'test'

/** Where a push message stands, as in the outbox of the mail. */
export const pushStatuses = ['pending', 'sent', 'failed'] as const

/** The tables of push and their enums, made for the entries and occasions of one application. */
function pushParts<const Entry extends string, const Occasion extends string>(
  entries: readonly [Entry, ...Entry[]],
  occasions: readonly [Occasion, ...Occasion[]],
) {
  const pushEntry = pgEnum('push_entry', entries)
  const pushKind = pgEnum('push_kind', [...occasions, pushTestKind] as [
    Occasion | typeof pushTestKind,
    ...(Occasion | typeof pushTestKind)[],
  ])
  const pushStatus = pgEnum('push_status', pushStatuses)

  /**
   * A device that takes push messages for one person in one tenant.
   *
   * What the browser handed over when it subscribed: the address at its push
   * service and the two keys a message is encrypted with. Written by the
   * device itself, and again at every start while push is on there, which
   * keeps the row bound to the session the device is signed in with now.
   *
   * `session_id` is that binding. A message goes only while the session
   * exists: a device signed out, from itself or from the list of devices, or
   * all of them by a new password, gets nothing more, although its browser
   * still holds the subscription. Null only where there is no session at all.
   *
   * Per tenant and not per account: a message names what is due in one
   * tenant, and a telephone that works in two gets the messages of the one it
   * was switched on in.
   */
  const pushSubscriptions = pgTable(
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
   * An occasion a person does not want as push. Every occasion is on until
   * somebody switches it off, which is a row here; switching it on again
   * removes the row. For every device of that person in the tenant at once.
   */
  const pushOptOuts = pgTable(
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
   * Every push message, one row per device, before and after it went out;
   * the push counterpart of the outbox of the mail.
   *
   * Title, text and link are fixed when the row is written, and none of them
   * should carry a name or an address: the message passes through the push
   * service of the browser's maker, encrypted, and says only what is due.
   * What it is about in detail the device shows after the tap.
   *
   * `cause` makes a message happen once per cause and device, like a mail
   * once per cause. `expires_at` is when it is no use any more, so that a
   * message that could not go out by then is given up rather than sent late.
   */
  const pushOutbox = pgTable(
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

  return { pushEntry, pushKind, pushStatus, pushSubscriptions, pushOptOuts, pushOutbox }
}

/** The tables of push of an application with these entries and occasions. */
export type PushTables<
  Entry extends string = string,
  Occasion extends string = string,
> = ReturnType<typeof pushParts<Entry, Occasion>>

/** What an application says about push. */
export interface PushSchemaOptions<Entry extends string, Occasion extends string> {
  /**
   * The entries a device can open the application in, which decide where a
   * tap on a message leads.
   */
  readonly entries: readonly [Entry, ...Entry[]]
  /**
   * The occasions a person can switch off, in the order the enum has them;
   * the foundation adds its test message at the end. A new occasion stands
   * before it, and drizzle-kit writes it so (`ADD VALUE ... BEFORE 'test'`).
   */
  readonly occasions: readonly [Occasion, ...Occasion[]]
}

/**
 * Push to the devices of the people in a tenant: the devices, the occasions
 * somebody switched off and the outbox, with their enums, made by an
 * application for the entries and occasions it has.
 *
 * **Which entries and occasions there are is the application's list**, under
 * one name in every application. So this is a function and not a set of
 * tables. An application calls it in the file drizzle-kit reads its schema
 * from and exports what comes back.
 */
export function pushSchema<const Entry extends string, const Occasion extends string>(
  options: PushSchemaOptions<Entry, Occasion>,
): PushTables<Entry, Occasion> {
  return pushParts(options.entries, options.occasions)
}
