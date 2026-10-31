import type { LineUnit } from '@opengewerk/domain'
import { cardLink, Cell, Column, TablePanel } from '@opengewerk/platform-web'
import { amount, date } from '@opengewerk/platform-web/format'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { lineUnitShort } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'

/** A withdrawal of a job, as `GET /jobs/:id/withdrawals` names its fields. */
interface Withdrawal {
  readonly id: string
  readonly created_at: string
  readonly quantity_milli: number
  readonly article_id: string
  readonly number: string
  readonly designation: string
  readonly unit: LineUnit
  readonly store_name: string
  readonly document_id: string | null
  readonly document_number: string | null
}

function withdrawalsOf(jobId: string): Promise<Withdrawal[]> {
  return request<Withdrawal[]>(`/jobs/${encodeURIComponent(jobId)}/withdrawals`)
}

/**
 * "Warenausgang" (#298, board "Auftrag: Warenausgang"): what the job took out
 * of the stores, booked when a report was signed, from the store that report
 * named. Nothing where it took nothing, and nothing without a network: the
 * bookings of a store in a building are on no device.
 */
export function JobWithdrawals({ jobId }: { readonly jobId: string }) {
  const reads = useMay('job.read')
  const out = useQuery({
    queryKey: ['stock', 'job', jobId],
    queryFn: () => withdrawalsOf(jobId),
    enabled: reads,
  })
  // An answer this card does not understand is no list of withdrawals either.
  const rows = Array.isArray(out.data) ? out.data : []

  if (rows.length === 0) {
    return null
  }

  const quantity = (row: Withdrawal) => `${amount(row.quantity_milli)} ${lineUnitShort[row.unit]}`

  return (
    <TablePanel
      title="Warenausgang"
      caption="Was der Auftrag aus den Lagern genommen hat"
      note="Gebucht wird, wenn der Kunde einen Regiebericht unterschreibt, je Materialzeile einmal aus dem Lagerort, der im Bericht gewählt ist. Ein Bericht im Entwurf bucht nichts."
      cards={rows.map((row) => ({
        key: row.id,
        title: (
          <Link to={`/artikel/${row.article_id}`} className={cardLink}>
            {row.designation}
          </Link>
        ),
        sub: [date(row.created_at), row.store_name].join(' · '),
        right: <span className="numeric">{quantity(row)}</span>,
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[100px]">Gebucht</Column>
          <Column className="w-[80px]">Nummer</Column>
          <Column className="min-w-[200px]">Artikel</Column>
          <Column numeric className="w-[90px]">
            Menge
          </Column>
          <Column className="w-[200px]">Aus</Column>
          <Column className="w-[130px]">Bericht</Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Cell className="text-ink-muted">{date(row.created_at)}</Cell>
            <Cell>{row.number}</Cell>
            <Cell>
              <Link
                to={`/artikel/${row.article_id}`}
                className="text-ink no-underline hover:underline"
              >
                {row.designation}
              </Link>
            </Cell>
            <Cell numeric className="font-semibold">
              {quantity(row)}
            </Cell>
            <Cell className="text-ink-muted">{row.store_name}</Cell>
            <Cell>
              {row.document_id ? (
                <Link to={`/belege/${row.document_id}`}>
                  {row.document_number ?? 'Regiebericht'}
                </Link>
              ) : null}
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
