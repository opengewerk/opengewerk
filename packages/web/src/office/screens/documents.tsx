import type { DocumentKind, MissingDetail, RecordState } from '@opengewerk/domain'
import { successorsOf, whyFixed } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Card, DocumentState } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { documentKindLabel, documentKindOf, documentStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import {
  createDocument,
  issueDocument,
  makeSuccessor,
  missingFrom,
  pdfAddress,
} from '../../session/documents.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated, useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'
import { HeaderSection } from './document-head.js'
import { LinesSection } from './document-lines.js'

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
  const sorted = useMemo(() => [...documents].sort(byDate), [documents])
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

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
 * The screen of one document: a quote, an estimate, an order confirmation.
 *
 * Everything on it reads from the sync client, and everything written while
 * it is a draft goes into the outbox: the head, the texts, every line. What
 * goes straight to the server is what only the server can do, which is
 * handing out a number, making a successor in one step and printing.
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
  const mayWrite = useMay('document.write')
  const mayIssue = useMay('document.issue')
  const [issuing, setIssuing] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)

  const kind = documentKindOf(document)
  const status = documentStatusOf(document)
  const number = maybeText(document, 'number')
  const fixed = whyFixed({ kind, status })
  const editable = fixed === null && mayWrite
  const next = status === 'issued' && mayWrite ? successorsOf(kind) : []

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
      title={number ? `${documentKindLabel[kind]} ${number}` : documentKindLabel[kind]}
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
          {status === 'draft' && mayIssue ? (
            <Button
              onClick={() => {
                setIssuing(true)
              }}
              disabled={issuing}
            >
              Festschreiben
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
        <Card label="Festgeschrieben" tone="sunken">
          <p role="status" className="text-body text-ink">
            {fixed}
          </p>
        </Card>
      ) : null}

      {issuing && status === 'draft' ? (
        <IssueCard
          documentId={documentId}
          onDone={() => {
            setIssuing(false)
          }}
        />
      ) : null}

      <HeaderSection document={document} editable={editable} />
      <LinesSection document={document} editable={editable} />
      <ChainSection predecessor={predecessor} successors={successors} />
    </Page>
  )
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
 */
function IssueCard({
  documentId,
  onDone,
}: {
  readonly documentId: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [missing, setMissing] = useState<readonly MissingDetail[]>([])

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

      await issueDocument(documentId)
      await client.synchronise()
      onDone()
    } catch (error) {
      const lacking = missingFrom(error)

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
        {trouble ? (
          <div role="alert" className="flex flex-col gap-1">
            <p className="text-body font-semibold text-conflict">{trouble}</p>
            {missing.length > 0 ? (
              <ul className="list-disc pl-6 text-body text-ink">
                {missing.map((entry) => (
                  <li key={`${entry.detail}-${String(entry.position ?? '')}`}>{entry.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button tone="primary" disabled={working} onClick={() => void issue()}>
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
 * Where the document stands in the chain of section 1.4: what it was made
 * from, and what has been made from it.
 */
function ChainSection({
  predecessor,
  successors,
}: {
  readonly predecessor: RecordState | null
  readonly successors: readonly RecordState[]
}) {
  if (!predecessor && successors.length === 0) {
    return null
  }

  return (
    <Section title="Belegkette">
      <Facts>
        {predecessor ? (
          <Fact label="Entstanden aus">
            <ul>
              <DocumentEntry document={predecessor} />
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
