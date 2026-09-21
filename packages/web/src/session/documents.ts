import type {
  DeductionContent,
  DocumentKind,
  IsoDate,
  MissingDetail,
  RecordState,
  SnippetPurpose,
} from '@opengewerk/domain'

import { RequestRefused, request } from '../sync/transport.js'

/**
 * The calls about documents that go straight to the server instead of into
 * the outbox.
 *
 * Four of them, and each for a reason the outbox cannot serve. A new document
 * is created at the route because that is where its tax treatment is proposed
 * from the customer and the business; through the outbox it would arrive with
 * the default and a small business would write its first quote with tax on
 * it. Issuing hands out a number from a counter. A successor is a head and
 * every line of its predecessor in one transaction. And the PDF is printed on
 * the server, where the renderer is.
 *
 * Everything else about a document, its fields and its lines, goes through
 * the outbox like any other record, and the screen shows it from there.
 */

export interface NewDocument {
  readonly customerId: string
  readonly jobId: string | null
  readonly siteId: string | null
  readonly installationId: string | null
  readonly kind: DocumentKind
  readonly documentDate: IsoDate
  readonly subject: string | null
}

export function createDocument(values: NewDocument): Promise<RecordState> {
  return request<RecordState>('/documents', { method: 'POST', body: JSON.stringify(values) })
}

export function issueDocument(id: string): Promise<RecordState> {
  return request<RecordState>(`/documents/${encodeURIComponent(id)}/issue`, { method: 'POST' })
}

/**
 * What an issuing refusal lists as missing, or nothing when the refusal was
 * about something else. Each entry names the paragraph it comes from, which
 * is what makes somebody go and fix the letterhead rather than give up.
 */
export function missingFrom(error: unknown): readonly MissingDetail[] {
  if (!(error instanceof RequestRefused) || error.status !== 422) {
    return []
  }

  const missing = (error.body as { missing?: unknown } | null)?.missing

  return Array.isArray(missing) ? (missing as MissingDetail[]) : []
}

export function makeSuccessor(id: string, kind: DocumentKind): Promise<RecordState> {
  return request<RecordState>(`/documents/${encodeURIComponent(id)}/successors`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  })
}

/**
 * Where the PDF of a document is. A plain address rather than a fetch: the
 * browser opens it in a tab of its own, with its own viewer, and the session
 * cookie goes along by itself.
 */
/**
 * The progress invoices a document takes off, read by the server out of what
 * those invoices froze when they were issued. Only the server can answer: the
 * frozen records never travel to a device, and working the figures out again
 * from the lines could deduct an amount that is not the one on the paper.
 */
export function deductionsOf(id: string): Promise<readonly DeductionContent[]> {
  return request<readonly DeductionContent[]>(`/documents/${encodeURIComponent(id)}/deductions`)
}

export function pdfAddress(id: string): string {
  return `/documents/${encodeURIComponent(id)}/pdf`
}

export interface TextSnippet {
  readonly id: string
  readonly purpose: SnippetPurpose
  readonly title: string
  readonly text: string
}

export interface SnippetValues {
  readonly purpose: SnippetPurpose
  readonly title: string
  readonly text: string
}

const snippets = '/documents/text-snippets'

/**
 * The texts the office writes once and uses again. Not synced: they are picked
 * at a desk, and what a document takes from one is a copy of its text, which
 * does travel with the document.
 */
export function textSnippets(): Promise<readonly TextSnippet[]> {
  return request<readonly TextSnippet[]>(snippets)
}

export function createSnippet(values: SnippetValues): Promise<TextSnippet> {
  return request<TextSnippet>(snippets, { method: 'POST', body: JSON.stringify(values) })
}

export function updateSnippet(id: string, values: SnippetValues): Promise<TextSnippet> {
  return request<TextSnippet>(`${snippets}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  })
}

export function removeSnippet(id: string): Promise<unknown> {
  return request(`${snippets}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
