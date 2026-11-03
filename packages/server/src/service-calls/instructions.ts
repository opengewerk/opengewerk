import {
  berlinClock,
  type ConflictReason,
  type CustomerId,
  type EarlyStartRequestId,
  type InstructionSheet,
  instructionSheetsFingerprint,
  type IsoDate,
  type JobId,
  jobInstructions,
  jobInstructionsRefusal,
  type JobKind,
  type TenantId,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { customers, earlyStartRequests, jobs } from '../database/schema/index.js'
import { issuerOf } from '../documents/content.js'
import { ensureShippedInstructions, instructionsOf } from '../documents/instructions.js'
import type { CallInstructionsPrint } from '../documents/template.js'

/** A service call as far as its instructions need it. */
export interface CallForInstructions {
  readonly id: JobId
  readonly tenantId: TenantId
  readonly kind: JobKind
  readonly number: string | null
  readonly designation: string
  readonly urgentRepair: boolean
  readonly customerId: CustomerId
  readonly customerName: string
  readonly customerEmail: string | null
  readonly isBusiness: boolean
  readonly street: string | null
  readonly houseNumber: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly country: string
}

/** The instructions of a service call on a day, as the device shows them and the PDF prints them. */
export interface CallInstructions {
  readonly call: CallForInstructions
  /** Why the job gets none, or null when it does. */
  readonly refusal: string | null
  readonly sheets: readonly InstructionSheet[]
  /** The words the customer signs on the device, or null when the business has no sheet for it. */
  readonly request: string | null
  /** What the letterhead lacks before they can go out, as sentences. */
  readonly gaps: readonly string[]
  readonly fingerprint: string
}

/** The job with its customer, or null when there is none or it was deleted. */
export async function callOf(
  tx: TenantTransaction,
  jobId: JobId,
): Promise<CallForInstructions | null> {
  const [call] = await tx
    .select({
      id: jobs.id,
      tenantId: jobs.tenantId,
      kind: jobs.kind,
      number: jobs.number,
      designation: jobs.designation,
      urgentRepair: jobs.urgentRepair,
      customerId: jobs.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      isBusiness: customers.isBusiness,
      street: customers.street,
      houseNumber: customers.houseNumber,
      postalCode: customers.postalCode,
      city: customers.city,
      country: customers.country,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))

  return call ?? null
}

/**
 * The instructions of a service call (#292): the four of
 * `jobInstructionTemplates` in the business's wording of that day, filled in
 * from its letterhead. For a job that gets none, the reason and no sheets.
 */
export async function callInstructions(
  tx: TenantTransaction,
  call: CallForInstructions,
  on: IsoDate,
): Promise<CallInstructions> {
  const refusal = jobInstructionsRefusal(call, call)

  if (refusal !== null) {
    return { call, refusal, sheets: [], request: null, gaps: [], fingerprint: '' }
  }

  await ensureShippedInstructions(tx, call.tenantId)

  const rows = await instructionsOf(tx)
  const issuer = await issuerOf(tx, call.tenantId)
  const { sheets, request, gaps } = jobInstructions(
    rows.map((row) => ({
      id: row.id,
      template: row.template,
      title: row.title,
      body: row.body,
      kinds: row.kinds,
      consumersOnly: row.consumersOnly,
      withDocument: row.withDocument,
    })),
    on,
    issuer,
  )

  return {
    call,
    refusal: null,
    sheets,
    request,
    gaps: gaps.map((gap) => gap.message),
    fingerprint: instructionSheetsFingerprint(sheets, request),
  }
}

/** Why a request for an early start may not land, in the shape a sync conflict records. */
export interface EarlyStartRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

/**
 * Whether a request for an early start arriving from a device was signed under
 * what this server shows for its job, like a signature under a report
 * (`signatureRefusal`). The device sends the fingerprint of the sheets the
 * customer read; here they are put together again for the day of the
 * signature. Different, the office changed a wording or the customer in the
 * meantime, and the request is refused as a conflict rather than kept under
 * words the customer never saw. A job that is gone, no longer a service call
 * or whose customer is a business now is refused the same way.
 */
export async function earlyStartRefusal(
  tx: TenantTransaction,
  values: Readonly<Record<string, unknown>>,
): Promise<EarlyStartRefusal | null> {
  const call = await callOf(tx, String(values['jobId'] ?? '') as JobId)

  if (!call) {
    return { reason: 'record_missing', fields: ['jobId'] }
  }

  const signedAt = values['signedAt']
  const moment = signedAt instanceof Date ? signedAt : new Date(String(signedAt))
  const on = berlinClock(Number.isNaN(moment.getTime()) ? new Date() : moment).day
  const held = await callInstructions(tx, call, on)

  if (held.refusal !== null) {
    return { reason: 'changed_elsewhere', fields: ['jobId'] }
  }

  return values['contentFingerprint'] === held.fingerprint
    ? null
    : { reason: 'changed_elsewhere', fields: ['contentFingerprint'] }
}

/** Why the instructions of a call cannot be printed, as the sentence the office or the mail shows. */
export class CallInstructionsRefused extends Error {}

/**
 * What the PDF of a call's instructions prints (#292): the words of the day
 * of the request signed at the door, with that request, or of `day` for the
 * sheets alone. Refused when the job gets none or the letterhead lacks what
 * the words need, with that sentence.
 */
export async function callPrintFacts(
  tx: TenantTransaction,
  jobId: JobId,
  requestId: string | null,
  day: IsoDate,
): Promise<CallInstructionsPrint> {
  const call = await callOf(tx, jobId)

  if (!call) {
    throw new CallInstructionsRefused('Den Auftrag gibt es nicht mehr.')
  }

  const [request] = requestId
    ? await tx
        .select({
          signerName: earlyStartRequests.signerName,
          signedAt: earlyStartRequests.signedAt,
          path: earlyStartRequests.path,
        })
        .from(earlyStartRequests)
        .where(
          and(
            eq(earlyStartRequests.id, requestId as EarlyStartRequestId),
            eq(earlyStartRequests.jobId, jobId),
          ),
        )
    : []

  if (requestId && !request) {
    throw new CallInstructionsRefused('Dieses Verlangen gehört nicht zu diesem Auftrag.')
  }

  const on = request ? berlinClock(request.signedAt).day : day
  const held = await callInstructions(tx, call, on)

  if (held.refusal !== null) {
    throw new CallInstructionsRefused(held.refusal)
  }

  if (held.gaps.length > 0) {
    throw new CallInstructionsRefused(held.gaps.join(' '))
  }

  return {
    issuer: await issuerOf(tx, call.tenantId),
    recipient: {
      name: call.customerName,
      street: call.street,
      houseNumber: call.houseNumber,
      postalCode: call.postalCode,
      city: call.city,
      country: call.country,
    },
    call: { number: call.number, designation: call.designation },
    on,
    sheets: held.sheets,
    signed:
      request && held.request !== null
        ? {
            request: held.request,
            signerName: request.signerName,
            signedAt: request.signedAt.toISOString(),
            path: request.path,
          }
        : null,
  }
}
