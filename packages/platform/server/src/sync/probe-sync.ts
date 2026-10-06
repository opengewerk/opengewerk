import {
  type MemberIdentity,
  type Operation,
  type OperationKind,
  rightsCatalogue,
  syncRights,
  syncRules,
} from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { eq, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { databaseErrors } from '../api/database-errors.js'
import type { FoundIdentity } from '../api/identity.js'
import { probeCatalogue } from '../authentication/probe-application.js'
import { attachmentsSchema } from '../database/schema/attachments.js'
import { primaryId, reference, syncColumns, timestamps } from '../database/schema/columns.js'
import { contactsSchema } from '../database/schema/contacts.js'
import { tenantIsolation } from '../database/schema/rls.js'
import { tenantColumn } from '../database/schema/tenants.js'
import { probeMade } from '../database/probe-schema.js'
import {
  attachmentsGuard,
  attachmentVersionsGuard,
  contactsGuard,
  type MadeByTheApplication,
  type TableGuard,
} from '../migration/guards.js'
import type { ServerSync } from './apply.js'
import type { SyncRoutes } from './controller.js'
import { fingerprintOf, idArray } from './narrowing.js'

// Records of the probe application that travel to devices, for the tests of
// the sync on the server. Named the way the probe policies name them, which is
// how a table is found for an entity, and kept by no application of the
// organisation: a test that passed with the tables of a real one would not show
// that the mechanism knows none of them.

/** Master data: made on a device, corrected only with a connection. A shelf can be closed for new notes. */
export const shelves = pgTable(
  'shelves',
  {
    id: primaryId<'shelf'>(),
    ...tenantColumn,
    label: text('label').notNull(),
    closed: boolean('closed').notNull().default(false),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('shelves_tenant_id_id').on(table.tenantId, table.id),
  ],
)

/**
 * What work produces: made and changed on a device, field by field. With a
 * list and a value of JSON, which travel as their text.
 */
export const notes = pgTable(
  'notes',
  {
    id: primaryId<'note'>(),
    ...tenantColumn,
    shelfId: reference<'shelf'>('shelf_id'),
    text: text('text').notNull(),
    tags: text('tags').array(),
    details: jsonb('details').$type<Readonly<Record<string, unknown>>>(),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      name: 'notes_shelf',
      columns: [table.tenantId, table.shelfId],
      foreignColumns: [shelves.tenantId, shelves.id],
    }),
  ],
)

/** Written while a draft and not after; the state is the server's. */
export const letters = pgTable(
  'letters',
  {
    id: primaryId<'letter'>(),
    ...tenantColumn,
    subject: text('subject').notNull(),
    status: text('status').notNull().default('draft'),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('letters_tenant_id_id').on(table.tenantId, table.id),
  ],
)

/** Lines of a letter: the gate sits on the letter, and the total is the server's. */
export const letterLines = pgTable(
  'letter_lines',
  {
    id: primaryId<'letter-line'>(),
    ...tenantColumn,
    letterId: reference<'letter'>('letter_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    price: integer('price').notNull().default(0),
    total: integer('total').notNull().default(0),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      name: 'letter_lines_letter',
      columns: [table.tenantId, table.letterId],
      foreignColumns: [letters.tenantId, letters.id],
    }),
  ],
)

/**
 * A seal on a letter: made on a device while the letter is a draft, never
 * changed, and named by the server after whoever sent it. What comes of it,
 * the letter sealed, the server writes as it takes the seal.
 */
export const letterSeals = pgTable(
  'letter_seals',
  {
    id: primaryId<'letter-seal'>(),
    ...tenantColumn,
    letterId: reference<'letter'>('letter_id').notNull(),
    sealedBy: text('sealed_by').notNull(),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      name: 'letter_seals_letter',
      columns: [table.tenantId, table.letterId],
      foreignColumns: [letters.tenantId, letters.id],
    }),
  ],
)

/**
 * What a contact of the probe application hangs on: somebody to ask about a
 * shelf, or the person a letter goes to, never both. The two columns, their
 * keys over the tenant and the check are the application's, the way an
 * application says what its contacts hang on. Beside them the label of the
 * shelf a contact was filed under, which the server works out and no request
 * sets: the kind of column an application adds for what follows from a parent.
 */
const probeContactColumns = {
  shelfId: reference<'shelf'>('shelf_id'),
  letterId: reference<'letter'>('letter_id'),
  filedUnder: text('filed_under'),
}

/** The columns the probe application gives its contacts. */
export type ProbeContactColumns = typeof probeContactColumns

export const { contacts: probeContacts } = contactsSchema({
  columns: probeContactColumns,
  constraints: (table) => [
    foreignKey({
      name: 'contacts_shelf',
      columns: [table.tenantId, table.shelfId],
      foreignColumns: [shelves.tenantId, shelves.id],
    }),
    foreignKey({
      name: 'contacts_letter',
      columns: [table.tenantId, table.letterId],
      foreignColumns: [letters.tenantId, letters.id],
    }),
    check('contacts_on_one_record', sql`num_nonnulls(${table.shelfId}, ${table.letterId}) = 1`),
    index('contacts_shelf_idx').on(table.tenantId, table.shelfId),
  ],
})

/**
 * What a file of the probe application hangs on: a scan filed under a shelf,
 * the scan of a letter, or both at once, and never neither. The two columns,
 * their keys over the tenant and the check are the application's, the way an
 * application says what its files hang on.
 */
const probeAttachmentColumns = {
  shelfId: reference<'shelf'>('shelf_id'),
  letterId: reference<'letter'>('letter_id'),
}

/** The columns the probe application gives its files. */
export type ProbeAttachmentColumns = typeof probeAttachmentColumns

export const { attachments: probeAttachments, attachmentVersions: probeAttachmentVersions } =
  attachmentsSchema({
    columns: probeAttachmentColumns,
    constraints: (table) => [
      foreignKey({
        name: 'attachments_shelf',
        columns: [table.tenantId, table.shelfId],
        foreignColumns: [shelves.tenantId, shelves.id],
      }),
      foreignKey({
        name: 'attachments_letter',
        columns: [table.tenantId, table.letterId],
        foreignColumns: [letters.tenantId, letters.id],
      }),
      check(
        'attachments_hang_somewhere',
        sql`num_nonnulls(${table.shelfId}, ${table.letterId}) >= 1`,
      ),
      index('attachments_shelf_idx').on(table.tenantId, table.shelfId),
    ],
  })

/** The rules of the probe application, as an application makes them. */
export const probeSyncRules = syncRules(probePolicies)

const travelling = (table: string): TableGuard => ({
  table,
  // Marked as deleted, never removed: no `delete`.
  grants: ['select', 'insert', 'update'],
  audited: true,
  synced: true,
})

/** The tables above, with what the probe application already makes. */
export const probeSyncMade: MadeByTheApplication = {
  schema: {
    ...probeMade.schema,
    shelves,
    notes,
    letters,
    letterLines,
    letterSeals,
    contacts: probeContacts,
    attachments: probeAttachments,
    attachmentVersions: probeAttachmentVersions,
  },
  guards: [
    ...probeMade.guards,
    travelling('shelves'),
    travelling('notes'),
    travelling('letters'),
    travelling('letter_lines'),
    travelling('letter_seals'),
    contactsGuard,
    attachmentsGuard,
    attachmentVersionsGuard,
  ],
}

/** A condition no row meets, for a device that may hold none of an entity. */
export const nothing = sql`false`

/**
 * The rights of the probe application, as one whose devices work without a
 * network: those of the sync, and one to write each kind of record beside the
 * notes it already had.
 */
export const probeSyncCatalogue = rightsCatalogue([
  ...probeCatalogue.rights,
  syncRights.read,
  syncRights.write,
  'shelves.write',
  'letters.write',
])

export type ProbeSyncRight = (typeof probeSyncCatalogue.rights)[number]

/** Somebody of a tenant of the probe application, with the rights of the sync among theirs. */
export type ProbeSyncIdentity = MemberIdentity<ProbeSyncRight>

/** What the routes of the sync are told about the rights of the probe application. */
export const probeSyncAccess = { catalogue: probeSyncCatalogue }

/**
 * The right an operation of the probe application asks for. Moving a note to
 * another shelf is sorting the shelves, which whoever keeps them does, and
 * not writing a note: the kind of question an application answers from what
 * an operation does and not only from what it touches.
 */
export function probePermissionFor(
  entity: string,
  kind: OperationKind,
  patches: Operation['patches'],
): ProbeSyncRight | null {
  if (
    entity === 'notes' &&
    kind === 'update' &&
    patches.some((patch) => patch.field === 'shelfId')
  ) {
    return 'shelves.write'
  }

  const subject: Readonly<Record<string, ProbeSyncRight>> = {
    shelves: 'shelves.write',
    notes: 'notes.write',
    letters: 'letters.write',
    letter_lines: 'letters.write',
    letter_seals: 'letters.write',
  }

  return subject[entity] ?? null
}

/**
 * The routes of the sync of the probe application, around one of its syncs on
 * the server.
 *
 * What a device holds depends on two things, the way it does in a real
 * application: on who asks, since the letters and their lines are for whoever
 * writes letters and a device of anybody else holds none; and on what the
 * device asks for, since one can ask for the notes of the open shelves alone.
 * Each note goes out with the label of its shelf, a value no column of the
 * note holds, read in the transaction of the pull.
 */
export function probeSyncRoutes(
  sync: ServerSync<FoundIdentity<ProbeSyncIdentity>>,
  answerFor: SyncRoutes['answerFor'] = databaseErrors().answerFor,
): SyncRoutes<ProbeSyncIdentity, ProbeSyncRight> {
  return {
    sync,
    permissionFor: probePermissionFor,
    answerFor,
    async scope({ tx, identity, query }) {
      const writesLetters = identity.rights.includes('letters.write')
      const openOnly = query['shelves'] === 'open'
      const open = openOnly
        ? (
            await tx
              .select({ id: shelves.id })
              .from(shelves)
              .where(eq(shelves.closed, false))
              .orderBy(shelves.id)
          ).map((row) => row.id as string)
        : []

      return {
        narrow(entity) {
          if ((entity === 'letters' || entity === 'letter_lines') && !writesLetters) {
            return nothing
          }

          return entity === 'notes' && openOnly
            ? sql`${notes.shelfId} = any(${idArray(open)})`
            : undefined
        },
        narrowed: {
          letters: writesLetters ? 'all' : 'none',
          letter_lines: writesLetters ? 'all' : 'none',
          notes: openOnly ? `shelves:${fingerprintOf(open)}` : 'all',
        },
        async answer(changes) {
          const labels = new Map(
            (await tx.select({ id: shelves.id, label: shelves.label }).from(shelves)).map((row) => [
              row.id as string,
              row.label,
            ]),
          )

          return changes.map((change) =>
            change.entity !== 'notes'
              ? change
              : {
                  entity: change.entity,
                  rows: change.rows.map((row) => ({
                    ...row,
                    shelfLabel: labels.get(String(row['shelfId'])) ?? null,
                  })),
                },
          )
        },
      }
    },
  }
}
