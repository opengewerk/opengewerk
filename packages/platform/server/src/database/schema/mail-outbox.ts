import type { BuildColumns, BuildExtraConfigColumns } from 'drizzle-orm'
import {
  foreignKey,
  index,
  integer,
  type PgColumnBuilderBase,
  type PgEnum,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { invitations } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * Where a message stands. `failed` is the end of trying, not the end of the
 * row: the message stays, with the last error, and nothing is ever deleted.
 */
export const mailStatuses = ['pending', 'sent', 'failed'] as const

export type MailStatusValue = (typeof mailStatuses)[number]

/** The enums and the columns every outbox has, whatever its application sends. */
function outboxParts<const Kind extends string>(kinds: readonly [Kind, ...Kind[]]) {
  const mailKind = pgEnum('mail_kind', kinds)
  const mailStatus = pgEnum('mail_status', mailStatuses)

  const columns = {
    id: primaryId<'mail'>(),
    ...tenantColumn,
    kind: mailKind('kind').notNull(),
    cause: text('cause').notNull(),
    /** The invitation a message is about, whose link is made when it goes out. */
    invitationId: reference<'invitation'>('invitation_id'),
    /** Who asked for the message, for one somebody asked for. Null for one nobody asked for. */
    requestedBy: text('requested_by'),
    senderName: text('sender_name').notNull(),
    replyTo: text('reply_to'),
    recipientAddress: text('recipient_address').notNull(),
    recipientName: text('recipient_name'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: mailStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  }

  return { mailKind, mailStatus, columns }
}

/** The columns of an outbox whose application sends these kinds of message. */
export type MailOutboxColumns<Kind extends string> = ReturnType<typeof outboxParts<Kind>>['columns']

/**
 * Columns an application adds to its outbox. None may take the name of one
 * the outbox has; the schema refuses that when it is made.
 */
export type OwnOutboxColumns = Record<string, PgColumnBuilderBase>

/**
 * The outbox of an application with these kinds and columns of its own.
 *
 * Written out with the names drizzle gives its types, and the factory below
 * says it returns this: left to itself, the compiler writes the columns of a
 * table with columns of the application's own into the declaration as a type
 * nobody can use, a column of every dialect at once.
 */
export type MailOutboxTable<
  Kind extends string = string,
  Own extends OwnOutboxColumns = Record<never, never>,
> = PgTableWithColumns<{
  name: 'mail_outbox'
  schema: undefined
  columns: BuildColumns<'mail_outbox', MailOutboxColumns<Kind> & Own, 'pg'>
  dialect: 'pg'
}>

/** The outbox and its enums, as an application exports them from its schema. */
export interface MailOutboxSchema<Kind extends string, Own extends OwnOutboxColumns> {
  readonly mailKind: PgEnum<[Kind, ...Kind[]]>
  readonly mailStatus: PgEnum<['pending', 'sent', 'failed']>
  readonly mailOutbox: MailOutboxTable<Kind, Own>
}

/** What an application says about its outbox. */
export interface MailOutboxOptions<Kind extends string, Own extends OwnOutboxColumns> {
  /**
   * What a message can be about, in the order the enum has them. A value is
   * only ever added at the end (`ALTER TYPE ... ADD VALUE`), so the order is
   * the order the application learnt them in.
   */
  readonly kinds: readonly [Kind, ...Kind[]]
  /** Columns of the application, for the records its messages are about. */
  readonly columns?: Own
  /** The keys and indexes of those columns. */
  readonly constraints?: (
    table: BuildExtraConfigColumns<'mail_outbox', MailOutboxColumns<Kind> & Own, 'pg'>,
  ) => PgTableExtraConfigValue[]
}

/**
 * Every message an instance sends, before and after it went out: the table
 * and its enums, made by an application for the kinds of message it has.
 *
 * A message is written here in the transaction of whatever caused it and sent
 * afterwards, by the job in `mail/worker.ts`. A mail server that does not
 * answer for two hours therefore costs two hours and nothing else: the row
 * waits, the job tries again, and the cause that wrote it has long committed.
 * The same shape as the outbox of a device, turned round.
 *
 * What goes out is decided when the row is written, subject and text included.
 * The row is the record of what a tenant told somebody and when, which is the
 * question the audit log will be asked about a message; a text put together
 * again at sending time could say something the row does not. The one part
 * made at sending time is the link of an invitation, which is never kept.
 *
 * `cause` makes a message happen once per cause. A reminder of something due
 * on a day is caused by the thing and its day, so a job that looks every
 * minute writes one row and not sixty, and a thing moved to another day is a
 * new cause.
 *
 * **Which kinds there are is the application's list**, under one name in
 * every application, and so are the columns for what its messages are about:
 * one application's outbox points at its own records, another's at nothing
 * but an invitation. So this is a function and not a table. An application
 * calls it in the file drizzle-kit reads its schema from and exports what
 * comes back.
 */
export function mailOutboxSchema<
  const Kind extends string,
  Own extends OwnOutboxColumns = Record<never, never>,
>(options: MailOutboxOptions<Kind, Own>): MailOutboxSchema<Kind, Own> {
  const { mailKind, mailStatus, columns: base } = outboxParts(options.kinds)
  const own = options.columns ?? ({} as Own)
  const taken = Object.keys(own).filter((name) => name in base)

  if (taken.length > 0) {
    throw new Error(`The outbox has these columns already: ${taken.join(', ')}.`)
  }

  const mailOutbox = pgTable(
    'mail_outbox',
    { ...base, ...own } as MailOutboxColumns<Kind> & Own,
    (table) => [
      tenantIsolation(table.tenantId),
      foreignKey({
        columns: [table.tenantId, table.invitationId],
        foreignColumns: [invitations.tenantId, invitations.id],
        name: 'mail_outbox_invitation_in_tenant',
      }).onDelete('restrict'),
      unique('mail_outbox_once_per_cause').on(table.tenantId, table.cause),
      index('mail_outbox_due_idx').on(table.tenantId, table.status, table.nextAttemptAt),
      index('mail_outbox_invitation_idx').on(table.tenantId, table.invitationId),
      ...(options.constraints?.(table) ?? []),
    ],
  )

  return { mailKind, mailStatus, mailOutbox }
}

/** A message as every outbox has it, whatever else its application keeps beside. */
export type OutboxMessage = MailOutboxTable['$inferSelect']
