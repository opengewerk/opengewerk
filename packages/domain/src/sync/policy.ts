import { type SyncPolicy, syncRules } from '@opengewerk/platform-domain'

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
  /**
   * A supplier is master data like a customer (#296): on every device, created
   * through the outbox and corrected at its route. What it sells and at which
   * price never travels, those are the office's routes.
   */
  suppliers: masterData,
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
  /**
   * The tags of a business and which customer and site has which (#314).
   * Made, renamed and deleted in the office at their route, put on a record
   * at the route of the record, which asks whether a name is taken; a device
   * reads them to show and filter, and writes none. Master data, which
   * changes with a connection.
   */
  tags: { create: false, change: 'never' },
  customer_tags: { create: false, change: 'never' },
  site_tags: { create: false, change: 'never' },
  /**
   * The ways into a site (#286), kept in the office at the routes of the
   * site. The value is not a field of the row but sealed apart; the pull adds
   * it for the device of a technician on an open job there (ADR 0005).
   */
  site_accesses: { create: false, change: 'never' },
  /**
   * The QR labels of the installations (#308). Made and blocked in the office
   * at the routes of the installation, where the server draws the code; a
   * device reads them, so that a scan opens an installation without a network
   * and says so when its label is blocked, and writes none.
   */
  installation_labels: { create: false, change: 'never' },
  /**
   * The articles a device holds (#296), whatever its role: the frequent ones
   * and those a line took in the last 90 days, with their selling prices. Kept
   * at the routes of the office, where the whole catalogue is; a device reads
   * them to take one into a position or a report and writes none. Which
   * import wrote a row only the import itself writes (#297).
   */
  articles: { create: false, change: 'never', reserved: ['importId'] },
  article_prices: { create: false, change: 'never', reserved: ['importId'] },
  /**
   * That somebody saw the value of an access: written by the device that
   * showed it, also without a network, and never changed. Whose it is the
   * database writes from the request, and the server refuses one for an
   * access the device cannot have held (`revealRefusal`).
   */
  site_access_reveals: { create: true, change: 'never', reserved: ['userId'] },
}

/**
 * The rules of the sync of this application: the list above, with the
 * questions the foundation asks of such a list (ADR 0010). What a rule means
 * and how an operation is decided is the same in every application and lives
 * there; which records travel, and under which rules, is this list.
 *
 * Handed to whatever decides: the server when it applies an operation, and
 * the sync client of the interface, which judges one before it is sent.
 */
export const offlineRules = syncRules(syncPolicies)

export const { isSetByServer, policyFor } = offlineRules

export const syncEntities = offlineRules.entities
