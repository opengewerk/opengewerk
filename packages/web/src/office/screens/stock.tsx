import type { LineUnit } from '@opengewerk/domain'
import {
  type StockArticleChoice,
  type StockScreenProps,
  StoreScreen,
  StoresScreen,
} from '@opengewerk/platform-web/office'
import type { MovementRow } from '@opengewerk/platform-web/session'
import { maybeText, useRecord } from '@opengewerk/platform-web/sync'
import { Link, useParams } from '@tanstack/react-router'

import { lineUnitShort } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { usePeople } from '../../app/tasks.js'
import { articlePage } from '../../session/articles.js'

/**
 * The stores of the business (#298) on the screens of the foundation, with
 * the words of this application's concept (Feature-Gliederung 4.5): a booking
 * is a "Zugang", an "Abgang", an "Umlagerung" or a "Zählung", and a store may
 * be a service vehicle with its number plate. Boards "Lager" and "Lagerort"
 * of the canvas, version 84.
 */

const stockScreen: Omit<StockScreenProps, 'mayWrite'> = {
  words: {
    kinds: {
      receipt: 'Zugang',
      withdrawal: 'Abgang',
      transfer_out: 'Umlagerung',
      transfer_in: 'Umlagerung',
      count: 'Zählung',
      write_off: 'Ausbuchung',
    },
    unit: (unit) => lineUnitShort[unit as LineUnit] ?? unit,
  },
  paths: {
    stores: '/lager',
    store: (storeId) => `/lager/${storeId}`,
    article: (articleId) => `/artikel/${articleId}`,
  },
  vehicles: true,
}

/** The articles of the catalogue for a receipt or a place, the first ones the search finds. */
async function findArticles(text: string): Promise<readonly StockArticleChoice[]> {
  const page = await articlePage({
    search: text,
    offset: 0,
    limit: 8,
    sort: 'number',
    frequent: false,
    group: '',
  })

  return page.rows.map((row) => ({
    id: row.id,
    number: row.number,
    designation: row.designation,
    unit: row.unit,
  }))
}

/**
 * What a withdrawal was for: the report whose signature booked it and its
 * job, as the office holds both. A booking of the office at a job names the
 * job alone.
 */
function Withdrawal({ row }: { readonly row: MovementRow }) {
  const line = useRecord(
    'document_lines',
    typeof row['document_line_id'] === 'string' ? row['document_line_id'] : undefined,
  )
  const report = useRecord(
    'documents',
    line ? (maybeText(line, 'documentId') ?? undefined) : undefined,
  )
  const job = useRecord('jobs', typeof row['job_id'] === 'string' ? row['job_id'] : undefined)
  // A report signed on site has its number only once the office issues it.
  const reportName = report
    ? ['Regiebericht', maybeText(report, 'number')].filter(Boolean).join(' ')
    : null
  const jobName = job ? (maybeText(job, 'number') ?? maybeText(job, 'designation')) : null

  return (
    <>
      {reportName && report ? (
        <Link to={`/belege/${String(report['id'])}`}>{reportName}</Link>
      ) : null}
      {reportName && jobName ? ', ' : null}
      {jobName && job ? (
        <Link to={`/auftraege/${String(job['id'])}`}>{`Auftrag ${jobName}`}</Link>
      ) : null}
    </>
  )
}

export function StockList() {
  const mayWrite = useMay('stock.write')

  return <StoresScreen {...stockScreen} mayWrite={mayWrite} />
}

export function StockStoreScreen() {
  const { storeId } = useParams({ strict: false }) as { storeId?: string }
  const { people } = usePeople()
  const mayWrite = useMay('stock.write')

  return (
    <StoreScreen
      {...stockScreen}
      mayWrite={mayWrite}
      storeId={storeId ?? ''}
      findArticles={findArticles}
      why={(row) => (row['job_id'] ? <Withdrawal row={row} /> : null)}
      who={(userId) => people.find((person) => person.userId === userId)?.name ?? ''}
    />
  )
}
