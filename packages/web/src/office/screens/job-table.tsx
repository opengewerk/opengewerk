import type { RecordState } from '@opengewerk/domain'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Cell, Column, Panel, TablePanel } from '../../components/index.js'
import { jobKindLabel, jobKindOf } from '../../app/labels.js'
import { text } from '../../sync/fields.js'
import { useRecords } from '../../sync/provider.js'
import { JobState } from './jobs.js'

/**
 * The jobs of a customer, a site or an installation, as the table cards of
 * their boards draw them (#219): the name, then the columns the record asks
 * for, each at the width of its board.
 */
export type JobColumnKey = 'number' | 'kind' | 'status' | 'site'

export interface JobColumn {
  readonly key: JobColumnKey
  /** A width class, `w-[110px]`. */
  readonly width: string
}

const headers: Readonly<Record<JobColumnKey, string>> = {
  number: 'Nummer',
  kind: 'Art',
  status: 'Status',
  site: 'Objekt',
}

export function JobsPanel({
  caption,
  jobs,
  columns,
  action,
  lead,
  empty,
}: {
  readonly caption: string
  readonly jobs: readonly RecordState[]
  readonly columns: readonly JobColumn[]
  readonly action?: ReactNode
  /** A form for a new job, over the table. */
  readonly lead?: ReactNode
  /** The sentence while there is none. */
  readonly empty: string
}) {
  const sites = useRecords('sites')
  const navigate = useNavigate()

  if (jobs.length === 0) {
    return (
      <Panel title="Aufträge" action={action}>
        {lead ?? <p className="text-[13px] leading-[1.4] text-ink-muted">{empty}</p>}
      </Panel>
    )
  }

  // The newest first; a job that has no number yet is a draft of today.
  const sorted = [...jobs].sort((left, right) =>
    String(right['id']).localeCompare(String(left['id'])),
  )

  const value = (job: RecordState, key: JobColumnKey): ReactNode => {
    switch (key) {
      case 'number':
        return text(job, 'number')
      case 'kind':
        return jobKindLabel[jobKindOf(job)]
      case 'status':
        return <JobState job={job} />
      case 'site':
        return text(
          sites.find((site) => String(site['id']) === text(job, 'siteId')) ?? null,
          'designation',
        )
    }
  }

  return (
    <TablePanel title="Aufträge" caption={caption} action={action} lead={lead}>
      <thead>
        <tr>
          <Column>Bezeichnung</Column>
          {columns.map((column) => (
            <Column key={column.key} className={column.width}>
              {headers[column.key]}
            </Column>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((job) => {
          const id = String(job['id'])

          return (
            <tr
              key={id}
              className="cursor-pointer hover:bg-surface-sunken"
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('a, button')) {
                  void navigate({ to: `/auftraege/${id}` })
                }
              }}
            >
              <Cell>
                <Link to={`/auftraege/${id}`} className="text-inherit no-underline hover:underline">
                  {text(job, 'designation')}
                </Link>
              </Cell>
              {columns.map((column) => (
                <Cell key={column.key} className={column.key === 'number' ? 'numeric' : undefined}>
                  {value(job, column.key)}
                </Cell>
              ))}
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}
