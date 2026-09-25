import type { DocumentKind, DocumentStatus, IsoDate, RecordState } from '@opengewerk/domain'
import {
  closesProgressInvoices,
  continuesChain,
  isCancellable,
  isInvoice,
  receivesPayments,
  shippedRules,
  successorsOf,
  supplyDateOf,
  whyFixed,
} from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronRight, Eye, File, Lock, Pencil } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  Button,
  ButtonLink,
  cardLink,
  Cell,
  Column,
  DocumentState,
  Panel,
  statusIcons,
  TablePanel,
  useBand,
  useButtonLook,
} from '../../components/index.js'
import type { TableCard } from '../../components/index.js'
import { date, euros, moment, today } from '../../app/format.js'
import { documentKindLabel, documentKindOf, documentStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { usePeople } from '../../app/tasks.js'
import { useReportFieldLines } from '../../app/report-fields.js'
import {
  createDocument,
  makeCollectiveInvoice,
  makeSuccessor,
  pdfAddress,
} from '../../session/documents.js'
import type { Assignee } from '../../session/tasks.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { NoteBox, PageHead, RecordColumns, Screen } from '../kit.js'
import {
  ChainCard,
  documentName,
  EInvoiceCard,
  MailCard,
  ReportFieldsCard,
  SignatureCard,
  useSignature,
  WorkDoneCard,
} from './document-cards.js'
import { DraftFrame, FixedFrame } from './document-frame.js'
import { useGrossByDocument } from './document-gross.js'
import { HeaderCard } from './document-head.js'
import { InstructionsCard } from './document-instructions.js'
import { LinesPanel, useDocumentFigures } from './document-lines.js'
import { DocumentMarker } from './document-marker.js'
import { PaymentsCard } from './document-payments.js'
import { CancelPanel, IssuePanel, reasonOf } from './document-steps.js'
import { claimableTransitions } from './taxes.js'

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

/** What the screen of a job needs of its documents: the list, and the ways to a new one. */
export interface JobDocumentsState {
  /** Oldest first, the order the chain was written in. */
  readonly documents: readonly RecordState[]
  /** The reports one invoice can bill (#135). */
  readonly openReports: readonly RecordState[]
  readonly mayWrite: boolean
  readonly working: boolean
  readonly trouble: string | null
  readonly start: (kind: 'quote' | 'cost_estimate') => Promise<void>
  readonly collect: () => Promise<void>
}

/**
 * The documents of a job, and the two ways to start one.
 *
 * Two buttons and not one with a choice behind it. A quote and a cost
 * estimate are different statements with different consequences, section 4.2
 * keeps them apart, and a form with a kind field is how somebody sends the
 * wrong one because the field was left on its default.
 */
export function useJobDocuments(job: RecordState): JobDocumentsState {
  const jobId = String(job['id'])
  const client = useSync()
  const navigate = useNavigate()
  const mayWrite = useMay('document.write')
  const related = useRelated('documents', 'jobId', jobId)
  const sources = useRecords('document_sources')
  const documents = useMemo(() => [...related].sort(byDate), [related])
  const open = useMemo(() => openReports(related, sources), [related, sources])
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

  return { documents, openReports: open, mayWrite, working, trouble, start, collect }
}

/**
 * "Belege" of a job, `table_card()` of the board "Auftrag": what each is, its
 * number and state, its day and subject; over them the one invoice for the
 * open reports.
 */
export function JobDocumentsPanel({ state }: { readonly state: JobDocumentsState }) {
  const { documents, openReports: open, mayWrite, working } = state
  const navigate = useNavigate()
  const action =
    mayWrite && open.length > 1 ? (
      <Button size="small" disabled={working} onClick={() => void state.collect()}>
        {`Rechnung über ${String(open.length)} Regieberichte`}
      </Button>
    ) : null

  if (documents.length === 0) {
    return (
      <Panel title="Belege" action={action}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Noch kein Beleg zu diesem Auftrag. Angebot und Kostenvoranschlag entstehen oben im Kopf.
        </p>
      </Panel>
    )
  }

  const cards: TableCard[] = documents.map((document) => {
    const id = String(document['id'])

    return {
      key: id,
      title: (
        <Link to={`/belege/${id}`} className={cardLink}>
          {documentKindLabel[documentKindOf(document)]}
        </Link>
      ),
      sub: [text(document, 'number'), date(document['documentDate']), text(document, 'subject')]
        .filter((part) => part !== '')
        .join(' · '),
      right: <DocumentMarker document={document} />,
    }
  })

  return (
    <TablePanel title="Belege" caption="Belege des Auftrags" action={action} cards={cards}>
      <thead>
        <tr>
          <Column className="w-[150px]">Art</Column>
          <Column className="w-[108px]">Nummer</Column>
          <Column className="w-[140px]">Status</Column>
          <Column className="w-[92px]">Datum</Column>
          <Column>Betreff</Column>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => {
          const id = String(document['id'])

          return (
            <tr
              key={id}
              className="cursor-pointer hover:bg-surface-sunken"
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('a, button')) {
                  void navigate({ to: `/belege/${id}` })
                }
              }}
            >
              <Cell>
                <Link to={`/belege/${id}`} className="text-inherit no-underline hover:underline">
                  {documentKindLabel[documentKindOf(document)]}
                </Link>
              </Cell>
              <Cell className="numeric">{text(document, 'number')}</Cell>
              <Cell>
                <DocumentMarker document={document} />
              </Cell>
              <Cell className="numeric">{date(document['documentDate'])}</Cell>
              <Cell>{text(document, 'subject')}</Cell>
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}

/**
 * "Belegkette" over the record of a job: its documents in the order they
 * were written, each with its state in a symbol and a line, the draft in a
 * dashed box because it is not yet what it will be.
 */
export function DocumentChainCard({ documents }: { readonly documents: readonly RecordState[] }) {
  const gross = useGrossByDocument()
  const band = useBand()

  if (documents.length === 0) {
    return null
  }

  // On a phone a line per document, the number at the right, as the chain of
  // "Auftrag im Büro, Telefon" stands.
  if (band === 'S') {
    return (
      <Panel title="Belegkette">
        <ol className="flex flex-col gap-1.5">
          {documents.map((document) => {
            const id = String(document['id'])
            const status = documentStatusOf(document)
            const Icon = chainIcons[status]

            return (
              <li key={id}>
                <Link
                  to={`/belege/${id}`}
                  className="flex min-h-10 items-center gap-2 rounded-control border border-line bg-ground px-2.5 text-[15px] text-ink no-underline"
                >
                  <Icon
                    size={16}
                    strokeWidth={2.2}
                    aria-hidden="true"
                    className="shrink-0 text-ink-muted"
                  />
                  <span className="min-w-0 grow">
                    {documentKindLabel[documentKindOf(document)]}
                  </span>
                  <span className="numeric shrink-0 text-[13px] text-ink-faint">
                    {maybeText(document, 'number') ??
                      (status === 'draft'
                        ? 'Entwurf'
                        : status === 'signed'
                          ? 'unterschrieben'
                          : '')}
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      </Panel>
    )
  }

  return (
    <Panel title="Belegkette">
      <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {documents.map((document, index) => {
          const id = String(document['id'])
          const status = documentStatusOf(document)
          const number = maybeText(document, 'number')
          const amount = gross.get(id)
          const Icon = chainIcons[status]
          const draft = status === 'draft'
          const line =
            status === 'draft'
              ? 'Entwurf, keine Nummer'
              : [
                  number ?? (status === 'signed' ? 'noch ohne Nummer' : null),
                  status === 'signed'
                    ? 'unterschrieben'
                    : status === 'cancelled'
                      ? 'storniert'
                      : amount === null || amount === undefined
                        ? null
                        : euros(amount),
                ]
                  .filter((part): part is string => part !== null)
                  .join(' · ')

          return (
            <li key={id} className="flex min-w-0 items-stretch gap-2 lg:basis-0 lg:grow">
              {index > 0 ? (
                <ChevronRight
                  size={15}
                  strokeWidth={2.2}
                  aria-hidden="true"
                  className="hidden shrink-0 self-center text-ink-faint lg:block"
                />
              ) : null}
              <Link
                to={`/belege/${id}`}
                className={clsx(
                  'flex min-w-0 grow flex-col gap-[3px] rounded-control border px-[11px] py-[9px] no-underline',
                  draft
                    ? 'border-dashed border-waiting-edge bg-surface text-waiting'
                    : 'border-line bg-ground text-ink',
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Icon
                    size={13}
                    strokeWidth={2.2}
                    aria-hidden="true"
                    className={clsx('shrink-0', draft ? 'text-waiting' : 'text-ink-muted')}
                  />
                  {documentKindLabel[documentKindOf(document)]}
                </span>
                <span
                  className={clsx('numeric text-[13px]', draft ? 'text-waiting' : 'text-ink-muted')}
                >
                  {line}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

/**
 * The line under the number of a fixed document, as the board "Schlussrechnung,
 * festgeschrieben" has it: when, and by whom (#249). The name comes the way the
 * name on a task does. A document fixed before anybody kept it, or by somebody
 * this device cannot name, shows the moment alone.
 */
export function issuedLine(document: RecordState, people: readonly Assignee[]): string {
  const at = maybeText(document, 'issuedAt')

  if (!at) {
    return 'Festgeschrieben'
  }

  const by = maybeText(document, 'issuedBy')
  const name = by ? people.find((person) => person.userId === by)?.name : undefined

  return name ? `Festgeschrieben ${moment(at)} · ${name}` : `Festgeschrieben ${moment(at)}`
}

/** The symbol of a document in the chain: locked, signed, drafted, cancelled. */
const chainIcons: Readonly<Record<DocumentStatus, LucideIcon>> = {
  draft: Pencil,
  signed: statusIcons.sign,
  issued: Lock,
  cancelled: statusIcons.ban,
}

/**
 * The screen of one document: a quote, an estimate, an order confirmation, a
 * report signed on site, an invoice and its cancellation, after the boards
 * "Angebot, Entwurf", "Festschreiben einer Schlussrechnung", "Schlussrechnung,
 * festgeschrieben" and "Regiebericht, unterschrieben" (#219).
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
      <Screen>
        <PageHead title="Nicht gefunden" />
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Diesen Beleg gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.
        </p>
      </Screen>
    )
  }

  // Keyed, so that moving from a quote to its order confirmation starts the
  // second screen fresh instead of carrying an open form across.
  return <DocumentView key={documentId} document={document} />
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
 * What sets an estimate apart from a quote, said where it is written. The law
 * treats the two differently, and a business that sends an estimate should
 * know what it has promised and what it has not.
 */
function EstimateNotice() {
  return (
    <NoteBox>
      Ein Kostenvoranschlag ist eine Schätzung ohne Gewähr für ihre Richtigkeit. Zeichnet sich ab,
      dass er wesentlich überschritten wird, muss der Kunde das unverzüglich erfahren (§ 649 BGB).
      Wer einen festen Preis zusagen will, schreibt ein Angebot.
    </NoteBox>
  )
}

/** Why a fixed document stays as it is, in its box with the symbol of its state. */
function FixedNotice({
  status,
  children,
}: {
  readonly status: DocumentStatus
  readonly children: string
}) {
  return (
    <div role="status">
      <NoteBox
        icon={
          status === 'signed' ? statusIcons.sign : status === 'cancelled' ? statusIcons.ban : Lock
        }
      >
        {children}
      </NoteBox>
    </div>
  )
}

function DocumentView({ document }: { readonly document: RecordState }) {
  const documentId = String(document['id'])
  const client = useSync()
  const navigate = useNavigate()
  const followLook = useButtonLook()
  const customer = useRecord('customers', String(document['customerId']))
  const job = useRecord('jobs', maybeText(document, 'jobId') ?? undefined)
  const predecessor = useRecord(
    'documents',
    maybeText(document, 'predecessorDocumentId') ?? undefined,
  )
  const successors = useRelated('documents', 'predecessorDocumentId', documentId)
  const allDocuments = useRecords('documents')
  const sources = useRecords('document_sources')
  const signature = useSignature(documentId)
  const hasFields = useReportFieldLines(document).length > 0
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
  const [issueThen, setIssueThen] = useState<DocumentKind | undefined>(undefined)
  const [cancelling, setCancelling] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const figures = useDocumentFigures(document)
  const { people } = usePeople()

  const kind = documentKindOf(document)
  const status = documentStatusOf(document)
  const number = maybeText(document, 'number')
  // A final invoice is a Schlussrechnung only when it takes off progress
  // invoices (#132). Which ones only the server knows, from the frozen state
  // once the invoice is issued, and the figures ask it.
  const closing = closesProgressInvoices({ kind, deductions: figures.deductions })
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
  // A signed report goes on to its invoice through issuing, as the board has
  // "Rechnung erstellen" beside "Festschreiben": a successor is made out of an
  // issued document only.
  const nextAfterIssue =
    status === 'signed' && mayWrite && mayIssue && !continuing ? successorsOf(kind) : []
  // Cancelling is issuing the other way round, so it takes the same right: a
  // cancellation goes into the books like the invoice did.
  const cancellable = status === 'issued' && isCancellable(kind) && mayIssue
  const report = kind === 'time_and_material_report'

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

  const crumbs = job
    ? [
        { to: '/auftraege', label: 'Aufträge' },
        { to: `/auftraege/${String(job['id'])}`, label: text(job, 'designation') },
      ]
    : customer
      ? [
          { to: '/kunden', label: 'Kunden' },
          { to: `/kunden/${String(customer['id'])}`, label: text(customer, 'name') },
        ]
      : []
  const back = crumbs.at(-1)

  // One copper button a screen (#223): "Festschreiben" on a draft, the next
  // document where there is one, and on a signed report the invoice, with
  // "Festschreiben" beside it as the plain step.
  const actions = (
    <>
      <ButtonLink
        href={pdfAddress(documentId)}
        target="_blank"
        rel="noopener noreferrer"
        icon={Eye}
      >
        {status === 'draft' ? 'Entwurf als PDF' : 'PDF öffnen'}
      </ButtonLink>
      {issuable && mayIssue ? (
        <Button
          tone={status === 'draft' ? 'primary' : 'secondary'}
          icon={Lock}
          disabled={issuing}
          onClick={() => {
            setIssueThen(undefined)
            setIssuing(true)
          }}
        >
          Festschreiben
        </Button>
      ) : null}
      {nextAfterIssue.map((successor, index) => (
        <Button
          key={successor}
          tone={index === 0 ? 'primary' : 'secondary'}
          icon={File}
          disabled={issuing}
          onClick={() => {
            setIssueThen(successor)
            setIssuing(true)
          }}
        >
          {`${documentKindLabel[successor]} erstellen`}
        </Button>
      ))}
      {cancellable ? (
        <Button
          tone="danger"
          disabled={cancelling}
          onClick={() => {
            setCancelling(true)
          }}
        >
          Stornieren
        </Button>
      ) : null}
      {next.map((successor, index) => (
        <Button
          key={successor}
          tone={index === 0 && !cancellable ? 'primary' : 'secondary'}
          disabled={following}
          onClick={() => void follow(successor)}
        >
          {`${documentKindLabel[successor]} erstellen`}
        </Button>
      ))}
      {continuing && status === 'issued' && successorsOf(kind).length > 0 ? (
        <Link to={`/belege/${String(continuing['id'])}`} className={followLook}>
          {`Weiter bei ${documentName(continuing)}`}
        </Link>
      ) : null}
    </>
  )

  const deducted = figures.deductions.map((deduction) => {
    const found = allDocuments.find((other) => other['number'] === deduction.number)

    return found ? { number: deduction.number, document: found } : { number: deduction.number }
  })
  const predecessors = predecessor ? [predecessor] : collectedFrom
  const later = [...(collectedIn ? [...successors, collectedIn] : successors)].sort(byDate)
  const chainKnown = predecessors.length > 0 || later.length > 0 || deducted.length > 0
  const chain = (
    <ChainCard
      kind={kind}
      predecessors={predecessors}
      deducted={kind === 'cancellation_invoice' ? [] : deducted}
      successors={later}
    />
  )
  const mail =
    number !== null || status === 'signed' ? (
      <MailCard
        documentId={documentId}
        customerEmail={customer ? maybeText(customer, 'email') : null}
      />
    ) : null
  const eInvoice = isInvoice(kind) ? (
    <EInvoiceCard documentId={documentId} status={status} claimMatters={hangsOnClaim(document)} />
  ) : null

  let body: ReactNode

  if (report && status !== 'draft') {
    // A report as the board "Regiebericht, unterschrieben" lays it out: no
    // frame, what was done, the lines, and the fields beside the signature.
    const fields = <ReportFieldsCard document={document} />
    const intro = maybeText(document, 'introText')
    const closingText = maybeText(document, 'closingText')

    body = (
      <>
        {fixed ? <FixedNotice status={status}>{fixed}</FixedNotice> : null}
        {intro ? <WorkDoneCard>{intro}</WorkDoneCard> : null}
        <LinesPanel document={document} editable={false} figures={figures} />
        {closingText ? (
          <Panel title="Text unter den Positionen">
            <p className="text-[14px] leading-[1.5] whitespace-pre-line text-ink">{closingText}</p>
          </Panel>
        ) : null}
        <div
          className={clsx(
            'grid gap-3',
            hasFields && signature && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]',
          )}
        >
          {fields}
          {signature ? <SignatureCard signature={signature} /> : null}
        </div>
        {chainKnown ? chain : null}
        <InstructionsCard document={document} />
        {mail}
      </>
    )
  } else if (status === 'draft') {
    // Across the whole width, as the board "Angebot, Entwurf" has it: the form
    // of the head needs the room, and beside a column of 340 pixels its four
    // fields no longer fit at 1280. What the e-invoice still lacks is said
    // inside the frame, under the lines it is about.
    body = (
      <DraftFrame kind={heading}>
        {kind === 'cost_estimate' ? <EstimateNotice /> : null}
        <HeaderCard document={document} editable={editable} billedCents={figures.billedCents} />
        <ReportFieldsCard document={document} />
        <LinesPanel document={document} editable={editable} figures={figures} />
        <InstructionsCard document={document} />
        {eInvoice}
        {signature ? <SignatureCard signature={signature} /> : null}
        {chainKnown ? chain : null}
      </DraftFrame>
    )
  } else {
    body = (
      <RecordColumns
        sideWidth={340}
        main={
          <FixedFrame
            number={number ?? heading}
            sub={issuedLine(document, people)}
            chip={status === 'cancelled' ? 'STORNIERT' : 'FEST'}
          >
            {fixed ? <FixedNotice status={status}>{fixed}</FixedNotice> : null}
            {kind === 'cost_estimate' ? <EstimateNotice /> : null}
            <HeaderCard document={document} editable={false} billedCents={figures.billedCents} />
            <LinesPanel document={document} editable={false} figures={figures} />
            <InstructionsCard document={document} />
            {chain}
          </FixedFrame>
        }
        side={
          <>
            {eInvoice}
            {status === 'issued' && receivesPayments(kind) ? (
              <PaymentsCard documentId={documentId} kind={kind} />
            ) : null}
            {mail}
          </>
        }
      />
    )
  }

  return (
    <Screen>
      <PageHead
        crumbs={crumbs}
        {...(back ? { phoneBack: back } : {})}
        wideActions
        title={number ? `${heading} ${number}` : heading}
        badges={
          <span className="inline-flex flex-wrap items-center gap-x-[11px] gap-y-1">
            <DocumentState status={status} />
            <span className="numeric text-[13px] text-ink-faint">
              {date(document['documentDate'])}
              {customer ? (
                <>
                  {' · '}
                  <Link
                    to={`/kunden/${String(customer['id'])}`}
                    className="text-copper-text underline underline-offset-2"
                  >
                    {text(customer, 'name')}
                  </Link>
                </>
              ) : null}
            </span>
          </span>
        }
        actions={actions}
      />

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {issuing && issuable ? (
        <IssuePanel
          documentId={documentId}
          deductions={closing ? figures.deductions : []}
          {...(issueThen ? { then: issueThen } : {})}
          onDone={(said) => {
            setIssuing(false)
            setIssueThen(undefined)

            if (said) {
              setTrouble(said)
            }
          }}
        />
      ) : null}

      {cancelling && cancellable ? (
        <CancelPanel
          documentId={documentId}
          onDone={() => {
            setCancelling(false)
          }}
        />
      ) : null}

      {body}
    </Screen>
  )
}
