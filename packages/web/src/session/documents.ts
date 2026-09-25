import type {
  DeductionContent,
  DocumentKind,
  EInvoiceStatus,
  IsoDate,
  MissingDetail,
  Payment,
  RecordState,
  SnippetPurpose,
} from '@opengewerk/domain'

import { RequestRefused, request } from '../sync/transport.js'

/**
 * The calls about documents that go straight to the server instead of into
 * the outbox.
 *
 * Each for a reason the outbox cannot serve. A new document is created at the
 * route because that is where its tax treatment is proposed from the customer
 * and the business; through the outbox it would arrive with the default and a
 * small business would write its first quote with tax on it. Issuing hands out
 * a number from a counter. A successor is a head and every line of its
 * predecessor in one transaction, and a cancellation is the same and issued in
 * that transaction too. The deductions of an invoice are read out of what
 * earlier invoices froze, which never travels to a device. The payments on
 * an invoice are recorded at a desk with a connection, and read where the
 * final invoice that takes them off is issued. And the PDF is printed on the
 * server, where the renderer is.
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

/**
 * Issues a document. A final invoice that takes off progress invoices goes
 * with what the office confirmed as received on each of them (#189), in cents
 * and keyed by the number of the progress invoice; the server issues it only
 * when that is what the payments add up to.
 */
export function issueDocument(
  id: string,
  received?: Readonly<Record<string, number>>,
): Promise<RecordState> {
  return request<RecordState>(`/documents/${encodeURIComponent(id)}/issue`, {
    method: 'POST',
    ...(received === undefined ? {} : { body: JSON.stringify({ received }) }),
  })
}

/**
 * The progress invoices whose payments an issuing refusal says are not
 * confirmed, by number, or nothing when the refusal was about something else.
 * Somebody recorded or removed a payment after the screen was drawn, and the
 * screen asks again for exactly those.
 */
export function unconfirmedFrom(error: unknown): readonly string[] {
  if (!(error instanceof RequestRefused) || error.status !== 409) {
    return []
  }

  const body = error.body as { confirm?: unknown; unconfirmed?: unknown } | null

  return body?.confirm === 'payments' && Array.isArray(body.unconfirmed)
    ? body.unconfirmed.filter((number): number is string => typeof number === 'string')
    : []
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
 * Makes one invoice over every open report of a job (#135), a report for each
 * day of work. Which reports are open is the server's question, asked under a
 * lock; the answer is the invoice, a draft, and the next exchange brings it
 * down with its lines and the rows naming its reports.
 */
export function makeCollectiveInvoice(jobId: string): Promise<RecordState> {
  return request<RecordState>(`/jobs/${encodeURIComponent(jobId)}/collective-invoice`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/**
 * Cancels an issued invoice. The answer is the cancellation invoice, already
 * issued with its number; the invoice itself is `cancelled` from then on, and
 * the next exchange brings both down.
 */
export function cancelDocument(id: string): Promise<RecordState> {
  return request<RecordState>(`/documents/${encodeURIComponent(id)}/cancellation`, {
    method: 'POST',
  })
}

/**
 * The progress invoices a document takes off, read by the server out of what
 * those invoices froze when they were issued. Only the server can answer: the
 * frozen records never travel to a device, and working the figures out again
 * from the lines could deduct an amount that is not the one on the paper.
 */
export function deductionsOf(id: string): Promise<readonly DeductionContent[]> {
  return request<readonly DeductionContent[]>(`/documents/${encodeURIComponent(id)}/deductions`)
}

/** What came in on an invoice, and what the invoice asks for, as the server holds it. */
export interface PaymentsOf {
  readonly payments: readonly Payment[]
  readonly billedCents: number
  readonly receivedCents: number
}

/**
 * The payments recorded on an issued invoice, oldest first (#189). On the
 * server only: they are recorded in the office with a connection, and the
 * final invoice that takes them off is issued there too.
 */
export function paymentsOf(id: string): Promise<PaymentsOf> {
  return request<PaymentsOf>(`/documents/${encodeURIComponent(id)}/payments`)
}

/** What an issued invoice asks for and what came in on it, for the list of documents. */
export interface OpenAmount {
  readonly documentId: string
  readonly billedCents: number
  readonly receivedCents: number
}

/** Every issued invoice with something still open (#219), what "Offen" means in the list. */
export function openAmounts(): Promise<readonly OpenAmount[]> {
  return request<readonly OpenAmount[]>('/payments/open')
}

export function recordPayment(
  id: string,
  payment: { readonly amountCents: number; readonly receivedOn: IsoDate },
): Promise<Payment> {
  return request<Payment>(`/documents/${encodeURIComponent(id)}/payments`, {
    method: 'POST',
    body: JSON.stringify(payment),
  })
}

/** Removes a payment recorded by mistake; a wrong one is removed and recorded again. */
export function removePayment(id: string, paymentId: string): Promise<unknown> {
  return request(`/documents/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, {
    method: 'DELETE',
  })
}

/**
 * Where the PDF of a document is. A plain address rather than a fetch: the
 * browser opens it in a tab of its own, with its own viewer, and the session
 * cookie goes along by itself.
 */
export function pdfAddress(id: string): string {
  return `/documents/${encodeURIComponent(id)}/pdf`
}

/**
 * Which format an invoice goes out in, whether the law already requires the
 * e-invoice, and what each form of it would lack. The server answers, because
 * for an issued invoice only it holds what the invoice froze, and it answers
 * for a draft too, so that a gap shows before the number is spent.
 */
export function eInvoiceOf(id: string): Promise<EInvoiceStatus> {
  return request<EInvoiceStatus>(`/documents/${encodeURIComponent(id)}/e-invoice`)
}

/** Where the XRechnung of an issued invoice is, a download like the PDF. */
export function xrechnungAddress(id: string): string {
  return `/documents/${encodeURIComponent(id)}/xrechnung`
}

/** Where the ZUGFeRD PDF of an issued invoice is, the PDF with the e-invoice inside. */
export function zugferdAddress(id: string): string {
  return `/documents/${encodeURIComponent(id)}/zugferd`
}

/** One message with a document, as the server keeps it. */
export interface DocumentMail {
  readonly id: string
  readonly to: string
  readonly attachment: 'pdf' | 'zugferd' | 'xrechnung' | null
  readonly status: 'pending' | 'sent' | 'failed'
  readonly attempts: number
  readonly lastError: string | null
  readonly sentAt: string | null
  readonly createdAt: string
  readonly requestedBy: string | null
}

/**
 * The messages a document went out with, newest first. Kept on the server,
 * where the outbox is: a message is written and sent there and never travels
 * to a device.
 */
export function mailsOf(id: string): Promise<readonly DocumentMail[]> {
  return request<readonly DocumentMail[]>(`/documents/${encodeURIComponent(id)}/mail`)
}

/**
 * Asks the server to send an issued document to its customer. The answer
 * comes at once and says the message waits; the mail goes out a moment later,
 * or once the mail server answers again. Without an address the customer's
 * is used.
 */
export function sendDocument(id: string, to: string | null): Promise<DocumentMail> {
  return request<DocumentMail>(`/documents/${encodeURIComponent(id)}/mail`, {
    method: 'POST',
    body: JSON.stringify(to === null ? {} : { to }),
  })
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
