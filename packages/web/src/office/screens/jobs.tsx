import type { RecordState } from '@opengewerk/domain'
import { jobKinds, jobStatuses } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Card } from '../../components/index.js'
import { DataTable } from '../../app/data-table.js'
import type { ListColumns } from '../../app/data-table.js'
import {
  jobKindLabel,
  jobKindOf,
  jobStatusLabel,
  jobStatusOf,
  jobStatusTone,
} from '../../app/labels.js'
import { RecordForm, asTextOrNull } from '../../app/record-form.js'
import type { FormField } from '../../app/record-form.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'
import { AttachmentsSection } from './attachments.js'
import { JobDocuments } from './documents.js'
import { TasksSection } from './tasks.js'
import { JobTimeSection } from './time.js'

const kindOptions = jobKinds.map((kind) => ({ value: kind, label: jobKindLabel[kind] }))
const statusOptions = jobStatuses.map((status) => ({
  value: status,
  label: jobStatusLabel[status],
}))

const jobFields: readonly FormField[] = [
  { name: 'designation', label: 'Bezeichnung', required: true },
  { name: 'kind', label: 'Art', options: kindOptions, required: true },
  { name: 'status', label: 'Status', options: statusOptions, required: true },
  { name: 'description', label: 'Beschreibung' },
]

function asJob(values: Record<string, string>) {
  return {
    designation: values['designation']?.trim() ?? '',
    kind: values['kind'] ?? 'service',
    status: values['status'] ?? 'draft',
    description: asTextOrNull(values['description']),
  }
}

/**
 * A job in a list, with its state in a word and in a colour.
 *
 * Both, never only the colour: that is the one distinction a colour blind
 * reader does not get, and a row that differs in hue alone says nothing to
 * them. Shared by the customer, site and job screens, so the three cannot
 * drift into three different ways of saying "laufend".
 */
export function JobLine({ job }: { readonly job: RecordState }) {
  const status = jobStatusOf(job)

  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <Link
        to={`/auftraege/${String(job['id'])}`}
        className="text-copper-text font-semibold underline underline-offset-2"
      >
        {text(job, 'designation')}
      </Link>
      <span className={jobStatusTone[status]}>{jobStatusLabel[status]}</span>
      {maybeText(job, 'number') ? (
        <span className="numeric text-ink-muted">{text(job, 'number')}</span>
      ) : null}
    </li>
  )
}

const columns: ListColumns = [
  { id: 'designation', accessorFn: (row) => text(row, 'designation'), header: 'Bezeichnung' },
  {
    id: 'number',
    accessorFn: (row) => text(row, 'number'),
    header: 'Nummer',
    meta: { numeric: true },
  },
  { id: 'kind', accessorFn: (row) => jobKindLabel[jobKindOf(row)], header: 'Art' },
  { id: 'status', accessorFn: (row) => jobStatusLabel[jobStatusOf(row)], header: 'Status' },
]

export function JobList() {
  const jobs = useRecords('jobs')
  const customers = useRecords('customers')

  const withCustomer = useMemo(() => {
    const names = new Map(customers.map((entry) => [String(entry['id']), text(entry, 'name')]))

    // The customer's name is folded in here rather than looked up per cell,
    // because the search box searches what the table holds: without this, a
    // list of jobs could not be narrowed by the customer they are for, which
    // is the first thing anybody tries.
    return jobs.map((job) => ({ ...job, customerName: names.get(String(job['customerId'])) ?? '' }))
  }, [jobs, customers])

  return (
    <Page title="Aufträge" meta="Projekte und Serviceeinsätze.">
      <DataTable
        caption="Alle Aufträge des Betriebs"
        rows={withCustomer}
        columns={[
          ...columns,
          { id: 'customerName', accessorFn: (row) => text(row, 'customerName'), header: 'Kunde' },
        ]}
        searchLabel="Aufträge suchen"
        hrefFor={(row) => `/auftraege/${String(row['id'])}`}
        empty="Noch kein Auftrag. Ein Auftrag entsteht am Kunden oder am Objekt."
      />
    </Page>
  )
}

export function JobScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const client = useSync()
  const job = useRecord('jobs', jobId)
  const customer = useRecord('customers', job ? String(job['customerId']) : undefined)
  const site = useRecord('sites', job?.['siteId'] ? String(job['siteId']) : undefined)
  const installation = useRecord(
    'installations',
    job?.['installationId'] ? String(job['installationId']) : undefined,
  )
  const children = useRelated('jobs', 'parentJobId', jobId)
  const [editing, setEditing] = useState(false)

  if (!job || !jobId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>
          Diesen Auftrag gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.
        </Nothing>
      </Page>
    )
  }

  const status = jobStatusOf(job)

  return (
    <Page
      crumbs={
        <>
          <Crumb to="/auftraege">Aufträge</Crumb>
          {customer ? (
            <Crumb to={`/kunden/${String(customer['id'])}`}>{text(customer, 'name')}</Crumb>
          ) : null}
        </>
      }
      title={text(job, 'designation')}
      meta={
        <>
          {jobKindLabel[jobKindOf(job)]}
          <span aria-hidden="true"> · </span>
          <span className={jobStatusTone[status]}>{jobStatusLabel[status]}</span>
          {maybeText(job, 'number') ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="numeric">{text(job, 'number')}</span>
            </>
          ) : null}
        </>
      }
      actions={
        <Button
          tone="secondary"
          onClick={() => {
            setEditing((open) => !open)
          }}
        >
          {editing ? 'Bearbeiten beenden' : 'Bearbeiten'}
        </Button>
      }
    >
      {editing ? (
        <Card label="Auftrag bearbeiten">
          <RecordForm
            fields={jobFields}
            record={job}
            submitLabel="Speichern"
            onCancel={() => {
              setEditing(false)
            }}
            onSubmit={async (values) => {
              const saved = await client.update('jobs', jobId, asJob(values))

              if (saved.outcome === 'queued') {
                setEditing(false)
              }

              return saved
            }}
          />
        </Card>
      ) : (
        <Card label="Auftrag">
          <Facts>
            <Fact label="Kunde">
              {customer ? (
                <Link
                  to={`/kunden/${String(customer['id'])}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(customer, 'name')}
                </Link>
              ) : null}
            </Fact>
            <Fact label="Objekt">
              {site ? (
                <Link
                  to={`/objekte/${String(site['id'])}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(site, 'designation')}
                </Link>
              ) : null}
            </Fact>
            <Fact label="Anlage">
              {installation ? (
                <Link
                  to={`/anlagen/${String(installation['id'])}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(installation, 'designation')}
                </Link>
              ) : null}
            </Fact>
            <Fact label="Beschreibung">{maybeText(job, 'description')}</Fact>
          </Facts>
        </Card>
      )}

      <JobDocuments job={job} />

      <AttachmentsSection
        field="jobId"
        id={jobId}
        home={{
          customerId: String(job['customerId']),
          siteId: maybeText(job, 'siteId'),
          installationId: maybeText(job, 'installationId'),
          jobId,
        }}
        empty="Zu diesem Auftrag gibt es noch keine Datei. Fotos von der Baustelle landen hier."
      />

      <JobTimeSection jobId={jobId} />

      <TasksSection
        field="jobId"
        id={jobId}
        links={{
          customerId: String(job['customerId']),
          siteId: maybeText(job, 'siteId'),
          jobId,
        }}
        empty="Zu diesem Auftrag ist keine Aufgabe offen."
      />

      {children.length > 0 ? (
        <Section title="Teilaufträge">
          <ul className="flex flex-col gap-2">
            {children.map((child) => (
              <JobLine key={String(child['id'])} job={child} />
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  )
}

/**
 * The form that creates a job, used from the customer and from the site.
 *
 * It takes the customer and the site from where it was opened rather than
 * asking for them again. A job always belongs to a customer and usually to one
 * of that customer's buildings, and a dropdown of every customer in the system
 * is a way of picking the wrong one.
 */
export function NewJobForm({
  customerId,
  siteId,
  installationId,
  onDone,
}: {
  readonly customerId: string
  readonly siteId?: string
  readonly installationId?: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()

  return (
    <RecordForm
      fields={jobFields}
      submitLabel="Auftrag anlegen"
      onCancel={onDone}
      onSubmit={async (values) => {
        const made = await client.create('jobs', {
          ...asJob(values),
          customerId,
          siteId: siteId ?? null,
          installationId: installationId ?? null,
          parentJobId: null,
        })

        if (made.outcome === 'queued') {
          onDone()
          await navigate({ to: `/auftraege/${made.id}` })
        }

        return made
      }}
    />
  )
}
