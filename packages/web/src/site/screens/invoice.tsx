import { type RecordState, RuleError, shippedRules, totalsFor } from '@opengewerk/domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { amount, date, euros, percent } from '@opengewerk/platform-web/format'
import { SiteFacts, SiteScreen, SiteText, SiteTrouble } from '@opengewerk/platform-web/site'
import {
  count,
  maybeText,
  RequestRefused,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Euro } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DocumentState } from '../../app/document-state.js'
import {
  documentKindOf,
  documentStatusOf,
  lineUnitLabel,
  taxTreatmentOf,
  vatRateOf,
} from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { makeSuccessor } from '../../session/documents.js'
import { SiteHeader } from '../header.js'

/**
 * The invoice made on site out of a signed report (#292, Feature-Gliederung
 * 4.1): the technician makes the draft, with the prices of its own day, and
 * the office issues and sends it. Boards "Regiebericht unterschrieben,
 * Rechnung anlegen" and "Rechnung vor Ort, Entwurf" of the canvas, version
 * 124.
 */

/** The invoice that continues a report, once there is one on this device. */
function useInvoiceOf(reportId: string): RecordState | undefined {
  const documents = useRecords('documents')

  return documents.find(
    (document) =>
      document['predecessorDocumentId'] === reportId &&
      !document['deletedAt'] &&
      documentKindOf(document) === 'final_invoice' &&
      documentStatusOf(document) !== 'cancelled',
  )
}

function invoiceAddress(jobId: string, documentId: string): string {
  return `/auftraege/${jobId}/rechnungen/${documentId}`
}

/** Under a signed report: making the draft of its invoice, or the way to the one made. */
export function InvoiceOnSite({ report }: { readonly report: RecordState }) {
  const reportId = String(report['id'])
  const jobId = maybeText(report, 'jobId') ?? ''
  const client = useSync()
  const navigate = useNavigate()
  const { online } = useSyncStatus()
  const writes = useMay('document.write')
  const invoice = useInvoiceOf(reportId)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (documentKindOf(report) !== 'time_and_material_report' || jobId === '') {
    return null
  }

  if (invoice) {
    return (
      <Panel title="Rechnung">
        <div className="flex flex-col gap-2">
          <Link
            to={invoiceAddress(jobId, String(invoice['id']))}
            className="text-[17px] font-semibold text-copper-text underline underline-offset-2"
          >
            {maybeText(invoice, 'number')
              ? `Rechnung ${text(invoice, 'number')}`
              : 'Entwurf der Rechnung'}
          </Link>
          <SiteText muted size={15}>
            Festgeschrieben und verschickt wird sie im Büro.
          </SiteText>
        </div>
      </Panel>
    )
  }

  if (!writes || client.isPending('documents', reportId)) {
    return null
  }

  async function make() {
    setWorking(true)
    setTrouble(null)

    try {
      // The signature has to be on the server first: the invoice is made out
      // of the report it holds.
      await client.synchronise()

      const made = await makeSuccessor(reportId, 'final_invoice')

      // And back again, so that the draft is on this device to look at.
      await client.synchronise()
      await navigate({ to: invoiceAddress(jobId, String(made['id'])) })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Das ging nicht. Die Rechnung ist nicht angelegt.',
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title="Rechnung">
      <div className="flex flex-col gap-2.5">
        <SiteText size={16}>
          Aus dem unterschriebenen Bericht legen Sie hier den Entwurf der Rechnung an, mit den
          Preisen von heute. Festgeschrieben und verschickt wird sie im Büro.
        </SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
        <Button
          tone="primary"
          wide
          height={56}
          icon={Euro}
          disabled={!online || working}
          onClick={() => {
            void make()
          }}
        >
          Rechnung anlegen
        </Button>
        {!online ? (
          <SiteText muted size={15}>
            Dafür braucht es Netz.
          </SiteText>
        ) : null}
      </div>
    </Panel>
  )
}

export function SiteInvoiceScreen() {
  const { documentId } = useParams({ strict: false }) as { documentId?: string }
  const invoice = useRecord('documents', documentId)
  const customer = useRecord('customers', invoice ? String(invoice['customerId']) : undefined)
  const report = useRecord('documents', maybeText(invoice, 'predecessorDocumentId') ?? undefined)
  const records = useRelated('document_lines', 'documentId', documentId ?? '')
  const lines = useMemo(
    () =>
      records
        .filter((line) => !line['deletedAt'])
        .sort((left, right) => count(left, 'position') - count(right, 'position')),
    [records],
  )

  if (!invoice || !documentId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diese Rechnung hat dieses Gerät nicht. Mit Verbindung holt der Abgleich sie.
        </SiteText>
      </SiteScreen>
    )
  }

  let totals: ReturnType<typeof totalsFor> | string

  try {
    totals = totalsFor(
      shippedRules,
      lines.map((line) => ({
        netCents: count(line, 'netCents'),
        vatRate: vatRateOf(line),
        kind: line['kind'] === 'title' ? 'title' : 'item',
      })),
      { documentDate: text(invoice, 'documentDate'), taxTreatment: taxTreatmentOf(invoice) },
    )
  } catch (error) {
    if (!(error instanceof RuleError)) {
      throw error
    }

    totals = error.message
  }

  const status = documentStatusOf(invoice)

  return (
    <SiteScreen>
      <SiteHeader
        title="Rechnung"
        sub={
          report ? `Entwurf aus dem Regiebericht vom ${date(report['documentDate'])}` : undefined
        }
      />
      <div>
        <DocumentState status={status} number={maybeText(invoice, 'number')} />
      </div>

      <Panel title="Positionen">
        <div className="flex flex-col gap-2.5">
          <ul className="flex flex-col">
            {lines
              .filter((line) => line['kind'] !== 'title')
              .map((line) => {
                const price = line['unitPriceCents']

                return (
                  <li key={String(line['id'])} className="border-b border-row py-2.5">
                    <div className="flex gap-2.5 text-[17px]">
                      <span className="flex-1 font-semibold [overflow-wrap:anywhere]">
                        {text(line, 'designation')}
                      </span>
                      <b className="numeric">{euros(count(line, 'netCents'))}</b>
                    </div>
                    <p className="numeric mt-0.5 text-[15px] text-ink-muted">
                      {`${amount(count(line, 'quantityMilli'))} ${lineUnitLabel[line['unit'] as keyof typeof lineUnitLabel] ?? ''}`}
                      {typeof price === 'number' ? ` zu ${euros(price)}` : ', ohne Preis'}
                    </p>
                  </li>
                )
              })}
          </ul>
          {typeof totals === 'string' ? (
            <SiteTrouble>{totals}</SiteTrouble>
          ) : (
            <SiteFacts
              facts={[
                { label: 'Netto', value: euros(totals.netCents) },
                ...totals.byRate.map((rate) => ({
                  label: `Umsatzsteuer ${percent(rate.basisPoints)}`,
                  value: euros(rate.taxCents),
                })),
                { label: 'Gesamt', value: <b>{euros(totals.grossCents)}</b> },
              ]}
            />
          )}
        </div>
      </Panel>

      <Panel title="Rechnung an">
        <SiteFacts
          facts={[
            { label: 'Kunde', value: customer ? text(customer, 'name') : 'nicht angegeben' },
            ...(maybeText(invoice, 'serviceFrom')
              ? [{ label: 'Leistungsdatum', value: date(invoice['serviceFrom']) }]
              : []),
          ]}
        />
      </Panel>

      <p className="rounded-[6px] border border-line bg-surface-sunken px-3.5 py-3 text-[16px] leading-[1.45]">
        {status === 'draft'
          ? 'Ein Entwurf. Das Büro prüft ihn, schreibt die Rechnung fest und schickt sie dem Kunden; bis dahin hat sie keine Nummer.'
          : 'Die Rechnung ist festgeschrieben und ändert sich nicht mehr.'}
      </p>
    </SiteScreen>
  )
}
