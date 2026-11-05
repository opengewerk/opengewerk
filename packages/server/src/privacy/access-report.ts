import {
  auditLanguage,
  auditVocabulary,
  type PersonalSubject,
  personalDataCatalogue,
  withheldAuditValue,
} from '@opengewerk/domain'
import { type TenantTransaction } from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'

/**
 * What the business holds about one person (#318, Art. 15 and 20 DSGVO),
 * gathered from the schema rather than from a list kept by hand: the
 * catalogue of personal data says which tables are about which kind of
 * person (#317), and the foreign keys of the database say which rows hang on
 * the person's own row. A table that is about a kind of person is reached
 * along those keys, by a way of its own below, or left out here with the
 * reason; `access-report.test.ts` turns red when one is none of the three.
 *
 * - A customer: every row that hangs on it, its sites, jobs, documents,
 *   installations and what hangs on those in turn, as far as the rows are
 *   about customers or about nobody (the structure of an installation). A row
 *   that names another customer is dropped and not followed. The names of the
 *   staff in those rows stay; the data of other customers do not come in,
 *   and neither do its contacts, who are people of their own.
 * - A contact or a lead: its row, the mails to its address, and for a contact
 *   the notes and calls of its customer that name it.
 * - Somebody of the staff: the file and the membership with what hangs on
 *   them, and the rows that name the person's account. Where such a row is
 *   about a customer, a contact or a lead, a task handed to the person or a
 *   document they issued, the report says only that and when (`actions`):
 *   the content is somebody else's.
 *
 * Every report holds the entries of the change log of its rows, and the
 * files its rows keep. It runs in the tenant's transaction, so row level
 * security keeps every other business out.
 */

/** A row as the database gave it, its moments as ISO text. */
export type ReportRow = Readonly<Record<string, unknown>>

/** Something the person did, or was handed, on a record that is not theirs. */
export interface ReportAction {
  readonly table: string
  readonly recordId: string | null
  /** The column that names the person: "created_by", "assignee_user_id", or "field" for the change log. */
  readonly column: string
  readonly at: string | null
}

/** A change of a value of a reported row, from the change log. */
export interface ReportChange {
  readonly table: string
  readonly recordId: string
  readonly field: string
  readonly operation: string
  readonly before: string | null
  readonly after: string | null
  readonly by: string | null
  readonly at: string
  readonly reason: string | null
}

/** A file one of the reported rows keeps. */
export interface ReportFile {
  readonly table: string
  readonly recordId: string
  readonly sha256: string
  readonly mediaType: string
  /** What the file was called, or what it is: "Rechnung RE-2026-0012". */
  readonly name: string
}

export interface AccessReport {
  readonly subject: PersonalSubject
  readonly subjectId: string
  /** The rows that are the person's, by table, in the order they were reached. */
  readonly tables: ReadonlyMap<string, readonly ReportRow[]>
  readonly actions: readonly ReportAction[]
  readonly changes: readonly ReportChange[]
  readonly files: readonly ReportFile[]
  /** The ids of the accounts the report names, whose names the answer prints. */
  readonly accounts: readonly string[]
}

/** The table each kind of person starts from. */
export const accessRoots: Readonly<Record<PersonalSubject, string>> = {
  customer: 'customers',
  contact: 'contacts',
  prospect: 'prospects',
  person: 'people',
}

/**
 * Tables about a kind of person that the report reads otherwise than along
 * the foreign keys from the person's row, each by a way of its own below.
 * For the staff, every table whose catalogue names a column of a person
 * (`user_id`, `…_by`) is read by that column as well (`accountColumns`).
 */
export const accessWays: Readonly<Record<PersonalSubject, readonly string[]>> = {
  customer: ['audit_entries', 'mail_outbox', 'secrets', 'sync_conflicts'],
  contact: ['access_requests', 'audit_entries', 'communications', 'mail_outbox'],
  prospect: ['audit_entries', 'mail_outbox'],
  person: ['audit_entries', 'invitations', 'memberships'],
}

/** Kept by the instance for an account, not by a business, and invisible within one. */
const instanceOnly =
  'kept by the instance for the account, not by the business, and invisible within it; the name and address of the account come with the membership'

/** Tables about a kind of person the report leaves out, and why. */
export const accessLeftOut: Readonly<Record<PersonalSubject, Readonly<Record<string, string>>>> = {
  customer: {},
  contact: {
    grid_operators:
      'the contact person of a grid operator is a field of the operator, tied to no contact of the business',
  },
  prospect: {},
  person: {
    auth_accounts: instanceOnly,
    auth_address_confirmations: instanceOnly,
    auth_passkeys: instanceOnly,
    auth_rate_limits: instanceOnly,
    auth_sessions: instanceOnly,
    auth_two_factors: instanceOnly,
    auth_users: instanceOnly,
    auth_verifications: instanceOnly,
    instance_changes: instanceOnly,
    instance_operators: instanceOnly,
    grid_operators:
      'the responsible electrician of an entry in an installer directory is a name typed in, tied to no person',
  },
}

/**
 * Columns no answer gives out, by table: what opens a way in or reaches a
 * device (the hash of a link, the keys of a push subscription, the key of a
 * session or a passkey) and the sealed values of a way into a site. The rows
 * are in the answer, these values are not. `tenant_id` is left out of every
 * row besides.
 */
export const withheldColumns: Readonly<Record<string, readonly string[]>> = {
  calendar_feeds: ['token_hash'],
  invitations: ['token_hash'],
  member_passkeys: ['passkey_id'],
  push_subscriptions: ['session_id', 'endpoint', 'p256dh', 'auth'],
  secrets: ['sealed'],
  tenant_sessions: ['session_id'],
}

/** Whether a column sounds like a key or a secret, which the test asks of every column. */
export function soundsSecret(column: string): boolean {
  return (
    /(^|_)(token|secret|password|sealed|p256dh|endpoint)(_|$)/.test(column) ||
    /_hash$/.test(column) ||
    column === 'auth' ||
    column === 'session_id' ||
    column === 'passkey_id'
  )
}

/** A foreign key column by column: the child's column points at the parent's. */
export interface KeyColumn {
  readonly child: string
  readonly childColumn: string
  readonly parent: string
  readonly parentColumn: string
}

/** What the report needs of the schema: the columns it may read, and the keys. */
export interface ReportSchema {
  readonly columns: ReadonlyMap<string, readonly string[]>
  readonly keys: readonly KeyColumn[]
}

/** Reads the schema as the transaction's role sees it. */
export async function reportSchema(tx: TenantTransaction): Promise<ReportSchema> {
  const { rows: keys } = await tx.execute<{
    child: string
    child_column: string
    parent: string
    parent_column: string
  }>(sql`
    select c.conrelid::regclass::text as child, ca.attname as child_column,
           c.confrelid::regclass::text as parent, pa.attname as parent_column
      from pg_constraint c
      cross join lateral unnest(c.conkey, c.confkey) as k(child_attnum, parent_attnum)
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = k.child_attnum
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.parent_attnum
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and ca.attname <> 'tenant_id'
     order by 1, 2`)
  const { rows: columns } = await tx.execute<{ table_name: string; column_name: string }>(sql`
    select c.table_name, c.column_name
      from information_schema.columns c
      join pg_class t on t.relname = c.table_name and t.relnamespace = 'public'::regnamespace and t.relkind = 'r'
     where c.table_schema = 'public'
       and has_column_privilege(format('public.%I', c.table_name), c.column_name, 'SELECT')
     order by c.table_name, c.ordinal_position`)
  const readable = new Map<string, string[]>()

  for (const { table_name: table, column_name: column } of columns) {
    if (column === 'tenant_id' || (withheldColumns[table] ?? []).includes(column)) {
      continue
    }

    readable.set(table, [...(readable.get(table) ?? []), column])
  }

  return {
    columns: readable,
    keys: keys.map((key) => ({
      child: key.child,
      childColumn: key.child_column,
      parent: key.parent,
      parentColumn: key.parent_column,
    })),
  }
}

/** The kinds of person a table is about, from the catalogue. */
function aboutOf(table: string): readonly PersonalSubject[] | null {
  return Object.hasOwn(personalDataCatalogue, table)
    ? (personalDataCatalogue[table]?.about ?? null)
    : null
}

/**
 * Whether the walk from a customer goes into a table: one about customers,
 * or one about nobody, which is the structure of an installation and may hold
 * what is about the customer again below it.
 */
export function customerWalksInto(table: string): boolean {
  const about = aboutOf(table)

  return about !== null && (about.length === 0 || about.includes('customer'))
}

/** Whether a table is about the staff only, so that a row of it found by the person is theirs. */
export function onlyAboutStaff(table: string): boolean {
  const about = aboutOf(table)

  return about !== null && about.length === 1 && about[0] === 'person'
}

/**
 * The columns that name an account in a table about the staff, from the
 * catalogue: who holds the row (`user_id`, `…_user_id`) and who did
 * something (`…_by`). `audit_entries` has a way of its own.
 */
export function accountColumns(table: string): {
  readonly holders: readonly string[]
  readonly actors: readonly string[]
} {
  const entry = Object.hasOwn(personalDataCatalogue, table)
    ? personalDataCatalogue[table]
    : undefined

  if (entry === undefined || !entry.about.includes('person') || table === 'audit_entries') {
    return { holders: [], actors: [] }
  }

  return {
    holders: entry.columns.filter((column) => /(^|_)user_id$/.test(column)),
    actors: entry.columns.filter((column) => /_by$/.test(column)),
  }
}

/** A moment as the database spells it in text: "2026-11-05 05:39:54.36+00". */
const databaseMoment = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:?\d{2})?$/

/** A value of the database made plain for the answer, a moment as ISO text. */
function plain(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string' && databaseMoment.test(value)) {
    return new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString()
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map(plain)
  }

  return value
}

function plainRow(row: Record<string, unknown>): ReportRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plain(value)]))
}

/** The key a row is kept under: its id, or all of it for the few tables without one. */
function keyOf(row: ReportRow): string {
  return typeof row['id'] === 'string' ? row['id'] : JSON.stringify(row)
}

function columnsSql(columns: readonly string[]): SQL {
  return sql.join(
    columns.map((column) => sql.identifier(column)),
    sql`, `,
  )
}

/** The rows of a table whose column holds one of the values, in pieces of five hundred. */
async function rowsWhere(
  tx: TenantTransaction,
  schema: ReportSchema,
  table: string,
  column: string,
  values: readonly string[],
): Promise<ReportRow[]> {
  const columns = schema.columns.get(table)

  if (columns === undefined || values.length === 0 || !columns.includes(column)) {
    return []
  }

  const found: ReportRow[] = []

  for (let start = 0; start < values.length; start += 500) {
    const piece = values.slice(start, start + 500)
    const { rows } = await tx.execute<Record<string, unknown>>(
      sql`select ${columnsSql(columns)} from ${sql.identifier(table)}
           where ${sql.identifier(column)}::text = any(${sql.param(piece)}::text[])`,
    )

    found.push(...rows.map(plainRow))
  }

  return found
}

/** Rows by table, each once. */
class Reached {
  readonly rows = new Map<string, Map<string, ReportRow>>()

  /** Adds rows of a table and says how many were new. */
  add(table: string, rows: readonly ReportRow[]): number {
    const kept = this.rows.get(table) ?? new Map<string, ReportRow>()
    let fresh = 0

    for (const row of rows) {
      const key = keyOf(row)

      if (!kept.has(key)) {
        kept.set(key, row)
        fresh += 1
      }
    }

    this.rows.set(table, kept)

    return fresh
  }

  of(table: string): readonly ReportRow[] {
    return [...(this.rows.get(table)?.values() ?? [])]
  }

  ids(): string[] {
    return [...this.rows.values()].flatMap((rows) =>
      [...rows.values()]
        .map((row) => row['id'])
        .filter((id): id is string => typeof id === 'string'),
    )
  }
}

/**
 * Follows the foreign keys from rows already reached into the tables the
 * walk may go into, until nothing new turns up. `keep` drops a row before it
 * is kept or followed.
 */
async function walk(
  tx: TenantTransaction,
  schema: ReportSchema,
  reached: Reached,
  start: readonly string[],
  into: (table: string) => boolean,
  keep: (table: string, row: ReportRow) => boolean,
): Promise<void> {
  const asked = new Map<string, Set<string>>()
  const queue = [...start]

  while (queue.length > 0) {
    const parent = queue.shift() as string
    const parentRows = reached.of(parent)

    for (const key of schema.keys) {
      if (key.parent !== parent || !into(key.child)) {
        continue
      }

      const name = `${key.child}.${key.childColumn}->${key.parent}.${key.parentColumn}`
      const done = asked.get(name) ?? new Set<string>()
      const values = [
        ...new Set(
          parentRows
            .map((row) => row[key.parentColumn])
            .filter((value) => value !== null && value !== undefined)
            .map(String),
        ),
      ].filter((value) => !done.has(value))

      values.forEach((value) => done.add(value))
      asked.set(name, done)

      const rows = (await rowsWhere(tx, schema, key.child, key.childColumn, values)).filter((row) =>
        keep(key.child, row),
      )

      if (reached.add(key.child, rows) > 0 && !queue.includes(key.child)) {
        queue.push(key.child)
      }
    }
  }
}

/** The mails to an address, by any of the addresses given. */
async function mailsTo(
  tx: TenantTransaction,
  schema: ReportSchema,
  addresses: readonly unknown[],
): Promise<ReportRow[]> {
  const wanted = [
    ...new Set(
      addresses
        .filter((address) => typeof address === 'string' && address.trim() !== '')
        .map((address) => (address as string).trim().toLowerCase()),
    ),
  ]
  const columns = schema.columns.get('mail_outbox')

  if (wanted.length === 0 || columns === undefined) {
    return []
  }

  const { rows } = await tx.execute<Record<string, unknown>>(
    sql`select ${columnsSql(columns)} from mail_outbox
         where lower(trim(recipient_address)) = any(${sql.param(wanted)}::text[])`,
  )

  return rows.map(plainRow)
}

const language = auditLanguage(auditVocabulary)

/**
 * Whether the change log keeps a value of a field to itself in the answer as
 * well: what the rows withhold, and what the log's own page does not spell
 * out. The answer says that there was one, as the page does.
 */
function withheldInLog(table: string, field: string): boolean {
  return (withheldColumns[table] ?? []).includes(field) || language.isSecret(table, field)
}

/** The entries of the change log of rows, oldest first. */
async function changesOf(
  tx: TenantTransaction,
  reached: Reached,
  tables: readonly string[],
): Promise<ReportChange[]> {
  const ids = tables.flatMap((table) =>
    reached
      .of(table)
      .map((row) => row['id'])
      .filter((id): id is string => typeof id === 'string'),
  )
  const changes: ReportChange[] = []

  for (let start = 0; start < ids.length; start += 500) {
    const { rows } = await tx.execute<{
      table_name: string
      record_id: string
      field: string
      operation: string
      old_value: string | null
      new_value: string | null
      user_id: string | null
      changed_at: Date | string
      reason: string | null
    }>(sql`
      select table_name, record_id::text as record_id, field, operation::text as operation,
             old_value, new_value, user_id, changed_at, reason
        from audit_entries
       where record_id = any(${sql.param(ids.slice(start, start + 500))}::uuid[])
       order by sequence`)

    for (const row of rows) {
      if (!tables.includes(row.table_name)) {
        continue
      }

      const hidden = withheldInLog(row.table_name, row.field)

      changes.push({
        table: row.table_name,
        recordId: row.record_id,
        field: row.field,
        operation: row.operation,
        before: hidden && row.old_value !== null ? withheldAuditValue : row.old_value,
        after: hidden && row.new_value !== null ? withheldAuditValue : row.new_value,
        by: row.user_id,
        at: plain(row.changed_at) as string,
        reason: row.reason,
      })
    }
  }

  return changes.sort((one, other) => one.at.localeCompare(other.at))
}

/** The files the rows keep: versions of attachments, printed documents, certificates. */
async function filesOf(tx: TenantTransaction, reached: Reached): Promise<ReportFile[]> {
  const files: ReportFile[] = []

  for (const row of reached.of('attachment_versions')) {
    if (typeof row['sha256'] === 'string') {
      files.push({
        table: 'attachment_versions',
        recordId: String(row['id']),
        sha256: row['sha256'],
        mediaType: String(row['media_type'] ?? 'application/octet-stream'),
        name: String(row['file_name'] ?? row['sha256']),
      })
    }
  }

  const documentFiles = reached.of('document_files')
  const wantedIds = documentFiles.map((row) => String(row['file_id']))
  const wantedHashes = reached
    .of('qualifications')
    .map((row) => row['certificate_sha256'])
    .filter((hash): hash is string => typeof hash === 'string')
  const { rows: stored } =
    wantedIds.length + wantedHashes.length === 0
      ? { rows: [] }
      : await tx.execute<{ id: string; sha256: string; media_type: string }>(sql`
          select id::text as id, sha256, media_type from files
           where id::text = any(${sql.param(wantedIds)}::text[])
              or sha256 = any(${sql.param(wantedHashes)}::text[])`)
  const documents = new Map(reached.of('documents').map((row) => [String(row['id']), row]))

  for (const row of documentFiles) {
    const file = stored.find((entry) => entry.id === String(row['file_id']))
    const document = documents.get(String(row['document_id']))

    if (file !== undefined) {
      files.push({
        table: 'document_files',
        recordId: String(row['id']),
        sha256: file.sha256,
        mediaType: file.media_type,
        name: [document?.['number'] ?? 'Beleg', row['purpose']].filter(Boolean).join(' '),
      })
    }
  }

  for (const row of reached.of('qualifications')) {
    const file = stored.find((entry) => entry.sha256 === row['certificate_sha256'])

    if (file !== undefined) {
      files.push({
        table: 'qualifications',
        recordId: String(row['id']),
        sha256: file.sha256,
        mediaType: file.media_type,
        name: `Zertifikat ${String(row['kind_key'] ?? '')}`.trim(),
      })
    }
  }

  return files
}

/** The accounts the rows of the report name, for their names. */
function accountsNamed(reached: Reached, changes: readonly ReportChange[]): string[] {
  const ids = new Set<string>()

  for (const [table, rows] of reached.rows) {
    const { holders, actors } = accountColumns(table)
    const columns = [...holders, ...actors, 'created_by', 'updated_by', 'issued_by', 'user_id']

    for (const row of rows.values()) {
      for (const column of columns) {
        const value = row[column]

        if (typeof value === 'string' && value !== '') {
          ids.add(value)
        }
      }
    }
  }

  for (const change of changes) {
    if (change.by !== null) {
      ids.add(change.by)
    }
  }

  return [...ids].sort()
}

/** The rows of the tables that are about this kind of person, in the order they were reached. */
function reportedTables(
  reached: Reached,
  subject: PersonalSubject,
): Map<string, readonly ReportRow[]> {
  const tables = new Map<string, readonly ReportRow[]>()

  for (const table of reached.rows.keys()) {
    const about = aboutOf(table)
    const rows = reached.of(table)

    if (about !== null && about.includes(subject) && rows.length > 0) {
      tables.set(table, rows)
    }
  }

  return tables
}

async function customerReport(
  tx: TenantTransaction,
  schema: ReportSchema,
  customerId: string,
): Promise<AccessReport | null> {
  const reached = new Reached()
  const [customer] = await rowsWhere(tx, schema, 'customers', 'id', [customerId])

  if (customer === undefined) {
    return null
  }

  reached.add('customers', [customer])

  // A row that names another customer is somebody else's, and not followed.
  const ours = (_table: string, row: ReportRow) =>
    !Object.hasOwn(row, 'customer_id') ||
    row['customer_id'] === null ||
    row['customer_id'] === customerId

  await walk(tx, schema, reached, ['customers'], customerWalksInto, ours)

  // The sealed ways into its sites and the conflicts of its records, by the
  // record they belong to; the mails to it by its address as well. Its
  // contacts are people of their own (Art. 15 (4) DSGVO): the catalogue does
  // not count them as the customer's, and each gets an answer of its own.
  const ids = reached.ids()

  reached.add('secrets', await rowsWhere(tx, schema, 'secrets', 'record_id', ids))
  reached.add('sync_conflicts', await rowsWhere(tx, schema, 'sync_conflicts', 'record_id', ids))
  reached.add('mail_outbox', await mailsTo(tx, schema, [customer['email']]))

  return finish(tx, 'customer', customerId, reached, [])
}

async function contactReport(
  tx: TenantTransaction,
  schema: ReportSchema,
  contactId: string,
): Promise<AccessReport | null> {
  const reached = new Reached()
  const [contact] = await rowsWhere(tx, schema, 'contacts', 'id', [contactId])

  if (contact === undefined) {
    return null
  }

  reached.add('contacts', [contact])
  await walk(
    tx,
    schema,
    reached,
    ['contacts'],
    (table) => aboutOf(table)?.includes('contact') ?? false,
    () => true,
  )
  reached.add('mail_outbox', await mailsTo(tx, schema, [contact['email']]))
  // Its requests for access, which have no key to it (0133).
  reached.add(
    'access_requests',
    await rowsWhere(tx, schema, 'access_requests', 'contact_id', [contactId]),
  )

  // The notes and calls of its customer that name it as the other side.
  const name = [contact['given_name'], contact['family_name']]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim()
    .toLowerCase()

  if (name !== '' && typeof contact['customer_id'] === 'string') {
    reached.add(
      'communications',
      (
        await rowsWhere(tx, schema, 'communications', 'customer_id', [contact['customer_id']])
      ).filter(
        (row) =>
          typeof row['counterpart'] === 'string' &&
          row['counterpart'].trim().toLowerCase() === name,
      ),
    )
  }

  return finish(tx, 'contact', contactId, reached, [])
}

async function prospectReport(
  tx: TenantTransaction,
  schema: ReportSchema,
  prospectId: string,
): Promise<AccessReport | null> {
  const reached = new Reached()
  const [prospect] = await rowsWhere(tx, schema, 'prospects', 'id', [prospectId])

  if (prospect === undefined) {
    return null
  }

  reached.add('prospects', [prospect])
  await walk(
    tx,
    schema,
    reached,
    ['prospects'],
    (table) => aboutOf(table)?.includes('prospect') ?? false,
    () => true,
  )
  reached.add('mail_outbox', await mailsTo(tx, schema, [prospect['email']]))

  return finish(tx, 'prospect', prospectId, reached, [])
}

async function personReport(
  tx: TenantTransaction,
  schema: ReportSchema,
  personId: string,
  accountEmail: string | null,
): Promise<AccessReport | null> {
  const reached = new Reached()
  const [person] = await rowsWhere(tx, schema, 'people', 'id', [personId])

  if (person === undefined) {
    return null
  }

  reached.add('people', [person])

  const userId = typeof person['user_id'] === 'string' ? person['user_id'] : null
  const actions: ReportAction[] = []
  const acted = (table: string, column: string, row: ReportRow) => {
    actions.push({
      table,
      recordId: typeof row['id'] === 'string' ? row['id'] : null,
      column,
      at: (row['created_at'] ?? row['updated_at'] ?? null) as string | null,
    })
  }

  if (userId !== null) {
    reached.add('memberships', await rowsWhere(tx, schema, 'memberships', 'user_id', [userId]))
  }

  // Along the keys from the file and the membership: a table about the staff
  // only is the person's; a row of another table found by the file is about
  // the person (a request for access), one found by the account is only
  // something the person was handed.
  for (const key of schema.keys) {
    if (key.parent !== 'people' && key.parent !== 'memberships') {
      continue
    }

    const about = aboutOf(key.child)

    if (about === null || !about.includes('person') || key.child === 'people') {
      continue
    }

    const values = reached
      .of(key.parent)
      .map((row) => row[key.parentColumn])
      .filter((value) => typeof value === 'string')
      .map(String)
    const rows = await rowsWhere(tx, schema, key.child, key.childColumn, values)

    if (onlyAboutStaff(key.child) || key.parent === 'people') {
      reached.add(key.child, rows)
    } else {
      rows.forEach((row) => {
        acted(key.child, key.childColumn, row)
      })
    }
  }

  await walk(
    tx,
    schema,
    reached,
    [...reached.rows.keys()].filter((table) => onlyAboutStaff(table)),
    onlyAboutStaff,
    () => true,
  )

  // By the columns that name an account, where no key leads.
  if (userId !== null) {
    for (const table of Object.keys(personalDataCatalogue)) {
      const { holders, actors } = accountColumns(table)
      const keyed = new Set(
        schema.keys
          .filter(
            (key) =>
              key.child === table && (key.parent === 'memberships' || key.parent === 'people'),
          )
          .map((key) => key.childColumn),
      )

      for (const column of holders.filter((entry) => !keyed.has(entry))) {
        const rows = await rowsWhere(tx, schema, table, column, [userId])

        if (onlyAboutStaff(table)) {
          reached.add(table, rows)
        } else {
          rows.forEach((row) => {
            acted(table, column, row)
          })
        }
      }

      for (const column of actors.filter((entry) => !keyed.has(entry))) {
        const own = new Set(reached.of(table).map(keyOf))

        for (const row of await rowsWhere(tx, schema, table, column, [userId])) {
          if (!own.has(keyOf(row))) {
            acted(table, column, row)
          }
        }
      }
    }
  }

  // The invitation the person came in by, by the address of the account.
  if (accountEmail !== null && accountEmail.trim() !== '') {
    const columns = schema.columns.get('invitations')

    if (columns !== undefined) {
      const { rows } = await tx.execute<Record<string, unknown>>(
        sql`select ${columnsSql(columns)} from invitations
             where lower(trim(email)) = ${accountEmail.trim().toLowerCase()}`,
      )

      reached.add('invitations', rows.map(plainRow))
    }
  }

  // What the person changed on records that are not theirs: that and when,
  // one action for each change, and none for a record already named above.
  if (userId !== null) {
    const own = new Set(reached.ids())
    const named = new Set(actions.map((action) => `${action.table}:${String(action.recordId)}`))
    const { rows } = await tx.execute<{
      table_name: string
      record_id: string
      changed_at: Date | string
    }>(sql`
      select table_name, record_id::text as record_id, min(changed_at) as changed_at
        from audit_entries
       where user_id = ${userId}
       group by table_name, record_id, change_id
       order by min(sequence)`)

    for (const row of rows) {
      if (!own.has(row.record_id) && !named.has(`${row.table_name}:${row.record_id}`)) {
        actions.push({
          table: row.table_name,
          recordId: row.record_id,
          column: 'change',
          at: plain(row.changed_at) as string,
        })
      }
    }
  }

  return finish(tx, 'person', personId, reached, actions)
}

async function finish(
  tx: TenantTransaction,
  subject: PersonalSubject,
  subjectId: string,
  reached: Reached,
  actions: readonly ReportAction[],
): Promise<AccessReport> {
  const tables = reportedTables(reached, subject)
  const changes = await changesOf(tx, reached, [...tables.keys()])
  const files = await filesOf(tx, reached)

  return {
    subject,
    subjectId,
    tables,
    actions: [...actions].sort((one, other) => (one.at ?? '').localeCompare(other.at ?? '')),
    changes,
    files,
    accounts: accountsNamed(reached, changes),
  }
}

/**
 * Everything the business holds about one person, or null when there is no
 * such person in this business. `accountEmail` is the address of the
 * person's account, for the invitation it came in by; only for the staff.
 */
export async function gatherAccessReport(
  tx: TenantTransaction,
  subject: PersonalSubject,
  subjectId: string,
  accountEmail: string | null = null,
): Promise<AccessReport | null> {
  const schema = await reportSchema(tx)

  switch (subject) {
    case 'customer':
      return customerReport(tx, schema, subjectId)
    case 'contact':
      return contactReport(tx, schema, subjectId)
    case 'prospect':
      return prospectReport(tx, schema, subjectId)
    case 'person':
      return personReport(tx, schema, subjectId, accountEmail)
  }
}

/** The grid operators of the installations in a report, by name, for the recipients. */
export async function gridOperatorsOf(
  tx: TenantTransaction,
  report: AccessReport,
): Promise<string[]> {
  const ids = (report.tables.get('installations') ?? [])
    .map((row) => row['grid_operator_id'])
    .filter((id): id is string => typeof id === 'string')

  if (ids.length === 0) {
    return []
  }

  const { rows } = await tx.execute<{ name: string }>(sql`
    select distinct name from grid_operators
     where id::text = any(${sql.param(ids)}::text[]) order by name`)

  return rows.map((row) => row.name)
}
