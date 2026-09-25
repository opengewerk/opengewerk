import type { SyncValue } from './operation.js'

/**
 * What a device may do with an entity while it is offline.
 *
 * The rules are per entity and written out, not derived from something
 * generic. ADR 0005 insists on that, and the reason shows up immediately: a
 * customer and a report look identical to a generic mechanism and could not be
 * further apart in what may happen to them without a network.
 */
export interface SyncPolicy {
  /** Whether a device may create one of these without asking. */
  readonly create: boolean
  /**
   * `merge` lets a device change fields nobody else has touched. `never`
   * means changes to an existing record need a connection.
   */
  readonly change: 'never' | 'merge'
  /**
   * A change is only allowed while this field holds one of these values.
   * Leaving that state is what turns a record into something that is no longer
   * edited but corrected.
   */
  readonly onlyWhile?: {
    readonly field: string
    readonly values: readonly SyncValue[]
  }
  /**
   * Fields only the server ever writes, whatever a device sends.
   *
   * Different from the columns the server keeps everywhere (id, version and
   * the like): those are bookkeeping a device has no opinion about. These are
   * fields a device very much has an opinion about and still may not set,
   * because setting them is an act that needs a connection, a right and a
   * counter.
   *
   * Listed per entity, because the same field name means different things on
   * different tables, and because a generic rule would either be too wide or
   * would have to be widened at the wrong moment.
   */
  readonly reserved?: readonly string[]
  /**
   * What a new record holds in its reserved fields before anything else
   * happens to it: the state every record of this kind starts in.
   *
   * The server has it from the column default and needs nothing here. A
   * device does. Until the server has answered, a record made on the device
   * exists only as its create operation, which by definition carries none of
   * the reserved fields, and a gate asking one of them finds nothing and
   * refuses. A report written in a cellar then turned down its own first line
   * as already fixed, and every change to its text with it.
   *
   * Written down here so that both ends read the same start. A test holds
   * that every gate on a reserved field has one, and that the start lies
   * inside the gate.
   */
  readonly createdAs?: Readonly<Record<string, SyncValue>>
  /**
   * A gate that sits on another record, not on this one.
   *
   * A document line is the case it exists for. Whether it may be changed does
   * not follow from anything on the line, it follows from the status of the
   * document the line belongs to: an invoice that has been issued freezes its
   * positions with it, or the numbering is worth nothing.
   *
   * `onlyWhile` cannot say that, because it looks at the record's own fields.
   * Copying the parent's status onto the line would let it answer, and would
   * put the same fact in two places, where the copy is stale exactly at the
   * moment somebody issues the document.
   *
   * The server resolves the parent through `reference` and hands its state to
   * `decideMerge`. A device works out the same answer from the parent it
   * already holds, which is the point of the rule living here.
   */
  readonly gateFrom?: {
    /** The field on this record that names the parent. */
    readonly reference: string
    /** The parent's entity, so the server knows where to look. */
    readonly entity: string
    readonly field: string
    readonly values: readonly SyncValue[]
  }
}

/**
 * Master data. A technician on site adds a customer that is not in the system
 * yet, which happens, and that has to work without a network. Changing one
 * does not: an address corrected on two devices at once is a question for the
 * office, and the office has a connection.
 */
const masterData: SyncPolicy = { create: true, change: 'never' }

/**
 * What the work itself produces. Readings, equipment, the state of an
 * installation: this is the part that is recorded in a basement and merged
 * afterwards.
 */
const fieldWork: SyncPolicy = { create: true, change: 'merge' }

/**
 * The entities a device knows about, and what it may do with them.
 *
 * The keys are table names, the same ones the audit log writes, so that the
 * server can resolve them against its schema instead of keeping a second
 * mapping next to this one.
 *
 * The time entry, which ADR 0005 names for this phase, arrived with #76, and
 * not as `fieldWork`: § 17 MiLoG wants the record kept unchanged, so it is
 * written once and corrected by a new entry, like an issued document.
 */
export const syncPolicies: Readonly<Record<string, SyncPolicy>> = {
  customers: masterData,
  contacts: masterData,
  sites: masterData,
  installations: fieldWork,
  distribution_boards: fieldWork,
  board_sections: fieldWork,
  circuits: fieldWork,
  equipment: fieldWork,
  inverters: fieldWork,
  pv_strings: fieldWork,
  pv_modules: fieldWork,
  /**
   * A job is field work like the installation it is for: the office creates
   * it through the outbox, the site reports how it goes (#128), and changes
   * are merged field by field. Its number is the server's (#145). It is drawn
   * from the job number range when the job is created, and a device that set
   * one could hand out a number the range never gave, or another job's.
   */
  jobs: { ...fieldWork, reserved: ['number', 'closedAt'] },
  /**
   * A document may be written offline while it is a draft, and not one moment
   * longer. Issuing is not in this list at all: it hands out a number and
   * fixes the document, which happens on the server and only there. A device
   * without a network can prepare a document; it cannot turn one into
   * bookkeeping.
   *
   * `onlyWhile` alone did not say that. It asks what the record looked like
   * before, so it catches a device writing to something already issued and
   * lets the step that does the issuing straight through: a draft is a draft
   * until the patch lands. `reserved` is the other half, and it is the half
   * that matters, because these three fields together are the issuing. The
   * number comes from the counter, the timestamp from the server clock, and
   * the status from the endpoint that holds both. Who issued it comes from the
   * same endpoint (#249): a device that could write it could put a document
   * under somebody else's name.
   *
   * It covers creating as well, which is where the gate cannot help at all:
   * there is no previous state to look at, and a document arriving as
   * `issued` with a number of its own would never have passed through the
   * counter. `status` carries its default, so a device that leaves it alone
   * still gets a draft, and `createdAs` tells the device so before the server
   * has.
   *
   * `predecessorDocumentId` is the server's as well. A successor is made by the
   * route that makes it, out of the last link of the chain (#129); a device
   * that could name a predecessor could branch the chain, and a final invoice
   * next to a progress invoice deducts nothing of it.
   */
  documents: {
    create: true,
    change: 'merge',
    onlyWhile: { field: 'status', values: ['draft'] },
    reserved: ['status', 'number', 'issuedAt', 'issuedBy', 'predecessorDocumentId'],
    createdAs: { status: 'draft' },
  },
  /**
   * The positions of a document, and they follow their document in everything.
   *
   * The gate is on the parent, not here: a line carries no status of its own,
   * and whether it may still be touched is decided by whether the invoice has
   * been issued. A device that hangs a line on an invoice that was issued in
   * the meantime gets `record_is_fixed`, the same answer it would get for the
   * document itself.
   *
   * `netCents` is reserved. It is quantity times price, rounded, and the one
   * figure on the line that must not come from a device: a client that rounds
   * differently, or simply sends something else, would put an amount in the
   * books that does not follow from the two numbers next to it. The server
   * works it out from what the device did send, and a check constraint in the
   * database holds the result.
   */
  document_lines: {
    create: true,
    change: 'merge',
    gateFrom: { reference: 'documentId', entity: 'documents', field: 'status', values: ['draft'] },
    reserved: ['netCents'],
  },
  /**
   * A customer's signature, given on site and so made offline, and after that
   * never touched again: `change: 'never'` with no route behind it, and a
   * database that grants nothing but reading and inserting.
   *
   * Only on a draft. Once the signature lands the document is `signed`, so a
   * second signature for the same document finds no draft and is refused, and
   * so is every change to the document and its lines that arrives after it.
   */
  document_signatures: {
    create: true,
    change: 'never',
    gateFrom: { reference: 'documentId', entity: 'documents', field: 'status', values: ['draft'] },
  },
  /**
   * Written wherever somebody notices that something has to happen, and done
   * wherever somebody does it, on site as much as in the office, so both
   * without a network. One device moving the day while another marks the task
   * done is ordinary work on different fields.
   *
   * `createdBy` is the server's. It says who wrote the task, or that nobody
   * did, and a device that set it could put its task under somebody else's
   * name or pass it off as one the deadline engine made.
   */
  tasks: { create: true, change: 'merge', reserved: ['createdBy'] },
  /**
   * A file in the records and where it hangs (#77), written on site as much
   * as in the office and so without a network: a photo of a type plate taken
   * in a cellar is the case this is built for. Its places and its name may be
   * changed like any field work; the file itself is in its versions.
   */
  attachments: fieldWork,
  /**
   * One version of a file, made once and never changed, like a signature:
   * `change: 'never'` with no route behind it and a database that grants
   * reading and inserting. A new version is a new row.
   *
   * The bytes travel ahead of the row. A device uploads what a version names
   * before it sends the version, and the server finds the file by business and
   * hash; a version whose file never arrived is a conflict about that one
   * version, not a refusal of the transmission. `createdBy` is the server's,
   * like the author of a task.
   */
  attachment_versions: { create: true, change: 'never', reserved: ['createdBy'] },
  /**
   * A stretch of somebody's working time (#76), recorded on site without a
   * network and never changed afterwards: `change: 'never'` with no route
   * behind it and a database that grants reading and inserting. A correction
   * is a new entry that names the old one. Whose time it is, the server writes
   * from the request, so `userId` is its own.
   */
  time_entries: { create: true, change: 'never', reserved: ['userId'] },
  /**
   * A note from the site about a job (#220), written without a network where
   * the work is and never changed afterwards, like a time entry: `change:
   * 'never'` with no route behind it and a database that grants reading and
   * inserting. A note that turns out wrong is followed by another one. Who
   * wrote it, the server writes from the request, so `createdBy` is its own.
   */
  job_notes: { create: true, change: 'never', reserved: ['createdBy'] },
  /**
   * Which reports a collective invoice was made out of (#135), one row each.
   * Made by the route that makes the invoice, in the same transaction, and
   * released by the database when the invoice is cancelled or its draft is
   * deleted; a device reads them and writes none. They travel so that every
   * screen knows, without asking the server, which report is still open and
   * where the chain of one that is not goes on.
   */
  document_sources: { create: false, change: 'never' },
  /**
   * Who is on which job (#140). Set in the office at the route, which checks
   * that each person works in the business, and removed there by marking the
   * row deleted; a device reads them and writes none. They decide what the
   * device of a technician holds, so a device that could write one could
   * widen its own share of the business.
   */
  job_assignments: { create: false, change: 'never' },
  /**
   * A filled form (#78), a test protocol first: written on site without a
   * network while it is a draft, field work like a report. Signing is a change
   * of the device's own, the sealing signature and `status` in one operation,
   * and after it nothing lands any more, so the gate is the status as it
   * stood. The server asks the definition of every change, as the form does.
   */
  form_records: {
    create: true,
    change: 'merge',
    onlyWhile: { field: 'status', values: ['draft'] },
  },
  /**
   * The versions of the forms a business writes itself, the fields of its
   * reports first (#78). Saved in the office at the route, a new version for
   * every change and none ever changed; a device reads them, because it fills
   * the fields in without a network, and writes none.
   */
  form_definitions: { create: false, change: 'never' },
}

/**
 * Columns a device never sets, whatever it sends.
 *
 * The first two say where a record belongs and are decided by the identity of
 * the request, never by its body. The rest are kept by a trigger, and a device
 * that wrote its own version number could make any change look like the newest
 * one there is.
 *
 * `deletedAt` is in the list although the server writes it from an operation
 * and not from a trigger. Deleting has its own kind of operation and a rule of
 * its own to pass; a device that sets the column as an ordinary field would
 * walk around that rule, and one that sets it back to null would undelete
 * something nobody restored.
 *
 * It sits here rather than in the server because both ends need it. The server
 * refuses a patch that names one of these; a device has to leave them out in
 * the first place, and it can only do that if it knows which they are. Two
 * copies of the list would agree until the day a column is added to one.
 */
export const keptByTheServer: readonly string[] = [
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'updatedBy',
  // Written by the same trigger as `updatedBy`, from the device of the
  // transaction; a value in a patch was overwritten anyway (#221).
  'deviceId',
  'version',
  'changeSequence',
  'deletedAt',
]

/** True when this field is the server's to write, on this entity. */
export function isSetByServer(entity: string, field: string): boolean {
  return keptByTheServer.includes(field) || (policyFor(entity)?.reserved?.includes(field) ?? false)
}

export const syncEntities = Object.keys(syncPolicies)

export function policyFor(entity: string): SyncPolicy | null {
  return syncPolicies[entity] ?? null
}
