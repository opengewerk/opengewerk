import type { RecordState } from '@opengewerk/domain'
import { isInvoice } from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { File } from 'lucide-react'
import { useMemo } from 'react'

import { centsAsInput, date } from '../../app/format.js'
import { documentKindLabel, documentKindOf, documentStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { openAmounts } from '../../session/documents.js'
import { text } from '../../sync/fields.js'
import { useRecords } from '../../sync/provider.js'
import { lastChanged, ListCard, ListScreen } from '../list.js'
import type { ListColumn, ListFilter } from '../list.js'
import { useGrossByDocument } from './document-gross.js'
import { DocumentMarker } from './document-marker.js'

/**
 * What is still open on the issued invoices, from the server: payments do not
 * travel to a device (#189), so without a connection the chip "Offen" has
 * nothing to go by and is not offered.
 */
function useOpen(): ReadonlyMap<string, number> | null {
  const readsPayments = useMay('payment.read')
  const answer = useQuery({
    queryKey: ['payments', 'open'],
    queryFn: openAmounts,
    enabled: readsPayments,
    staleTime: 60_000,
    retry: false,
  })

  return useMemo(
    () =>
      Array.isArray(answer.data)
        ? new Map(answer.data.map((row) => [row.documentId, row.billedCents - row.receivedCents]))
        : null,
    [answer.data],
  )
}

/** The kinds a business makes an offer in, for the chip "Angebote". */
const offers = new Set(['quote', 'cost_estimate'])

/**
 * All documents of the business, `belege_liste()` of the canvas (#219): until
 * now a document was only found through its job or its customer.
 */
export function DocumentList() {
  const documents = useRecords('documents')
  const customers = useRecords('customers')
  const gross = useGrossByDocument()
  const open = useOpen()

  const names = useMemo(
    () => new Map(customers.map((customer) => [String(customer['id']), text(customer, 'name')])),
    [customers],
  )
  const customerName = (row: RecordState) => names.get(text(row, 'customerId')) ?? ''
  const amount = (row: RecordState) => gross.get(String(row['id'])) ?? null

  const columns: readonly ListColumn[] = [
    {
      id: 'number',
      header: 'Nummer',
      value: (row) => text(row, 'number'),
      // A draft has no number yet, and that is worth seeing at a glance.
      cell: (row) =>
        text(row, 'number') || <span className="font-semibold text-waiting">ohne Nummer</span>,
      width: 'w-[116px]',
    },
    {
      id: 'kind',
      header: 'Art',
      value: (row) => documentKindLabel[documentKindOf(row)],
      width: 'w-[140px]',
    },
    { id: 'subject', header: 'Betreff', value: (row) => text(row, 'subject') },
    { id: 'customer', header: 'Kunde', value: customerName, width: 'w-[190px]', wideOnly: true },
    {
      id: 'date',
      header: 'Datum',
      value: (row) => text(row, 'documentDate'),
      cell: (row) => date(row['documentDate']),
      width: 'w-[92px]',
      wideOnly: true,
    },
    {
      id: 'status',
      header: 'Status',
      value: (row) => documentStatusOf(row),
      cell: (row) => <DocumentMarker document={row} />,
      width: 'w-[142px]',
    },
    {
      id: 'gross',
      header: 'Brutto',
      value: (row) => amount(row) ?? 0,
      cell: (row) => {
        const cents = amount(row)

        return cents === null ? '' : centsAsInput(cents)
      },
      align: 'right',
      width: 'w-[92px]',
    },
  ]

  const filters: ListFilter[] = [
    { id: 'drafts', label: 'Entwürfe', test: (row) => documentStatusOf(row) === 'draft' },
    { id: 'offers', label: 'Angebote', test: (row) => offers.has(documentKindOf(row)) },
    { id: 'invoices', label: 'Rechnungen', test: (row) => isInvoice(documentKindOf(row)) },
    ...(open
      ? [
          {
            id: 'open',
            label: 'Offen',
            test: (row: RecordState) => (open.get(String(row['id'])) ?? 0) > 0,
          },
        ]
      : []),
  ]

  return (
    <ListScreen
      title="Belege"
      caption="Alle Belege des Betriebs"
      rows={documents}
      columns={columns}
      hrefFor={(row) => `/belege/${String(row['id'])}`}
      searchLabel="Belege durchsuchen"
      searchPlaceholder="Nummer, Betreff, Kunde …"
      filters={filters}
      sorts={[
        lastChanged,
        {
          id: 'date',
          label: 'Datum',
          compare: (left, right) =>
            text(right, 'documentDate').localeCompare(text(left, 'documentDate')) ||
            String(right['id']).localeCompare(String(left['id'])),
        },
      ]}
      card={(row) => {
        const cents = amount(row)

        return (
          <ListCard
            to={`/belege/${String(row['id'])}`}
            title={documentKindLabel[documentKindOf(row)]}
            sub={[text(row, 'number'), customerName(row), date(row['documentDate'])]
              .filter(Boolean)
              .join(' · ')}
            right={
              <>
                <DocumentMarker document={row} />
                {cents === null ? null : (
                  <span className="numeric text-[13px] text-ink-faint">{centsAsInput(cents)}</span>
                )}
              </>
            }
          />
        )
      }}
      note={
        open
          ? 'Ein Beleg entsteht am Auftrag. Offen heißt: festgeschrieben und noch nicht voll bezahlt.'
          : 'Ein Beleg entsteht am Auftrag.'
      }
      empty={{
        icon: File,
        title: 'Noch kein Beleg angelegt',
        text: 'Ein Beleg entsteht am Auftrag: Angebot und Kostenvoranschlag in seinem Kopf, alles Weitere aus ihnen.',
      }}
    />
  )
}
