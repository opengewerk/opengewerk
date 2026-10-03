import {
  contactParentProblem,
  contactParentText,
  type CustomerId,
  formRecordProblem,
  type IsoDate,
  lineNetCents,
  locationFields,
  offlineRules,
  type Operation,
  paymentTermProblem,
  type RecordState,
  signaturePathIsValid,
  type TenantId,
} from '@opengewerk/domain'
import {
  serverSync,
  type SyncCheck,
  syncTables,
  type TenantTransaction,
} from '@opengewerk/platform-server'

import type { FoundIdentity } from '../api/identity.js'
import { versionFileRefusal } from '../attachments/versions.js'
import { signatureRefusal } from '../documents/signing.js'
import { consentGiven, correctionRefusal } from '../time/entries.js'
import { proposedTreatment } from '../documents/treatment.js'
import { pvLinkRefusal, sectionRefusal, structureProblem } from '../electrical/structure.js'
import { tradeForms } from '../forms/registry.js'
import { reportFieldsProblem } from '../forms/report-fields.js'
import { followUpRefusal } from '../jobs/follow-up.js'
import { revealRefusal } from '../secrets/reveal.js'
import { assigneeRefusal } from '../tasks/assignee.js'
import { assignNumber } from './number-ranges.js'
import { ruleRefusal } from './record-rules.js'
import { missingReference } from './references.js'
import * as schema from './schema/index.js'

// The sync on the server is the foundation's (ADR 0010): applying an
// operation, recording what became of it, the pull by change sequence and the
// conflicts. What this application adds is in here: its rules and tables,
// the questions it asks of an operation before the database does, in the
// order they are asked, and the values the server puts in.

export {
  type ChangedRows,
  closeConflict,
  OperationRefused,
  openConflicts,
  toRecordState,
  UnknownFieldError,
} from '@opengewerk/platform-server'

type Check = SyncCheck<FoundIdentity>

/** A field as the record would stand afterwards: what the operation sets, over what is held. */
function standing(values: Record<string, unknown>, current: RecordState | null) {
  return (field: string) => (field in values ? values[field] : current?.[field])
}

/** Which of its three parents a contact names, judged as it would stand afterwards. */
function contactParent(
  operation: Operation,
  values: Record<string, unknown>,
  current: RecordState | null,
) {
  if (operation.entity !== 'contacts' || operation.kind === 'delete') {
    return null
  }

  const at = standing(values, current)

  return contactParentProblem({
    customerId: at('customerId'),
    siteId: at('siteId'),
    supplierId: at('supplierId'),
  })
}

/**
 * A path that is not one this system draws is a mistake in the client, like a
 * field it may not set, and not a disagreement between two people. The check
 * in the database would refuse it too, with a sentence nobody on site could
 * act on.
 */
const signature: Check = async ({ tx, operation, values }) => {
  if (operation.kind !== 'create' || operation.entity !== 'document_signatures') {
    return null
  }

  if (typeof values['path'] !== 'string' || !signaturePathIsValid(values['path'])) {
    return {
      kind: 'client',
      message: 'Die Unterschrift ist kein Pfad, wie OpenGewerk ihn zeichnet.',
    }
  }

  const refusal = await signatureRefusal(tx, values)

  return refusal ? { kind: 'conflict', reason: refusal.reason, fields: refusal.fields } : null
}

/**
 * A payment term outside what `paymentTermProblem` allows is a mistake in the
 * client, like a signature path it did not draw: the form checks the same
 * function before anything is queued. Refused here with that sentence rather
 * than by the check in the database with one nobody can act on.
 */
const paymentTerm: Check = ({ operation, values }) => {
  if (
    operation.entity !== 'documents' ||
    values['paymentTermDays'] === undefined ||
    values['paymentTermDays'] === null
  ) {
    return null
  }

  const problem = paymentTermProblem(values['paymentTermDays'])

  return problem === null ? null : { kind: 'client', message: problem }
}

/**
 * A task goes to somebody who works here. The key in the database would say so
 * too, for the whole transmission at once; said here, it is a conflict about
 * this one operation.
 */
const assignee: Check = async ({ tx, tenantId, operation, values }) => {
  if (operation.entity !== 'tasks' || operation.kind === 'delete') {
    return null
  }

  const refusal = await assigneeRefusal(tx, tenantId, operation.kind === 'create', values)

  return refusal ? { kind: 'conflict', reason: refusal.reason, fields: refusal.fields } : null
}

/**
 * A showing names a value its device can have shown (#286): whoever keeps the
 * ways in sees any at the route, anybody else only a value a pull once handed
 * them (`site_access_deliveries`). Any other would be a trace of something
 * that never was.
 */
const reveal: Check = async ({ tx, operation, values, sender }) => {
  if (operation.entity !== 'site_access_reveals' || operation.kind !== 'create') {
    return null
  }

  const refusal = await revealRefusal(tx, sender, values)

  return refusal ? { kind: 'conflict', reason: refusal.reason, fields: refusal.fields } : null
}

/**
 * A filled form is asked of its definition (#78), as the form asked it before
 * anything was queued: values that do not fit, or a form marked signed that
 * lacks what signing needs, are a mistake of the client.
 */
const formRecord: Check = ({ operation, values, current }) => {
  if (operation.entity !== 'form_records' || operation.kind === 'delete') {
    return null
  }

  const at = standing(values, current)
  const problem = formRecordProblem(tradeForms, {
    definitionKey: at('definitionKey'),
    definitionVersion: at('definitionVersion'),
    status: at('status') ?? 'draft',
    values: at('values') ?? '{}',
  })

  return problem === null ? null : { kind: 'client', message: problem }
}

/**
 * The fields a business gives its reports (#78), asked of the version the
 * report names, as the form on site asks them before it saves.
 */
const reportFields: Check = async ({ tx, operation, values, current }) => {
  if (
    operation.entity !== 'documents' ||
    operation.kind === 'delete' ||
    !('fieldsVersion' in values || 'fieldValues' in values)
  ) {
    return null
  }

  const at = standing(values, current)
  const problem = await reportFieldsProblem(tx, {
    kind: at('kind'),
    fieldsVersion: at('fieldsVersion'),
    fieldValues: at('fieldValues'),
  })

  return problem === null ? null : { kind: 'client', message: problem }
}

/**
 * A figure of the structure below an installation out of bounds is a mistake
 * in the client, refused with the sentence its form shows. The check in the
 * database says the same, for the whole transmission at once.
 */
const structure: Check = ({ operation, values, current }) => {
  const figures = structureProblem(operation.entity, values, current)

  return figures === null ? null : { kind: 'client', message: figures }
}

/**
 * A contact hangs on one customer, one site or one supplier, which the check
 * in the database holds as well, judged as it would stand afterwards: what the
 * operation sets, over the row it lands on. The two ways to miss that are not
 * the same kind of mistake. On several, it is one only the client can make: a
 * form makes a contact on the screen of what it belongs to and has no way to
 * name another as well, so the answer is the sentence of the rule, the way a
 * circuit is refused whose curve does not go with its device. On none, it is a
 * record without the parent it must have, and that is the question of the
 * references further down, which gets their answer.
 */
const contactOnSeveral: Check = ({ operation, values, current }) =>
  contactParent(operation, values, current) === 'several'
    ? { kind: 'client', message: contactParentText.several }
    : null

/**
 * The checks on the fields of one record that nothing above asks: the service
 * period of a document, the place and amount of a line, the name and device of
 * a signature. Each as the rule the forms ask as well, and whose mistake a
 * broken one is the foundation decides (`recordRuleRefusal`).
 */
const recordRules: Check = ({ operation, values, current }) =>
  ruleRefusal(operation, values, current)

/**
 * A time entry corrects somebody's own entry, and each one once (#76). Its
 * place is kept only with the person's consent: without it the server drops
 * the place and keeps the time, which is still the record the law wants.
 */
const timeEntry: Check = async ({ tx, operation, values }) => {
  if (operation.entity !== 'time_entries' || operation.kind !== 'create') {
    return null
  }

  const refusal = await correctionRefusal(tx, values)

  if (refusal) {
    return { kind: 'conflict', reason: refusal.reason, fields: refusal.fields }
  }

  if (!(await consentGiven(tx))) {
    for (const field of locationFields) {
      if (field in values) {
        values[field] = null
      }
    }
  }

  return null
}

/**
 * A version of an attachment names its file by business and hash, a key the
 * reference check below does not read. Its own question: is the file there,
 * uploaded ahead of the version, and is the size the one it has.
 */
const versionFile: Check = async ({ tx, tenantId, operation, values }) => {
  if (operation.entity !== 'attachment_versions' || operation.kind !== 'create') {
    return null
  }

  const refusal = await versionFileRefusal(tx, tenantId, values)

  if (refusal?.kind === 'client') {
    return { kind: 'client', message: refusal.message }
  }

  return refusal ? { kind: 'conflict', reason: refusal.reason, fields: refusal.fields } : null
}

/**
 * A parent that is gone, or that belongs to another business, is a conflict
 * about this one operation, for every entity: the key over tenant and id would
 * refuse it too, but for the whole transmission, and a deleted parent it would
 * take. A contact that names none at all is missing the one it must have, like
 * any record created without it, and a conflict as well, with both fields;
 * left to the check in the database, it took the whole transmission along.
 * Then the pairings the keys cannot say alone: the section of a circuit on the
 * circuit's board, and the PV system and inverter an installation belongs to,
 * at its own site (#300).
 */
const references: Check = async ({ tx, operation, table, values, current }) => {
  const missing =
    operation.kind === 'delete'
      ? null
      : await missingReference(tx, table, values, operation.kind === 'create')

  if (missing) {
    return { kind: 'conflict', reason: 'record_missing', fields: [missing.field] }
  }

  if (contactParent(operation, values, current) === 'none') {
    return { kind: 'conflict', reason: 'record_missing', fields: ['customerId', 'siteId'] }
  }

  const misplaced =
    (await sectionRefusal(tx, operation, values, current)) ??
    (await pvLinkRefusal(tx, operation, values, current))

  return misplaced ? { kind: 'conflict', reason: misplaced.reason, fields: misplaced.fields } : null
}

/**
 * A follow-up after a finished job of the same customer, which it names when
 * it is made and never again (#170). The trigger in the database holds the
 * same, for the whole transmission; asked here, a job that was taken up again
 * meanwhile is a conflict about this one operation.
 */
const followUp: Check = async ({ tx, operation, values, current }) => {
  if (operation.entity !== 'jobs' || operation.kind === 'delete') {
    return null
  }

  const refusal = await followUpRefusal(
    tx,
    operation.recordId,
    values,
    operation.kind === 'create' ? null : current,
  )

  if (refusal?.kind === 'client') {
    return { kind: 'client', message: refusal.message }
  }

  return refusal ? { kind: 'conflict', reason: refusal.reason, fields: refusal.fields } : null
}

/**
 * A cancellation invoice is made by the server out of the invoice it cancels
 * and nowhere else. The database refuses one written by hand, and it would do
 * so for the whole transmission; refused here first, it is a conflict about
 * this one operation, the way a field the server keeps is refused.
 */
const cancellation: Check = ({ operation, values }) =>
  operation.entity === 'documents' && values['kind'] === 'cancellation_invoice'
    ? { kind: 'conflict', reason: 'set_by_server', fields: ['kind'] }
    : null

/**
 * The line total, put in by the server on the way to the database.
 *
 * Two numbers decide it, and an operation may carry one, both or neither: a
 * device that corrects only the quantity still changes the total. So the
 * figure is worked out from what the operation sets, falling back to what the
 * row already holds, rather than from the patches alone. It is reserved in
 * the policy, so a device that sends one is refused outright; this is the
 * other half, the figure the server puts in its place.
 */
function withLineTotal(
  entity: string,
  values: Record<string, unknown>,
  current: RecordState | null,
): Record<string, unknown> {
  if (entity !== 'document_lines') {
    return values
  }

  const quantityMilli = Number(values['quantityMilli'] ?? current?.['quantityMilli'] ?? 0)
  const unitPriceCents = Number(values['unitPriceCents'] ?? current?.['unitPriceCents'] ?? 0)
  // A device of a version before #456 sends no price unit, and the column's
  // default is one.
  const priceBase = Number(values['priceBase'] ?? current?.['priceBase'] ?? 1)

  return { ...values, netCents: lineNetCents({ quantityMilli, unitPriceCents, priceBase }) }
}

/**
 * The tax treatment of a document made on a device, proposed here as the
 * route proposes it for one made in the office.
 *
 * Only when the device did not choose one. It may, a draft's treatment is
 * writable; what it may not get is the default by accident, which is what a
 * report written in a cellar for a small business used to arrive with.
 */
async function withProposedTreatment(
  tx: TenantTransaction,
  operation: Operation,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    operation.kind !== 'create' ||
    operation.entity !== 'documents' ||
    values['taxTreatment'] !== undefined ||
    typeof values['customerId'] !== 'string' ||
    typeof values['documentDate'] !== 'string'
  ) {
    return values
  }

  return {
    ...values,
    taxTreatment: await proposedTreatment(
      tx,
      values['customerId'] as CustomerId,
      values['documentDate'] as IsoDate,
    ),
  }
}

/**
 * The number of a job created on a device, drawn here as the route draws it
 * for one created over it (#145). In the same transaction as the insert, so
 * that a transmission refused afterwards takes the number back with it.
 */
async function withJobNumber(
  tx: TenantTransaction,
  tenantId: TenantId,
  operation: Operation,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (operation.kind !== 'create' || operation.entity !== 'jobs') {
    return values
  }

  return { ...values, number: await assignNumber(tx, tenantId, 'job', new Date()) }
}

const sync = serverSync<FoundIdentity>({
  rules: offlineRules,
  // The tables of the schema module itself. A map beside it would be one more
  // place to remember on the next table.
  tables: syncTables(schema),
  checks: [
    signature,
    paymentTerm,
    assignee,
    reveal,
    formRecord,
    reportFields,
    structure,
    contactOnSeveral,
    recordRules,
    timeEntry,
    versionFile,
    references,
    followUp,
    cancellation,
  ],
  complete: async ({ tx, tenantId, operation, values, current }) =>
    withJobNumber(
      tx,
      tenantId,
      operation,
      await withProposedTreatment(tx, operation, withLineTotal(operation.entity, values, current)),
    ),
})

export const { applyOperations, changesSince } = sync

export function syncTableFor(entity: string) {
  return sync.tableFor(entity)
}
