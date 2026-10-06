import { type BuildColumns, type BuildExtraConfigColumns } from 'drizzle-orm'
import {
  bigint,
  foreignKey,
  index,
  type PgColumnBuilderBase,
  pgTable,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { files } from './files.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/** The columns every table of files has, whatever its application hangs a file on. */
function attachmentParts() {
  return {
    id: primaryId<'attachment'>(),
    ...tenantColumn,
    title: text('title').notNull(),
    ...timestamps,
    ...syncColumns,
  }
}

/** The columns every version of a file has. */
function versionParts() {
  return {
    id: primaryId<'attachment-version'>(),
    ...tenantColumn,
    attachmentId: reference<'attachment'>('attachment_id').notNull(),
    sha256: text('sha256').notNull(),
    fileName: text('file_name').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    previewSha256: text('preview_sha256'),
    createdBy: text('created_by'),
    ...timestamps,
    ...syncColumns,
  }
}

/** The columns every table of files has. */
export type AttachmentColumns = ReturnType<typeof attachmentParts>

/** The columns every table of versions has. */
export type AttachmentVersionColumns = ReturnType<typeof versionParts>

/**
 * Columns an application adds to its files or to their versions: the keys of
 * what a file hangs on, and what follows from them. None may take the name of
 * one the table has; the schema refuses that when it is made.
 */
export type OwnAttachmentColumns = Record<string, PgColumnBuilderBase>

/**
 * The files of an application with these columns of its own.
 *
 * Written out with the names drizzle gives its types, like the outbox, the
 * deadlines and the contacts: left to itself, the compiler writes the columns
 * of a table with columns of the application's own into the declaration as a
 * type nobody can use.
 */
export type AttachmentsTable<Own extends OwnAttachmentColumns = Record<never, never>> =
  PgTableWithColumns<{
    name: 'attachments'
    schema: undefined
    columns: BuildColumns<'attachments', AttachmentColumns & Own, 'pg'>
    dialect: 'pg'
  }>

/** The versions of those files, with the columns the application adds to them. */
export type AttachmentVersionsTable<Own extends OwnAttachmentColumns = Record<never, never>> =
  PgTableWithColumns<{
    name: 'attachment_versions'
    schema: undefined
    columns: BuildColumns<'attachment_versions', AttachmentVersionColumns & Own, 'pg'>
    dialect: 'pg'
  }>

/** The files and their versions, as an application exports them from its schema. */
export interface AttachmentsSchema<
  Own extends OwnAttachmentColumns,
  VersionOwn extends OwnAttachmentColumns,
> {
  readonly attachments: AttachmentsTable<Own>
  readonly attachmentVersions: AttachmentVersionsTable<VersionOwn>
}

/** What an application says about its files. */
export interface AttachmentsOptions<
  Own extends OwnAttachmentColumns,
  VersionOwn extends OwnAttachmentColumns,
> {
  /** Columns of the application, for what a file hangs on. */
  readonly columns?: Own
  /** The keys, checks, indexes and policies of those columns. */
  readonly constraints?: (
    table: BuildExtraConfigColumns<'attachments', AttachmentColumns & Own, 'pg'>,
  ) => PgTableExtraConfigValue[]
  /**
   * Columns of the application on a version, for what it keeps a version
   * apart by beyond the tenant and has to hold on every row.
   */
  readonly versionColumns?: VersionOwn
  /** The keys, checks, indexes and policies of those. */
  readonly versionConstraints?: (
    table: BuildExtraConfigColumns<
      'attachment_versions',
      AttachmentVersionColumns & VersionOwn,
      'pg'
    >,
  ) => PgTableExtraConfigValue[]
}

function refuseTaken(what: string, own: OwnAttachmentColumns, base: object): void {
  const taken = Object.keys(own).filter((name) => name in base)

  if (taken.length > 0) {
    throw new Error(`${what} have these columns already: ${taken.join(', ')}.`)
  }
}

/**
 * The files in the records of a tenant, with their versions
 * (opengewerk-haustechnik#97): the two tables, made by an application with
 * the columns for what a file of its own hangs on.
 *
 * A file is what it is called; the bytes are in its versions. Both travel to
 * devices, so both carry the sync columns, and a file is marked as deleted
 * and never removed: a row that is gone is a row a device that was offline
 * never hears about.
 *
 * **A version is written once and never changed.** It names its file by hash
 * and finds it by tenant and hash, both keys over the tenant onto the one row
 * per tenant and content in `files`. A version can therefore only name bytes
 * its own tenant has stored: the store is shared by every tenant of the
 * instance, the row in `files` is what makes a file a tenant's, and a hash of
 * somebody else's file is a string and not a way in. `created_by` is written
 * by a trigger from the request and carries no key, because it records who
 * acted. Both triggers come with `attachmentVersionsGuard`, their functions
 * with the block `attachments.sql`.
 *
 * **What a file hangs on is the application's**: one hangs it on the records
 * it works for, another on a place or a piece of equipment. Each such column
 * is the application's, under a key over the tenant, so that a file cannot
 * point into another tenant, and the application says in a check what a file
 * has to hang on (`attachmentRules` holds the same rule in front of it, for a
 * screen and the sync). So this is a function and not two tables, like the
 * outbox, the deadlines and the contacts.
 *
 * Called without columns it is the tables as the building blocks of the
 * foundation know them, which is what an application holds its database
 * against.
 */
export function attachmentsSchema<
  Own extends OwnAttachmentColumns = Record<never, never>,
  VersionOwn extends OwnAttachmentColumns = Record<never, never>,
>(options: AttachmentsOptions<Own, VersionOwn> = {}): AttachmentsSchema<Own, VersionOwn> {
  const base = attachmentParts()
  const own = options.columns ?? ({} as Own)
  const versionBase = versionParts()
  const versionOwn = options.versionColumns ?? ({} as VersionOwn)

  refuseTaken('The files', own, base)
  refuseTaken('The versions of a file', versionOwn, versionBase)

  const attachments = pgTable(
    'attachments',
    { ...base, ...own } as AttachmentColumns & Own,
    (table) => [
      tenantIsolation(table.tenantId),
      unique('attachments_tenant_id_key').on(table.tenantId, table.id),
      ...(options.constraints?.(table) ?? []),
    ],
  )

  // Read as every table of files, for the key of a version onto its file: the
  // columns of the application are none of that key's business.
  const plain = attachments as unknown as AttachmentsTable

  const attachmentVersions = pgTable(
    'attachment_versions',
    { ...versionBase, ...versionOwn } as AttachmentVersionColumns & VersionOwn,
    (table) => [
      tenantIsolation(table.tenantId),
      unique('attachment_versions_tenant_id_key').on(table.tenantId, table.id),
      foreignKey({
        columns: [table.tenantId, table.attachmentId],
        foreignColumns: [plain.tenantId, plain.id],
        name: 'attachment_versions_attachment_in_tenant',
      }).onDelete('restrict'),
      foreignKey({
        columns: [table.tenantId, table.sha256],
        foreignColumns: [files.tenantId, files.sha256],
        name: 'attachment_versions_file_in_tenant',
      }).onDelete('restrict'),
      foreignKey({
        columns: [table.tenantId, table.previewSha256],
        foreignColumns: [files.tenantId, files.sha256],
        name: 'attachment_versions_preview_in_tenant',
      }).onDelete('restrict'),
      index('attachment_versions_attachment_idx').on(table.tenantId, table.attachmentId),
      ...(options.versionConstraints?.(table) ?? []),
    ],
  )

  return { attachments, attachmentVersions }
}

/** A file as every table of files has it, whatever else its application keeps beside. */
export type AttachmentRow = AttachmentsTable['$inferSelect']

/** A version as every table of versions has it. */
export type AttachmentVersionRow = AttachmentVersionsTable['$inferSelect']
