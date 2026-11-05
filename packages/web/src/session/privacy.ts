import type {
  AccessRequestInput,
  AccessRequestView,
  AccessSubjectHit,
  DueErasure,
  Erasure,
  ErasureAutomation,
  ErasureKind,
  ErasureRequestChannel,
  ErasureRequestView,
  IsoDate,
  PrivacyDocumentKind,
  PrivacyDocumentsSummary,
  ProcessingActivityKey,
  ProcessingRecordView,
} from '@opengewerk/domain'
import { request, type RequestedFile, requestFile } from '@opengewerk/platform-web/sync'

/**
 * The deletion concept (#317, #845) as the server keeps it: nothing of it
 * goes to a device, so it is asked with a connection.
 */

export interface PrivacyOverview {
  /** Null for somebody who may not read the records of the kinds that are due. */
  readonly due: readonly DueErasure[] | null
  readonly erasures: readonly Erasure[]
  readonly automations: readonly ErasureAutomation[]
  /** The requests for deletion that run; null for somebody who may not read customers. */
  readonly requests: readonly ErasureRequestView[] | null
  /** Whether the person asking leads the business, and so may delete and switch. */
  readonly leads: boolean
}

export const privacyKey = ['privacy'] as const

export function privacyOverview(): Promise<PrivacyOverview> {
  return request<PrivacyOverview>('/privacy')
}

/** Deletes the records of a kind the office confirmed, all of them or none. */
export function erase(kind: ErasureKind, ids: readonly string[]): Promise<readonly Erasure[]> {
  return request<readonly Erasure[]>('/privacy/erasures', {
    method: 'POST',
    body: JSON.stringify({ kind, ids }),
  })
}

/** Switches a kind to go by itself, or back to proposals. */
export function switchAutomation(
  kind: ErasureKind,
  on: boolean,
): Promise<readonly ErasureAutomation[]> {
  return request<readonly ErasureAutomation[]>(`/privacy/automations/${kind}`, {
    method: on ? 'PUT' : 'DELETE',
  })
}

/** The key the request of a customer is kept under; under `privacyKey`, so that it goes with it. */
export function erasureRequestKey(customerId: string) {
  return [...privacyKey, 'request', customerId] as const
}

/** The request that runs for a customer, or null (#845). */
export async function runningErasureRequest(
  customerId: string,
): Promise<ErasureRequestView | null> {
  const answer = await request<{ readonly running: ErasureRequestView | null }>(
    `/privacy/requests?customerId=${encodeURIComponent(customerId)}`,
  )

  return answer.running
}

/** Records a request of a customer to be deleted (#845). */
export function recordErasureRequest(values: {
  readonly customerId: string
  readonly receivedOn: IsoDate
  readonly channel: ErasureRequestChannel
}): Promise<ErasureRequestView> {
  return request<ErasureRequestView>('/privacy/requests', {
    method: 'POST',
    body: JSON.stringify(values),
  })
}

/** Answers an open request by restricting its customer (#845). */
export function restrictOnRequest(requestId: string): Promise<ErasureRequestView> {
  return request<ErasureRequestView>(`/privacy/requests/${requestId}/restriction`, {
    method: 'POST',
  })
}

/** The requests for access (#318) are kept under `privacyKey` as well. */
export const accessRequestsKey = [...privacyKey, 'access'] as const

/** The requests for access that run, and those answered in the last twelve months. */
export async function accessRequests(): Promise<readonly AccessRequestView[]> {
  const answer = await request<{ readonly requests: readonly AccessRequestView[] }>(
    '/privacy/access-requests',
  )

  return answer.requests
}

/** The customers, contacts, leads and files a name finds, from two letters on. */
export async function findAccessSubjects(typed: string): Promise<readonly AccessSubjectHit[]> {
  const answer = await request<{ readonly hits: readonly AccessSubjectHit[] }>(
    `/privacy/access-requests/subjects?q=${encodeURIComponent(typed)}`,
  )

  return answer.hits
}

/** Records a request for access (#318). */
export function recordAccessRequest(values: AccessRequestInput): Promise<AccessRequestView> {
  return request<AccessRequestView>('/privacy/access-requests', {
    method: 'POST',
    body: JSON.stringify(values),
  })
}

/** Draws the answer to a request as one ZIP; the server records who drew it and when. */
export function drawAccessAnswer(requestId: string): Promise<RequestedFile> {
  return requestFile(`/privacy/access-requests/${requestId}/report`, 'application/zip', 'POST')
}

/** Marks a request answered, once its answer was drawn. */
export function answerAccessRequest(requestId: string): Promise<AccessRequestView> {
  return request<AccessRequestView>(`/privacy/access-requests/${requestId}/answer`, {
    method: 'POST',
  })
}

/** The three documents on data protection (#319): their cards, the record, and each as a PDF. */
export const privacyDocumentsKey = [...privacyKey, 'documents'] as const

export const processingRecordKey = [...privacyKey, 'record'] as const

export function privacyDocumentsSummary(): Promise<PrivacyDocumentsSummary> {
  return request<PrivacyDocumentsSummary>('/privacy/documents')
}

/** A document made now, as a PDF to save. */
export function privacyDocument(kind: PrivacyDocumentKind): Promise<RequestedFile> {
  return requestFile(`/privacy/documents/${kind}`, 'application/pdf')
}

export function processingRecord(): Promise<ProcessingRecordView> {
  return request<ProcessingRecordView>('/privacy/record')
}

/** Who is responsible, the data protection officer and what is processed outside; empty is none. */
export function keepProcessingRecord(values: {
  readonly controller: string
  readonly officer: string
  readonly outside: string
}): Promise<ProcessingRecordView> {
  return request<ProcessingRecordView>('/privacy/record', {
    method: 'PUT',
    body: JSON.stringify(values),
  })
}

/** Purpose and legal basis together, or both empty for the proposal, and the recipients. */
export function keepProcessingActivity(
  key: ProcessingActivityKey,
  values: { readonly purpose: string; readonly legalBasis: string; readonly recipients: string },
): Promise<ProcessingRecordView> {
  return request<ProcessingRecordView>(`/privacy/record/activities/${key}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  })
}
