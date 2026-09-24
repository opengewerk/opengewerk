import type {
  DeductionContent,
  DocumentKind,
  DocumentStatus,
  EInvoiceGap,
  IsoDate,
  MissingDetail,
  RecordState,
} from '@opengewerk/domain'
import {
  closesProgressInvoices,
  continuesChain,
  invoiceFormats,
  isCancellable,
  isInvoice,
  receivesPayments,
  shippedRules,
  successorsOf,
  supplyDateOf,
  whyFixed,
} from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Card, DocumentState, Field } from '../../components/index.js'
import { date, moment, today } from '../../app/format.js'
import { documentKindLabel, documentKindOf, documentStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { ReportFieldList, useReportFieldLines } from '../../app/report-fields.js'
import { SignaturePicture } from '../../app/signature.js'
import {
  cancelDocument,
  createDocument,
  deductionsOf,
  type DocumentMail,
  eInvoiceOf,
  issueDocument,
  mailsOf,
  makeCollectiveInvoice,
  makeSuccessor,
  missingFrom,
  pdfAddress,
  sendDocument,
  unconfirmedFrom,
  xrechnungAddress,
  zugferdAddress,
} from '../../session/documents.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'
import { HeaderSection } from './document-head.js'
import { InstructionsSection } from './document-instructions.js'
import { LinesSection } from './document-lines.js'
import { confirmationKey, PaymentConfirmation, PaymentsCard } from './document-payments.js'
import { claimableTransitions } from './taxes.js'

/** What went wrong with a call to the server, in a sentence somebody can act on. */
function reasonOf(error: unknown, offline: string): string {
  return error instanceof RequestRefused ? error.message : offline
}

/** Oldest first, the order the chain was written in. The id breaks a tie. */
function byDate(left: RecordState, right: RecordState): number {
  return (
    text(left, 'documentDate').localeCompare(text(right, 'documentDate')) ||
    String(left['id']).localeCompare(String(right['id']))
  )
}

/**
 * Whether a row naming a report as a source of a collective invoice still
 * counts (#135): not once the invoice was cancelled or its draft deleted,
 * which the database stamps as `releasedAt`.
 */
function counts(source: RecordState): boolean {
  return source['releasedAt'] === null || source['releasedAt'] === undefined
}

/**
 * The reports of a job that no invoice has billed yet: issued, and neither
 * continued by a successor that counts nor collected in an invoice that
 * counts. Read the way the server reads them before it makes a collective
 * invoice, so that the button is there exactly when there is something to do.
 */
function openReports(
  documents: readonly RecordState[],
  sources: readonly RecordState[],
): readonly RecordState[] {
  return documents.filter((document) => {
    if (
      documentKindOf(document) !== 'time_and_material_report' ||
      documentStatusOf(document) !== 'issued'
    ) {
      return false
    }

    const id = String(document['id'])
    const continued = documents.some(
      (other) =>
        other['predecessorDocumentId'] === id &&
        continuesChain({ kind: documentKindOf(other), status: documentStatusOf(other) }),
    )
    const collected = sources.some((source) => source['sourceDocumentId'] === id && counts(source))

    return !continued && !collected
  })
}

/** A document in a list: what it is, where it stands, when it was written. */
export function DocumentEntry({ document }: { readonly document: RecordState }) {
  const kind = documentKindOf(document)

  return (
    <li className="flex flex-wrap items-center gap-3">
      <Link
        to={`/belege/${String(document['id'])}`}
        className="text-copper-text font-semibold underline underline-offset-2"
      >
        {documentKindLabel[kind]}
      </Link>
      <DocumentState status={documentStatusOf(document)} number={maybeText(document, 'number')} />
      <span className="text-ink-muted">{date(document['documentDate'])}</span>
      {maybeText(document, 'subject') ? (
        <span className="text-ink">{text(document, 'subject')}</span>
      ) : null}
    </li>
  )
}

/**
 * The documents of a job, and the two ways to start one.
 *
 * Two buttons and not one with a choice behind it. A quote and a cost
 * estimate are different statements with different consequences, section 4.2
 * keeps them apart, and a form with a kind field is how somebody sends the
 * wrong one because the field was left on its default.
 */
export function JobDocuments({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const client = useSync()
  const navigate = useNavigate()
  const mayWrite = useMay('document.write')
  const documents = useRelated('documents', 'jobId', jobId)
  const sources = useRecords('document_sources')
  const sorted = useMemo(() => [...documents].sort(byDate), [documents])
  const open = useMemo(() => openReports(documents, sources), [documents, sources])
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  // One invoice over the reports of several days of work (#135). Offered from
  // two open reports on: a single one has its own button, on the report.
  async function collect() {
    setWorking(true)
    setTrouble(null)

    try {
      const created = await makeCollectiveInvoice(jobId)

      await client.synchronise()
      await navigate({ to: `/belege/${String(created['id'])}` })
    } catch (error) {
      setTrouble(
        reasonOf(
          error,
          'Keine Verbindung. Die Rechnung über die Regieberichte entsteht mit Verbindung, in ' +
            'einem Schritt mit allen ihren Positionen.',
        ),
      )
    } finally {
      setWorking(false)
    }
  }

  async function start(kind: 'quote' | 'cost_estimate') {
    setWorking(true)
    setTrouble(null)

    try {
      const created = await createDocument({
        customerId: String(job['customerId']),
        jobId,
        siteId: maybeText(job, 'siteId'),
        installationId: maybeText(job, 'installationId'),
        kind,
        documentDate: today(),
        subject: maybeText(job, 'designation'),
      })

      // The document exists on the server and not yet here. One exchange
      // brings it down, so the screen it opens on has something to show.
      await client.synchronise()
      await navigate({ to: `/belege/${String(created['id'])}` })
    } catch (error) {
      setTrouble(
        reasonOf(
          error,
          'Keine Verbindung. Ein Beleg entsteht mit Verbindung, weil der Server dabei vorschlägt, ' +
            'wie er besteuert wird.',
        ),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Section
      title="Belege"
      actions={
        mayWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={working} onClick={() => void start('quote')}>
              Angebot anlegen
            </Button>
            <Button disabled={working} onClick={() => void start('cost_estimate')}>
              Kostenvoranschlag anlegen
            </Button>
            {open.length > 1 ? (
              <Button disabled={working} onClick={() => void collect()}>
                {`Rechnung über ${String(open.length)} Regieberichte`}
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {trouble ? (
        <p role="alert" className="mb-3 text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      {sorted.length === 0 ? (
        <Nothing>Noch kein Beleg zu diesem Auftrag.</Nothing>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((document) => (
            <DocumentEntry key={String(document['id'])} document={document} />
          ))}
        </ul>
      )}
    </Section>
  )
}

/**
 * The screen of one document: a quote, an estimate, an order confirmation, a
 * report signed on site, an invoice and its cancellation.
 *
 * Everything on it reads from the sync client, and everything written while
 * it is a draft goes into the outbox: the head, the texts, every line. What
 * goes straight to the server is what only the server can do, which is
 * handing out a number, making a successor or a cancellation in one step and
 * printing.
 */
export function DocumentScreen() {
  const { documentId } = useParams({ strict: false }) as { documentId?: string }
  const document = useRecord('documents', documentId)

  if (!document || !documentId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>Diesen Beleg gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.</Nothing>
      </Page>
    )
  }

  // Keyed, so that moving from a quote to its order confirmation starts the
  // second screen fresh instead of carrying an open form across.
  return <DocumentView key={documentId} document={document} />
}

function DocumentView({ document }: { readonly document: RecordState }) {
  const documentId = String(document['id'])
  const client = useSync()
  const navigate = useNavigate()
  const customer = useRecord('customers', String(document['customerId']))
  const job = useRecord('jobs', maybeText(document, 'jobId') ?? undefined)
  const predecessor = useRecord(
    'documents',
    maybeText(document, 'predecessorDocumentId') ?? undefined,
  )
  const successors = useRelated('documents', 'predecessorDocumentId', documentId)
  const allDocuments = useRecords('documents')
  const sources = useRecords('document_sources')
  // A collective invoice names its reports here and not as its predecessor,
  // and a report in one has it as its successor (#135).
  const collectedFrom = useMemo(
    () =>
      sources
        .filter((source) => source['documentId'] === documentId)
        .sort((left, right) => Number(left['position']) - Number(right['position']))
        .map((source) => allDocuments.find((other) => other['id'] === source['sourceDocumentId']))
        .filter((report): report is RecordState => report !== undefined),
    [sources, allDocuments, documentId],
  )
  const collectedIn = useMemo(() => {
    const source = sources.find((row) => row['sourceDocumentId'] === documentId && counts(row))

    return source ? allDocuments.find((other) => other['id'] === source['documentId']) : undefined
  }, [sources, allDocuments, documentId])
  const mayWrite = useMay('document.write')
  const mayIssue = useMay('document.issue')
  const [issuing, setIssuing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)

  const kind = documentKindOf(document)
  const status = documentStatusOf(document)
  const number = maybeText(document, 'number')
  // A final invoice is a Schlussrechnung only when it takes off progress
  // invoices (#132). Which ones only the server knows, from the frozen state
  // once the invoice is issued; the lines below ask the same question, and
  // the cache answers both.
  const deductions = useQuery({
    queryKey: ['deductions', documentId],
    queryFn: () => deductionsOf(documentId),
    enabled: kind === 'final_invoice',
  })
  const deductionList = Array.isArray(deductions.data) ? deductions.data : []
  const closing = closesProgressInvoices({ kind, deductions: deductionList })
  const heading = closing ? 'Schlussrechnung' : documentKindLabel[kind]
  const fixed = whyFixed({ kind, status })
  const editable = fixed === null && mayWrite
  // A signed report is fixed and still waits for its number. Issuing it is
  // the office's step, and the only one left: nothing on it changes on the way.
  const issuable = status === 'draft' || status === 'signed'
  // The chain does not branch (#129). Once a successor that counts has been
  // made out of this document, the next one is made out of that one, and the
  // head of the page leads there instead of offering a second one here.
  const continuing =
    successors.find((successor) =>
      continuesChain({ kind: documentKindOf(successor), status: documentStatusOf(successor) }),
    ) ?? collectedIn
  const next = status === 'issued' && mayWrite && !continuing ? successorsOf(kind) : []
  // Cancelling is issuing the other way round, so it takes the same right: a
  // cancellation goes into the books like the invoice did.
  const cancellable = status === 'issued' && isCancellable(kind) && mayIssue

  async function follow(successor: DocumentKind) {
    setFollowing(true)
    setTrouble(null)

    try {
      const created = await makeSuccessor(documentId, successor)

      await client.synchronise()
      await navigate({ to: `/belege/${String(created['id'])}` })
    } catch (error) {
      setTrouble(
        reasonOf(
          error,
          'Keine Verbindung. Ein Folgebeleg entsteht mit Verbindung, in einem Schritt mit allen ' +
            'Positionen seines Vorgängers.',
        ),
      )
    } finally {
      setFollowing(false)
    }
  }

  return (
    <Page
      crumbs={
        job ? (
          <>
            <Crumb to="/auftraege">Aufträge</Crumb>
            <Crumb to={`/auftraege/${String(job['id'])}`}>{text(job, 'designation')}</Crumb>
          </>
        ) : customer ? (
          <Crumb to={`/kunden/${String(customer['id'])}`}>{text(customer, 'name')}</Crumb>
        ) : null
      }
      title={number ? `${heading} ${number}` : heading}
      meta={
        <span className="inline-flex flex-wrap items-center gap-2">
          <DocumentState status={status} number={number} />
          <span>{date(document['documentDate'])}</span>
          {customer ? (
            <Link
              to={`/kunden/${String(customer['id'])}`}
              className="text-copper-text underline underline-offset-2"
            >
              {text(customer, 'name')}
            </Link>
          ) : null}
        </span>
      }
      actions={
        <>
          <a
            href={pdfAddress(documentId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-control min-h-tap px-4 rounded-control text-body font-semibold bg-surface text-ink border border-line-strong"
          >
            {status === 'draft' ? 'Entwurf als PDF' : 'PDF öffnen'}
          </a>
          {issuable && mayIssue ? (
            <Button
              onClick={() => {
                setIssuing(true)
              }}
              disabled={issuing}
            >
              Festschreiben
            </Button>
          ) : null}
          {cancellable ? (
            <Button
              onClick={() => {
                setCancelling(true)
              }}
              disabled={cancelling}
            >
              Stornieren
            </Button>
          ) : null}
          {next.map((successor) => (
            <Button
              key={successor}
              tone="primary"
              disabled={following}
              onClick={() => void follow(successor)}
            >
              {`${documentKindLabel[successor]} erstellen`}
            </Button>
          ))}
          {continuing && status === 'issued' && successorsOf(kind).length > 0 ? (
            <Link to={`/belege/${String(continuing['id'])}`} className={downloadLink}>
              {`Weiter bei ${documentName(continuing)}`}
            </Link>
          ) : null}
        </>
      }
    >
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {kind === 'cost_estimate' ? <EstimateNotice /> : null}

      {fixed ? (
        <Card label={fixedLabel[status] ?? 'Festgeschrieben'} tone="sunken">
          <p role="status" className="text-body text-ink">
            {fixed}
          </p>
        </Card>
      ) : null}

      {issuing && issuable ? (
        <IssueCard
          documentId={documentId}
          deductions={closing ? deductionList : []}
          onDone={() => {
            setIssuing(false)
          }}
        />
      ) : null}

      {cancelling && cancellable ? (
        <CancelCard
          documentId={documentId}
          onDone={() => {
            setCancelling(false)
          }}
        />
      ) : null}

      {isInvoice(kind) ? (
        <EInvoiceCard
          documentId={documentId}
          status={status}
          claimMatters={hangsOnClaim(document)}
        />
      ) : null}

      {status === 'issued' && receivesPayments(kind) ? (
        <PaymentsCard documentId={documentId} kind={kind} />
      ) : null}

      {number !== null || status === 'signed' ? (
        <MailCard
          documentId={documentId}
          customerEmail={customer ? maybeText(customer, 'email') : null}
        />
      ) : null}

      <HeaderSection document={document} editable={editable} />
      <ReportFieldsSection document={document} />
      <LinesSection document={document} editable={editable} />
      <InstructionsSection document={document} />
      <SignatureSection documentId={documentId} />
      <ChainSection
        kind={kind}
        predecessors={predecessor ? [predecessor] : collectedFrom}
        successors={collectedIn ? [...successors, collectedIn] : successors}
      />
    </Page>
  )
}

/** A document as a sentence names it: its kind and number, or that it is still a draft. */
function documentName(document: RecordState): string {
  const number = maybeText(document, 'number')
  const label = documentKindLabel[documentKindOf(document)]

  return number ? `${label} ${number}` : `${label}, Entwurf`
}

/** A download that looks like the other buttons in the head of the page. */
const downloadLink =
  'inline-flex items-center justify-center h-control min-h-tap px-4 rounded-control text-body ' +
  'font-semibold bg-surface text-ink border border-line-strong'

/** What a form of the e-invoice still lacks, under a heading that says which form. */
function Gaps({
  heading,
  gaps,
}: {
  readonly heading: string
  readonly gaps: readonly EInvoiceGap[]
}) {
  if (gaps.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-semibold text-ink">{heading}</p>
      <ul className="list-disc pl-6 text-body text-ink">
        {gaps.map((gap) => (
          <li key={gap.detail}>{gap.message}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Whether the invoice is for work in a year whose transition hangs on the
 * turnover the business states under "Steuern". The same day the server asks
 * about, out of the same rule package.
 */
function hangsOnClaim(document: RecordState): boolean {
  const supplied = supplyDateOf({
    documentDate: text(document, 'documentDate') as IsoDate,
    serviceFrom: maybeText(document, 'serviceFrom') as IsoDate | null,
    serviceUntil: maybeText(document, 'serviceUntil') as IsoDate | null,
  })

  return claimableTransitions(shippedRules).some(
    (transition) => supplied >= transition.from && supplied <= transition.until,
  )
}

/**
 * How an invoice goes out, and why. The customer decides it, not a switch on
 * the document, so the screen says what the master data made of it: an
 * e-invoice for a business in Germany, a PDF for everybody else, each with the
 * paragraph.
 *
 * For an e-invoice it says whether the law already requires it and what each
 * of its two forms would still lack, and it says so on the draft, where a
 * missing e-mail address of the customer is still cheap to add. Once the
 * invoice is issued it offers the files: the ZUGFeRD PDF, which a business
 * reads like any invoice and its software reads as data, and the XRechnung,
 * the XML a public authority asks for.
 *
 * Without a connection it shows nothing rather than a guess. What an issued
 * invoice froze is on the server, and the answer depends on it.
 */
function EInvoiceCard({
  documentId,
  status,
  claimMatters,
}: {
  readonly documentId: string
  readonly status: DocumentStatus
  /** The duty hangs on the transition the business states under "Steuern". */
  readonly claimMatters: boolean
}) {
  const answer = useQuery({
    queryKey: ['e-invoice', documentId, status],
    queryFn: () => eInvoiceOf(documentId),
  })
  const readsSettings = useMay('settings.read')

  // An answer this screen does not understand shows nothing, like no answer.
  if (!answer.data || !invoiceFormats.includes(answer.data.format)) {
    return null
  }

  const { format, reason, duty, issued, xrechnung, zugferd } = answer.data

  if (format === 'pdf') {
    return (
      <Card label="Versand als PDF" tone="sunken">
        <p className="text-body text-ink">{reason}</p>
      </Card>
    )
  }

  // The XRechnung asks everything the standard asks and more. What the
  // standard lacks stops both forms, the rest only the XRechnung.
  const both = zugferd.missing
  const onlyXrechnung = xrechnung.missing.filter(
    (gap) => !both.some((other) => other.detail === gap.detail),
  )

  return (
    <Card label="E-Rechnung">
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink">{reason}</p>
        {duty ? <p className="text-body text-ink">{duty.reason}</p> : null}
        {duty && claimMatters && readsSettings ? (
          <p className="text-body text-ink">
            <Link
              to="/einstellungen/steuern"
              className="text-copper-text underline underline-offset-2"
            >
              Erklärung zum Übergang unter „Steuern“
            </Link>
          </p>
        ) : null}
        <Gaps heading="Für die E-Rechnung fehlt noch:" gaps={both} />
        <Gaps
          heading={
            both.length > 0 ? 'Für die XRechnung außerdem:' : 'Für die XRechnung fehlt noch:'
          }
          gaps={onlyXrechnung}
        />
        {both.length > 0 ? null : issued ? (
          <>
            <div className="flex flex-wrap gap-2">
              <a href={zugferdAddress(documentId)} download className={downloadLink}>
                ZUGFeRD-PDF herunterladen
              </a>
              {onlyXrechnung.length === 0 ? (
                <a href={xrechnungAddress(documentId)} download className={downloadLink}>
                  XRechnung herunterladen
                </a>
              ) : null}
            </div>
            <p className="text-body text-ink-muted">
              Das ZUGFeRD-PDF ist die Rechnung als PDF mit den Daten darin, für Unternehmen. Die
              XRechnung ist die Rechnung als reines XML, wie Behörden sie verlangen.
            </p>
          </>
        ) : (
          <p className="text-body text-ink-muted">
            Die E-Rechnung gibt es, sobald die Rechnung festgeschrieben ist.
          </p>
        )}
      </div>
    </Card>
  )
}

/** The file a message carried, in the words of the e-invoice card. */
const attachmentLabel: Readonly<Record<NonNullable<DocumentMail['attachment']>, string>> = {
  pdf: 'PDF',
  zugferd: 'ZUGFeRD-PDF',
  xrechnung: 'XRechnung',
}

/** Where one message stands, in a sentence. */
function mailState(mail: DocumentMail): string {
  const file = mail.attachment ? `, mit ${attachmentLabel[mail.attachment]}` : ''
  const who = mail.requestedBy ? `, geschickt von ${mail.requestedBy}` : ''

  switch (mail.status) {
    case 'sent':
      return `An ${mail.to}: versendet am ${moment(mail.sentAt)}${file}${who}.`
    case 'failed':
      return `An ${mail.to}: nicht zugestellt${file}${who}. ${mail.lastError ?? ''}`.trim()
    case 'pending':
      return mail.attempts > 0
        ? `An ${mail.to}: noch nicht zugestellt, OpenGewerk versucht es weiter von selbst${file}.`
        : `An ${mail.to}: wartet auf den Versand${file}${who}.`
  }
}

/**
 * Sending an issued document to its customer, and what became of it.
 *
 * The button asks the server and the answer comes at once: the message waits
 * in the outbox and goes out a moment later, or once the mail server answers
 * again. While one waits the list asks every ten seconds, so that "versendet"
 * shows without a reload. The address is the customer's unless somebody types
 * another, for this one message; which file goes along the server decides,
 * the same way the e-invoice card above says.
 */
function MailCard({
  documentId,
  customerEmail,
}: {
  readonly documentId: string
  readonly customerEmail: string | null
}) {
  const maySend = useMay('document.issue')
  const queries = useQueryClient()
  const mails = useQuery({
    queryKey: ['document-mail', documentId],
    queryFn: () => mailsOf(documentId),
    refetchInterval: (query) =>
      Array.isArray(query.state.data) && query.state.data.some((mail) => mail.status === 'pending')
        ? 10_000
        : false,
  })
  const [typed, setTyped] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  const address = typed ?? customerEmail ?? ''
  // An answer this screen does not understand shows nothing, like no answer.
  const list = Array.isArray(mails.data) ? mails.data : []

  const send = useMutation({
    mutationFn: () => sendDocument(documentId, typed === null ? null : typed.trim()),
    onSuccess: () => {
      setTrouble(null)
      setTyped(null)
      void queries.invalidateQueries({ queryKey: ['document-mail', documentId] })
    },
    onError: (error) => {
      setTrouble(
        reasonOf(error, 'Keine Verbindung. Verschickt wird, sobald das Gerät wieder Netz hat.'),
      )
    },
  })

  return (
    <Card label="Per E-Mail">
      <div className="flex flex-col gap-3">
        {list.length > 0 ? (
          <ul className="flex flex-col gap-1 text-body text-ink">
            {list.map((mail) => (
              <li key={mail.id}>{mailState(mail)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-ink-muted">
            Dieser Beleg wurde noch nicht per E-Mail verschickt.
          </p>
        )}

        {maySend ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              send.mutate()
            }}
          >
            <Field
              label="An"
              type="email"
              value={address}
              hint={
                customerEmail
                  ? 'Die Adresse des Kunden. Eine andere gilt nur für diese Nachricht.'
                  : 'Beim Kunden ist keine Adresse hinterlegt.'
              }
              onChange={(event) => {
                setTyped(event.target.value)
              }}
            />
            <div>
              <Button
                type="submit"
                tone="primary"
                disabled={send.isPending || address.trim() === ''}
              >
                {send.isPending ? 'Einen Moment' : 'Per E-Mail senden'}
              </Button>
            </div>
          </form>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Card>
  )
}

/** What the card of a fixed document is headed with, where it is not the default. */
const fixedLabel: Readonly<Partial<Record<DocumentStatus, string>>> = {
  signed: 'Unterschrieben',
  cancelled: 'Storniert',
}

/**
 * What sets an estimate apart from a quote, said where it is written. The law
 * treats the two differently, and a business that sends an estimate should
 * know what it has promised and what it has not.
 */
function EstimateNotice() {
  return (
    <Card label="Kostenvoranschlag" tone="sunken">
      <p className="text-body text-ink">
        Ein Kostenvoranschlag ist eine Schätzung ohne Gewähr für ihre Richtigkeit. Zeichnet sich ab,
        dass er wesentlich überschritten wird, muss der Kunde das unverzüglich erfahren (§ 649 BGB).
        Wer einen festen Preis zusagen will, schreibt ein Angebot.
      </p>
    </Card>
  )
}

/**
 * The second step of issuing. Two steps because the first cannot be undone:
 * the number is handed out, and the document is what it is from then on.
 *
 * A final invoice that takes off progress invoices asks one more thing on the
 * way (#189): for each of them, whether what came in is right. The server
 * issues it only with that answer, and names the progress invoices whose
 * payments changed in the meantime; their boxes are empty again then, and the
 * list shows what the payments add up to now.
 */
function IssueCard({
  documentId,
  deductions,
  onDone,
}: {
  readonly documentId: string
  /** The progress invoices a final invoice takes off, and nothing for any other document. */
  readonly deductions: readonly DeductionContent[]
  readonly onDone: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [missing, setMissing] = useState<readonly MissingDetail[]>([])
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set())

  const unconfirmed = deductions.filter((deduction) => !confirmed.has(confirmationKey(deduction)))

  async function issue() {
    setWorking(true)
    setTrouble(null)
    setMissing([])

    try {
      // What this device changed has to be on the server first. The number is
      // given to what the server holds, and a line still waiting in the outbox
      // would be missing from the document that goes out.
      await client.synchronise()

      if (client.status().pending > 0) {
        setTrouble(
          'Auf diesem Gerät warten noch Änderungen, die der Server nicht hat. Festgeschrieben ' +
            'wird, sobald sie angekommen sind.',
        )

        return
      }

      await issueDocument(
        documentId,
        deductions.length === 0
          ? undefined
          : Object.fromEntries(
              deductions.map((deduction) => [
                deduction.number,
                deduction.received?.grossCents ?? 0,
              ]),
            ),
      )
      await client.synchronise()
      onDone()
    } catch (error) {
      const lacking = missingFrom(error)
      const changed = unconfirmedFrom(error)

      if (changed.length > 0) {
        setConfirmed(
          (before) =>
            new Set([...before].filter((key) => !changed.some((one) => key.startsWith(`${one}:`)))),
        )
        void queries.invalidateQueries({ queryKey: ['deductions', documentId] })
      }

      setMissing(lacking)
      setTrouble(
        lacking.length > 0
          ? 'Es fehlen noch Pflichtangaben:'
          : reasonOf(
              error,
              'Keine Verbindung. Festgeschrieben wird mit Verbindung, weil der Server dabei die ' +
                'Nummer vergibt.',
            ),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card label="Festschreiben">
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink">
          Festschreiben vergibt die nächste Nummer. Danach lässt sich der Beleg nicht mehr ändern;
          soll sich etwas ändern, entsteht dafür ein neuer Beleg.
        </p>
        {deductions.length > 0 ? (
          <PaymentConfirmation
            deductions={deductions}
            confirmed={confirmed}
            onChange={(key, checked) => {
              setConfirmed((before) => {
                const next = new Set(before)

                if (checked) {
                  next.add(key)
                } else {
                  next.delete(key)
                }

                return next
              })
            }}
          />
        ) : null}
        {trouble ? (
          <div role="alert" className="flex flex-col gap-1">
            <p className="text-body font-semibold text-conflict">{trouble}</p>
            {missing.length > 0 ? (
              <ul className="list-disc pl-6 text-body text-ink">
                {missing.map((entry, index) => (
                  // The detail alone is not unique: every instruction that
                  // lacks something reports as `instruction`, with no line.
                  <li key={`${entry.detail}-${String(entry.position ?? '')}-${String(index)}`}>
                    {entry.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            tone="primary"
            disabled={working || unconfirmed.length > 0}
            onClick={() => void issue()}
          >
            {working ? 'Wird festgeschrieben' : 'Jetzt festschreiben'}
          </Button>
          <Button tone="quiet" disabled={working} onClick={onDone}>
            Abbrechen
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * The second step of cancelling, for the reason issuing has one: neither step
 * can be undone. The cancellation gets the next number of the invoices and
 * goes into the books beside the invoice, and the screen moves on to it.
 *
 * Nothing on this device has to reach the server first. The invoice is issued
 * and has nothing left in the outbox, and the cancellation is written out of
 * what the invoice froze, not out of anything held here.
 */
function CancelCard({
  documentId,
  onDone,
}: {
  readonly documentId: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function cancel() {
    setWorking(true)
    setTrouble(null)

    try {
      const created = await cancelDocument(documentId)

      await client.synchronise()
      await navigate({ to: `/belege/${String(created['id'])}` })
    } catch (error) {
      setTrouble(
        reasonOf(
          error,
          'Keine Verbindung. Storniert wird mit Verbindung, weil der Server dabei die nächste ' +
            'Rechnungsnummer vergibt.',
        ),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card label="Stornieren">
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink">
          Stornieren schreibt eine Stornorechnung mit der nächsten Rechnungsnummer. Sie nennt diese
          Rechnung und wiederholt jeden ihrer Beträge mit umgekehrtem Vorzeichen. Die Rechnung
          bleibt in den Büchern und gilt danach als storniert. Zurücknehmen lässt sich das nicht;
          soll die Leistung wieder berechnet werden, entsteht dafür eine neue Rechnung.
        </p>
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button tone="primary" disabled={working} onClick={() => void cancel()}>
            {working ? 'Wird storniert' : 'Jetzt stornieren'}
          </Button>
          <Button tone="quiet" disabled={working} onClick={onDone}>
            Abbrechen
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * The fields the business gives its reports (#78), as they were filled in on
 * site and as the customer signed them. Read here and not changed: they are
 * part of the page under the signature.
 */
function ReportFieldsSection({ document }: { readonly document: RecordState }) {
  const lines = useReportFieldLines(document)

  return lines.length === 0 ? null : (
    <Section title="Angaben">
      <ReportFieldList lines={lines} />
    </Section>
  )
}

/**
 * The customer's signature, as it was given on site: the picture, the name
 * typed beside it, the moment, and what the device said about itself. The
 * last two are what section 4.10 asks a simple signature to carry.
 */
function SignatureSection({ documentId }: { readonly documentId: string }) {
  const [signature] = useRelated('document_signatures', 'documentId', documentId)

  if (!signature) {
    return null
  }

  return (
    <Section title="Unterschrift">
      <div className="flex flex-col gap-4">
        <SignaturePicture
          path={text(signature, 'path')}
          label={`Unterschrift von ${text(signature, 'signerName')}`}
        />
        <Facts>
          <Fact label="Unterschrieben von">{text(signature, 'signerName')}</Fact>
          <Fact label="Unterschrieben am">{`${moment(maybeText(signature, 'signedAt'))} Uhr`}</Fact>
          <Fact label="Gerät">{maybeText(signature, 'deviceInfo')}</Fact>
        </Facts>
      </div>
    </Section>
  )
}

/**
 * Where the document stands in the chain of section 1.4: what it was made
 * from, and what has been made from it. A cancellation was not made from its
 * invoice so much as against it, and says so.
 */
function ChainSection({
  kind,
  predecessors,
  successors,
}: {
  readonly kind: DocumentKind
  /** One, or the reports of a collective invoice (#135), in its order. */
  readonly predecessors: readonly RecordState[]
  readonly successors: readonly RecordState[]
}) {
  if (predecessors.length === 0 && successors.length === 0) {
    return null
  }

  return (
    <Section title="Belegkette">
      <Facts>
        {predecessors.length > 0 ? (
          <Fact label={kind === 'cancellation_invoice' ? 'Storno zu' : 'Entstanden aus'}>
            <ul className="flex flex-col gap-2">
              {predecessors.map((predecessor) => (
                <DocumentEntry key={String(predecessor['id'])} document={predecessor} />
              ))}
            </ul>
          </Fact>
        ) : null}
        {successors.length > 0 ? (
          <Fact label="Folgebelege">
            <ul className="flex flex-col gap-2">
              {[...successors].sort(byDate).map((successor) => (
                <DocumentEntry key={String(successor['id'])} document={successor} />
              ))}
            </ul>
          </Fact>
        ) : null}
      </Facts>
    </Section>
  )
}
