import type { DocumentKind, DocumentStatus, EInvoiceGap, RecordState } from '@opengewerk/domain'
import { invoiceFormats } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Download, Mail } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button, ButtonLink, Field, Panel } from '../../components/index.js'
import { moment } from '../../app/format.js'
import { documentKindLabel, documentKindOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { useReportFieldLines } from '../../app/report-fields.js'
import { SignaturePicture } from '../../app/signature.js'
import {
  type DocumentMail,
  eInvoiceOf,
  mailsOf,
  sendDocument,
  xrechnungAddress,
  zugferdAddress,
} from '../../session/documents.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRelated } from '../../sync/provider.js'
import type { Fact } from '../kit.js'
import { FactList } from '../kit.js'
import { reasonOf } from './document-steps.js'

/** A document as a sentence names it: its kind and number, or that it is still a draft. */
export function documentName(document: RecordState): string {
  const number = maybeText(document, 'number')
  const label = documentKindLabel[documentKindOf(document)]

  return number ? `${label} ${number}` : `${label}, Entwurf`
}

/** A sentence of a card, at the size the boards set them. */
function Line({
  tone = 'ink',
  children,
}: {
  readonly tone?: 'ink' | 'muted' | 'faint'
  readonly children: ReactNode
}) {
  const colour =
    tone === 'ink' ? 'text-ink' : tone === 'muted' ? 'text-ink-muted' : 'text-ink-faint'

  return (
    <p className={`${tone === 'faint' ? 'text-[12px]' : 'text-[13px]'} leading-[1.45] ${colour}`}>
      {children}
    </p>
  )
}

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
    <div className="flex flex-col gap-1 text-[13px] leading-[1.45]">
      <p className="font-semibold text-ink">{heading}</p>
      <ul className="list-disc pl-5 text-ink">
        {gaps.map((gap) => (
          <li key={gap.detail}>{gap.message}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * "E-Rechnung", in the side column of an invoice: how it goes out, and why.
 * The customer decides it, not a switch on the document, so the card says
 * what the master data made of it: an e-invoice for a business in Germany, a
 * PDF for everybody else, each with the paragraph.
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
export function EInvoiceCard({
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
      <Panel title="Versand als PDF">
        <Line>{reason}</Line>
      </Panel>
    )
  }

  // The XRechnung asks everything the standard asks and more. What the
  // standard lacks stops both forms, the rest only the XRechnung.
  const both = zugferd.missing
  const onlyXrechnung = xrechnung.missing.filter(
    (gap) => !both.some((other) => other.detail === gap.detail),
  )

  return (
    <Panel title="E-Rechnung">
      <div className="flex flex-col gap-[9px]">
        <Line>{reason}</Line>
        {duty ? <Line tone="muted">{duty.reason}</Line> : null}
        {duty && claimMatters && readsSettings ? (
          <Line>
            <Link
              to="/einstellungen/steuern"
              className="text-copper-text underline underline-offset-2"
            >
              Erklärung zum Übergang unter „Steuern“
            </Link>
          </Line>
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
            <div className="flex flex-col gap-1.5">
              <ButtonLink href={zugferdAddress(documentId)} download icon={Download} wide>
                ZUGFeRD-PDF herunterladen
              </ButtonLink>
              {onlyXrechnung.length === 0 ? (
                <ButtonLink href={xrechnungAddress(documentId)} download icon={Download} wide>
                  XRechnung herunterladen
                </ButtonLink>
              ) : null}
            </div>
            <Line tone="faint">
              Das ZUGFeRD-PDF ist die Rechnung als PDF mit den Daten darin, für Unternehmen. Die
              XRechnung ist die Rechnung als reines XML, wie Behörden sie verlangen.
            </Line>
          </>
        ) : (
          <Line tone="muted">Die E-Rechnung gibt es, sobald die Rechnung festgeschrieben ist.</Line>
        )}
      </div>
    </Panel>
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
 * "Per E-Mail": sending an issued document to its customer, and what became
 * of it.
 *
 * The button asks the server and the answer comes at once: the message waits
 * in the outbox and goes out a moment later, or once the mail server answers
 * again. While one waits the list asks every ten seconds, so that "versendet"
 * shows without a reload. The address is the customer's unless somebody types
 * another, for this one message; which file goes along the server decides,
 * the same way the e-invoice card says.
 */
export function MailCard({
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
    <Panel title="Per E-Mail">
      <div className="flex flex-col gap-2.5">
        {list.length > 0 ? (
          <ul className="flex flex-col gap-1 text-[13px] leading-[1.45] text-ink">
            {list.map((mail) => (
              <li key={mail.id}>{mailState(mail)}</li>
            ))}
          </ul>
        ) : (
          <Line tone="muted">Dieser Beleg wurde noch nicht per E-Mail verschickt.</Line>
        )}

        {maySend ? (
          <form
            className="flex flex-col gap-2.5"
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
            <Button
              type="submit"
              icon={Mail}
              wide
              disabled={send.isPending || address.trim() === ''}
            >
              {send.isPending ? 'Einen Moment' : 'Per E-Mail senden'}
            </Button>
          </form>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * "Was gemacht wurde", the text of a report as it was written on site above
 * its lines, where the board "Regiebericht, unterschrieben" puts it.
 */
export function WorkDoneCard({ children }: { readonly children: string }) {
  return (
    <Panel title="Was gemacht wurde">
      <p className="text-[14px] leading-[1.5] whitespace-pre-line text-ink">{children}</p>
    </Panel>
  )
}

/**
 * "Angaben": the fields the business gives its reports (#78), as they were
 * filled in on site and as the customer signed them. Read here and not
 * changed: they are part of the page under the signature.
 */
export function ReportFieldsCard({ document }: { readonly document: RecordState }) {
  const lines = useReportFieldLines(document)

  return lines.length === 0 ? null : (
    <Panel title="Angaben">
      <FactList
        keyWidth={120}
        facts={lines.map((line) => ({
          label: line.label,
          value: <span className="whitespace-pre-line">{line.text}</span>,
        }))}
      />
    </Panel>
  )
}

/**
 * "Unterschrift": the customer's signature as it was given on site, in its
 * box, and beside it the name typed with it, the moment and what the device
 * said about itself. The last two are what section 4.10 asks a simple
 * signature to carry.
 */
export function SignatureCard({ signature }: { readonly signature: RecordState }) {
  return (
    <Panel title="Unterschrift">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-[110px] w-[260px] max-w-full shrink-0 items-center justify-center rounded-control border border-line bg-input p-2">
          <SignaturePicture
            path={text(signature, 'path')}
            label={`Unterschrift von ${text(signature, 'signerName')}`}
            className="block h-full w-full"
          />
        </div>
        <div className="min-w-0 grow basis-[220px]">
          <FactList
            keyWidth={140}
            facts={[
              { label: 'Unterschrieben von', value: text(signature, 'signerName') },
              {
                label: 'Unterschrieben am',
                value: `${moment(maybeText(signature, 'signedAt'))} Uhr`,
              },
              { label: 'Gerät', value: maybeText(signature, 'deviceInfo') },
            ]}
          />
        </div>
      </div>
    </Panel>
  )
}

/** The signature of a report, the one it was signed with, if it has one. */
export function useSignature(documentId: string): RecordState | undefined {
  const [signature] = useRelated('document_signatures', 'documentId', documentId)

  return signature
}

/** Links to documents, one under the other, each by its name. */
function DocumentLinks({ documents }: { readonly documents: readonly RecordState[] }) {
  return (
    <span className="flex flex-col gap-[3px]">
      {documents.map((document) => (
        <Link
          key={String(document['id'])}
          to={`/belege/${String(document['id'])}`}
          className="text-copper-text underline underline-offset-2"
        >
          {documentName(document)}
        </Link>
      ))}
    </span>
  )
}

/**
 * "Belegkette": where the document stands in the chain of section 1.4, as the
 * board "Schlussrechnung, festgeschrieben" lists it: what it was made from,
 * the progress invoices it takes off, and what has been made from it. A
 * cancellation was not made from its invoice so much as against it, and says
 * so.
 */
export function ChainCard({
  kind,
  predecessors,
  deducted,
  successors,
}: {
  readonly kind: DocumentKind
  /** One, or the reports of a collective invoice (#135), in its order. */
  readonly predecessors: readonly RecordState[]
  /** The progress invoices it takes off, by number, and the record where this device has it. */
  readonly deducted: readonly { readonly number: string; readonly document?: RecordState }[]
  /** Oldest first. */
  readonly successors: readonly RecordState[]
}) {
  const facts: Fact[] = [
    ...(predecessors.length > 0
      ? [
          {
            label: kind === 'cancellation_invoice' ? 'Storno zu' : 'Entstanden aus',
            value: <DocumentLinks documents={predecessors} />,
          },
        ]
      : []),
    ...(deducted.length > 0
      ? [
          {
            label: 'Abschläge',
            value: (
              <span className="flex flex-col gap-[3px]">
                {deducted.map((entry) =>
                  entry.document ? (
                    <Link
                      key={entry.number}
                      to={`/belege/${String(entry.document['id'])}`}
                      className="text-copper-text underline underline-offset-2"
                    >
                      {`Abschlagsrechnung ${entry.number}`}
                    </Link>
                  ) : (
                    <span key={entry.number}>{`Abschlagsrechnung ${entry.number}`}</span>
                  ),
                )}
              </span>
            ),
          },
        ]
      : []),
    {
      label: 'Folgebelege',
      value:
        successors.length > 0 ? (
          <DocumentLinks documents={successors} />
        ) : (
          <span className="text-ink-faint">keine</span>
        ),
    },
  ]

  return (
    <Panel title="Belegkette">
      <FactList facts={facts} keyWidth={110} />
    </Panel>
  )
}
