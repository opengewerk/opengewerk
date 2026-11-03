import type { InstructionSheet } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The instructions of a service call (#292) as the server keeps them: put
 * together from the instructions of the business, which do not travel to a
 * device, and the messages they went out with, which never leave the server.
 */

/** A message with the instructions of a call. */
export interface CallMail {
  readonly id: string
  readonly to: string
  readonly status: 'pending' | 'sent' | 'failed'
  readonly lastError: string | null
  readonly sentAt: string | null
  readonly createdAt: string
  readonly requestedBy: string | null
  /** Sent by itself after a request was signed at the door, with that request. */
  readonly withRequest: boolean
}

export interface CallInstructions {
  /** Why the job gets none, or null when it does. */
  readonly refusal: string | null
  readonly urgentRepair: boolean
  readonly email: string | null
  readonly sheets: readonly InstructionSheet[]
  /** The words the customer signs on the device. */
  readonly request: string | null
  /** What the letterhead lacks, as sentences. */
  readonly gaps: readonly string[]
  readonly fingerprint: string
  readonly signed: readonly {
    readonly id: string
    readonly signerName: string
    readonly signedAt: string
  }[]
  readonly mails: readonly CallMail[]
}

export const callInstructionsKey = (jobId: string) => ['jobs', jobId, 'instructions'] as const

export function callInstructions(jobId: string): Promise<CallInstructions> {
  return request<CallInstructions>(`/jobs/${encodeURIComponent(jobId)}/instructions`)
}

/** Sends the instructions to the customer, or to the address given for this one message. */
export function sendCallInstructions(jobId: string, to: string | null): Promise<CallMail> {
  return request<CallMail>(`/jobs/${encodeURIComponent(jobId)}/instructions/mail`, {
    method: 'POST',
    body: JSON.stringify(to === null ? {} : { to }),
  })
}

/** Where the PDF of the instructions is, with a request signed at the door when one is named. */
export function callInstructionsAddress(jobId: string, requestId?: string): string {
  const base = `/jobs/${encodeURIComponent(jobId)}/instructions/pdf`

  return requestId ? `${base}?request=${encodeURIComponent(requestId)}` : base
}
