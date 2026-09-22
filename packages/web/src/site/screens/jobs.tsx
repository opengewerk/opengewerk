import type { RecordState } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Card, DocumentState, FieldLabel } from '../../components/index.js'
import { addressLine, date, today } from '../../app/format.js'
import {
  documentKindOf,
  documentStatusOf,
  installationKindLabel,
  installationKindOf,
  jobKindLabel,
  jobKindOf,
  jobStatusLabel,
  jobStatusOf,
} from '../../app/labels.js'
import { RecordForm, asTextOrNull } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { JobTasks, MyTasks } from './tasks.js'

/**
 * The jobs this device is meant to work through.
 *
 * It shows the open jobs of the business, and that is not what the mock up
 * calls it. "Meine Aufträge" needs somebody to be assigned to a job, and
 * nothing in the model assigns anybody: `Job` has a customer, a site, an
 * installation and a parent, and no person. ADR 0006 mentions a right narrowed
 * to one's own jobs and the permission list says in as many words why it is
 * not there yet.
 *
 * So the list says "Offene Aufträge", which is true, rather than "Meine",
 * which would be a promise the data cannot keep. The filter is one line once
 * the assignment exists.
 */
function openJobs(jobs: readonly RecordState[]): readonly RecordState[] {
  return jobs.filter((job) => {
    const status = jobStatusOf(job)

    return status === 'active' || status === 'draft'
  })
}

function JobCard({ job }: { readonly job: RecordState }) {
  const site = useRecord('sites', job['siteId'] ? String(job['siteId']) : undefined)
  const customer = useRecord('customers', String(job['customerId']))
  const client = useSync()

  return (
    <li>
      <Link
        to={`/auftraege/${String(job['id'])}`}
        // The whole card is the target, and it is at least 60 pixels high with
        // a thumb in a glove in mind. A link and not a handler, so the keyboard
        // and the screen reader get the same thing the thumb does.
        className="flex flex-col gap-1 p-4 rounded-card border border-line bg-surface min-h-tap"
      >
        <span className="text-title font-semibold">{text(job, 'designation')}</span>
        <span className="text-body text-ink-muted">
          {customer ? text(customer, 'name') : ''}
          {site ? `, ${text(site, 'designation')}` : ''}
        </span>
        {site ? <span className="text-body text-ink-muted">{addressLine(site)}</span> : null}
        <span className="text-body">
          {jobKindLabel[jobKindOf(job)]}
          {', '}
          {jobStatusLabel[jobStatusOf(job)]}
          {client.isPending('jobs', String(job['id'])) ? ', noch nicht übertragen' : ''}
        </span>
      </Link>
    </li>
  )
}

export function SiteJobList() {
  const jobs = useRecords('jobs')
  const open = useMemo(() => openJobs(jobs), [jobs])

  return (
    <div className="flex flex-col gap-4 p-4">
      <MyTasks />

      <h1 className="text-title font-semibold">Offene Aufträge</h1>

      {open.length === 0 ? (
        <Card label="Nichts offen" tone="sunken">
          <p className="text-body">
            Gerade ist kein Auftrag offen. Was im Büro angelegt wird, erscheint hier, sobald das
            Gerät wieder Netz hatte.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {open.map((job) => (
            <JobCard key={String(job['id'])} job={job} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The reports of a job, and the way to start one.
 *
 * A report is made on the device and waits in the outbox like everything else
 * written here. The tax treatment is left to the server, which proposes it
 * when the report arrives, as it does for a document made in the office: the
 * device knows neither the customer's standing nor what the business claims
 * for itself on that date.
 */
function JobReports({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const client = useSync()
  const navigate = useNavigate()
  const documents = useRelated('documents', 'jobId', jobId)
  const reports = useMemo(
    () =>
      documents
        .filter((document) => documentKindOf(document) === 'time_and_material_report')
        .sort(
          (left, right) =>
            text(left, 'documentDate').localeCompare(text(right, 'documentDate')) ||
            String(left['id']).localeCompare(String(right['id'])),
        ),
    [documents],
  )
  const [trouble, setTrouble] = useState<string | null>(null)

  async function start() {
    setTrouble(null)

    const made = await client.create('documents', {
      kind: 'time_and_material_report',
      customerId: String(job['customerId']),
      jobId,
      siteId: maybeText(job, 'siteId'),
      installationId: maybeText(job, 'installationId'),
      documentDate: today(),
      subject: maybeText(job, 'designation'),
    })

    if (made.outcome === 'refused') {
      setTrouble(refusalText[made.reason])

      return
    }

    await navigate({ to: `/auftraege/${jobId}/berichte/${made.id}` })
  }

  return (
    <Card label="Regieberichte">
      <div className="flex flex-col gap-3">
        {reports.length === 0 ? (
          <p className="text-body text-ink-muted">Zu diesem Auftrag gibt es noch keinen.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.map((report) => (
              <li key={String(report['id'])}>
                <Link
                  to={`/auftraege/${jobId}/berichte/${String(report['id'])}`}
                  className="flex flex-wrap items-center gap-3 p-3 rounded-card border border-line bg-surface min-h-tap"
                >
                  <span className="text-body font-semibold">
                    {`Regiebericht vom ${date(report['documentDate'])}`}
                  </span>
                  <DocumentState
                    status={documentStatusOf(report)}
                    number={maybeText(report, 'number')}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <Button tone="secondary" wide onClick={() => void start()}>
          Regiebericht schreiben
        </Button>
      </div>
    </Card>
  )
}

/**
 * One job on site.
 *
 * One main action per screen, and here it is finishing the job. Everything
 * else is reading: who, where, which system, what was agreed, and the reports
 * written for it, which open on a screen of their own. Recording hours is its
 * own issue and not part of this one.
 */
export function SiteJobScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const client = useSync()
  const job = useRecord('jobs', jobId)
  const customer = useRecord('customers', job ? String(job['customerId']) : undefined)
  const site = useRecord('sites', job?.['siteId'] ? String(job['siteId']) : undefined)
  const installation = useRecord(
    'installations',
    job?.['installationId'] ? String(job['installationId']) : undefined,
  )
  const [noting, setNoting] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!job || !jobId) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-title font-semibold">Nicht gefunden</h1>
        <p className="text-body">
          Diesen Auftrag hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </p>
      </div>
    )
  }

  const status = jobStatusOf(job)
  const address = addressLine(site)

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <FieldLabel>{jobKindLabel[jobKindOf(job)]}</FieldLabel>
        <h1 className="text-title font-semibold">{text(job, 'designation')}</h1>
        <p className="text-body text-ink-muted">{jobStatusLabel[status]}</p>
      </div>

      <Card label="Wo und für wen">
        <dl className="flex flex-col gap-3">
          <div>
            <dt>
              <FieldLabel>Kunde</FieldLabel>
            </dt>
            <dd className="text-body">{customer ? text(customer, 'name') : 'nicht angegeben'}</dd>
          </div>
          <div>
            <dt>
              <FieldLabel>Objekt</FieldLabel>
            </dt>
            <dd className="text-body">{site ? text(site, 'designation') : 'nicht angegeben'}</dd>
          </div>
          {address ? (
            <div>
              <dt>
                <FieldLabel>Anschrift</FieldLabel>
              </dt>
              <dd className="text-body">
                {/*
                  A link into the phone's map app. The one thing a technician
                  standing next to a van actually wants from an address.
                */}
                <a
                  href={`geo:0,0?q=${encodeURIComponent(address)}`}
                  className="text-copper-text font-semibold underline underline-offset-2"
                >
                  {address}
                </a>
              </dd>
            </div>
          ) : null}
          {customer && maybeText(customer, 'phone') ? (
            <div>
              <dt>
                <FieldLabel>Telefon</FieldLabel>
              </dt>
              <dd className="text-body">
                <a
                  href={`tel:${text(customer, 'phone')}`}
                  className="text-copper-text font-semibold underline underline-offset-2"
                >
                  {text(customer, 'phone')}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {installation ? (
        <Card label="Anlage">
          <dl className="flex flex-col gap-3">
            <div>
              <dt>
                <FieldLabel>{installationKindLabel[installationKindOf(installation)]}</FieldLabel>
              </dt>
              <dd className="text-body font-semibold">{text(installation, 'designation')}</dd>
            </div>
            {maybeText(installation, 'serialNumber') ? (
              <div>
                <dt>
                  <FieldLabel>Seriennummer</FieldLabel>
                </dt>
                <dd className="text-body numeric">{text(installation, 'serialNumber')}</dd>
              </div>
            ) : null}
            {maybeText(installation, 'commissionedOn') ? (
              <div>
                <dt>
                  <FieldLabel>In Betrieb seit</FieldLabel>
                </dt>
                <dd className="text-body">{date(installation['commissionedOn'])}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      {maybeText(job, 'description') ? (
        <Card label="Was zu tun ist">
          <p className="text-body whitespace-pre-line">{text(job, 'description')}</p>
        </Card>
      ) : null}

      <JobReports job={job} />

      <JobTasks job={job} />

      {noting ? (
        <Card label="Notiz zum Auftrag">
          <RecordForm
            fields={[{ name: 'description', label: 'Was passiert ist' }]}
            record={job}
            submitLabel="Notiz sichern"
            onCancel={() => {
              setNoting(false)
            }}
            onSubmit={async (values) => {
              const saved = await client.update('jobs', jobId, {
                description: asTextOrNull(values['description']),
              })

              if (saved.outcome === 'queued') {
                setNoting(false)
              }

              return saved
            }}
          />
        </Card>
      ) : null}

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {status === 'completed' ? (
          <p className="text-body text-ink-muted">Dieser Auftrag ist abgeschlossen.</p>
        ) : (
          <Button
            tone="primary"
            wide
            onClick={() => {
              setTrouble(null)

              void client.update('jobs', jobId, { status: 'completed' }).then((saved) => {
                if (saved.outcome === 'refused') {
                  setTrouble('Das ging nicht. Der Auftrag bleibt offen.')
                }
              })
            }}
          >
            Auftrag abschließen
          </Button>
        )}

        <Button
          tone="secondary"
          wide
          onClick={() => {
            setNoting((open) => !open)
          }}
        >
          {noting ? 'Notiz schließen' : 'Notiz schreiben'}
        </Button>
      </div>
    </div>
  )
}
