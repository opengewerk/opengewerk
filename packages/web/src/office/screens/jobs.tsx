import type { JobKind, JobStatus, RecordState } from '@opengewerk/domain'
import { followUpProblem, jobKinds, jobStatuses } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  Button,
  Card,
  Field,
  SelectField,
  Status,
  statusIcons,
  TextArea,
} from '../../components/index.js'
import type { StatusTone } from '../../components/index.js'
import { DataTable } from '../../app/data-table.js'
import type { ListColumns } from '../../app/data-table.js'
import {
  jobKindLabel,
  jobKindOf,
  jobStatusLabel,
  jobStatusOf,
  jobStatusTone,
} from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { RecordForm, asTextOrNull } from '../../app/record-form.js'
import type { FormField } from '../../app/record-form.js'
import { usePeople } from '../../app/tasks.js'
import { assignToJob } from '../../session/jobs.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { RequestRefused } from '../../sync/transport.js'
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
 * The state of a job as the canvas marks it (#219): a running job plays, a
 * draft is a draft, a finished one is ticked and a cancelled one barred.
 */
const jobStates: Readonly<
  Record<JobStatus, { readonly tone: StatusTone; readonly icon?: typeof statusIcons.play }>
> = {
  draft: { tone: 'draft' },
  active: { tone: 'waiting', icon: statusIcons.play },
  completed: { tone: 'done' },
  cancelled: { tone: 'neutral', icon: statusIcons.ban },
}

export function JobState({ job }: { readonly job: RecordState }) {
  const status = jobStatusOf(job)
  const { tone, icon } = jobStates[status]

  return (
    <Status tone={tone} icon={icon}>
      {jobStatusLabel[status]}
    </Status>
  )
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
  const predecessor = useRecord(
    'jobs',
    job ? (maybeText(job, 'predecessorJobId') ?? undefined) : undefined,
  )
  const followers = useRelated('jobs', 'predecessorJobId', jobId)
  const mayWrite = useMay('job.write')
  const [editing, setEditing] = useState(false)
  const [following, setFollowing] = useState(false)

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
          ) : client.isPending('jobs', String(job['id'])) ? (
            <>
              <span aria-hidden="true"> · </span>
              Nummer folgt beim Abgleich
            </>
          ) : null}
        </>
      }
      actions={
        <>
          <Button
            tone="secondary"
            onClick={() => {
              setEditing((open) => !open)
            }}
          >
            {editing ? 'Bearbeiten beenden' : 'Bearbeiten'}
          </Button>
          {status === 'completed' && mayWrite ? (
            <Button
              tone="secondary"
              disabled={following}
              onClick={() => {
                setFollowing(true)
              }}
            >
              Folgeauftrag anlegen
            </Button>
          ) : null}
        </>
      }
    >
      {following ? (
        <Card label="Folgeauftrag">
          <FollowUpForm
            predecessor={job}
            onDone={() => {
              setFollowing(false)
            }}
          />
        </Card>
      ) : null}

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
            {predecessor ? (
              <Fact label="Folgt auf">
                <Link
                  to={`/auftraege/${String(predecessor['id'])}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(predecessor, 'designation')}
                </Link>
                {maybeText(predecessor, 'number') ? (
                  <span className="numeric text-ink-muted">{` ${text(predecessor, 'number')}`}</span>
                ) : null}
              </Fact>
            ) : null}
          </Facts>
        </Card>
      )}

      <JobPeople jobId={jobId} />

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

      {followers.length > 0 ? (
        <Section title="Folgeaufträge">
          <ul className="flex flex-col gap-2">
            {followers.map((follower) => (
              <JobLine key={String(follower['id'])} job={follower} />
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  )
}

/**
 * Who is on the job (#140), set in the office.
 *
 * For a technician it decides what their device holds: the jobs they are on,
 * with what hangs on them, and a closed one thirty days longer. Said under
 * the list, because a job nobody is on is a job no technician's device knows.
 * Chosen as a whole list and sent to the route in one step; the names come
 * from the server, the people behind them never travel to a device.
 */
function JobPeople({ jobId }: { readonly jobId: string }) {
  const client = useSync()
  const mayWrite = useMay('job.write')
  const { people } = usePeople()
  const assignments = useRelated('job_assignments', 'jobId', jobId)
  const on = useMemo(() => assignments.map((row) => text(row, 'userId')).sort(), [assignments])
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const nameOf = (userId: string) =>
    people.find((person) => person.userId === userId)?.name ?? 'jemand, dessen Name fehlt'
  // Whoever may be put on a job, and whoever is on it already even if they
  // may not be any more: taking somebody off must stay possible.
  const choices = people.filter((person) => person.active || on.includes(person.userId))

  async function save(userIds: readonly string[]) {
    setWorking(true)
    setTrouble(null)

    try {
      await assignToJob(jobId, userIds)
      await client.synchronise()
      setChosen(null)
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Wer auf einem Auftrag ist, wird mit Verbindung festgelegt.',
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Section
      title="Monteure"
      actions={
        mayWrite && chosen === null ? (
          <Button
            onClick={() => {
              setChosen(new Set(on))
            }}
          >
            Zuordnen
          </Button>
        ) : null
      }
    >
      {chosen !== null ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void save([...chosen])
          }}
        >
          <ul className="flex flex-col gap-2">
            {choices.map((person) => (
              <li key={person.userId}>
                <label className="flex items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={chosen.has(person.userId)}
                    onChange={(event) => {
                      const next = new Set(chosen)

                      if (event.target.checked) {
                        next.add(person.userId)
                      } else {
                        next.delete(person.userId)
                      }

                      setChosen(next)
                    }}
                  />
                  {person.name}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" tone="primary" disabled={working}>
              {working ? 'Einen Moment' : 'Speichern'}
            </Button>
            <Button
              tone="quiet"
              disabled={working}
              onClick={() => {
                setChosen(null)
                setTrouble(null)
              }}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : on.length > 0 ? (
        <ul className="flex flex-col gap-1 text-body text-ink">
          {on.map((userId) => (
            <li key={userId}>{nameOf(userId)}</li>
          ))}
        </ul>
      ) : (
        <Nothing>
          Noch niemand ist diesem Auftrag zugeordnet. Ein Monteur hat auf seinem Gerät nur die
          Aufträge, denen er zugeordnet ist.
        </Nothing>
      )}
      {trouble ? (
        <p role="alert" className="mt-3 text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </Section>
  )
}

/**
 * A follow-up of a finished job (#170), made from the job before it.
 *
 * The kind, the site and the installation are taken over and can be changed:
 * the wallbox after the meter cabinet is at the same house, a repair after the
 * handover at the same system, and sometimes neither. The customer cannot be
 * changed, a follow-up is for the same one; the form does not offer the field.
 * It asks the rule of `domain` before anything is queued, the one the server
 * asks when the job arrives, and says what is wrong the way the server would.
 */
function FollowUpForm({
  predecessor,
  onDone,
}: {
  readonly predecessor: RecordState
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const customerId = String(predecessor['customerId'])
  const sites = useRelated('sites', 'customerId', customerId)
  const [designation, setDesignation] = useState('')
  const [kind, setKind] = useState<JobKind>(jobKindOf(predecessor))
  const [siteId, setSiteId] = useState(maybeText(predecessor, 'siteId') ?? '')
  const [installationId, setInstallationId] = useState(
    maybeText(predecessor, 'installationId') ?? '',
  )
  const installations = useRelated('installations', 'siteId', siteId === '' ? undefined : siteId)
  const [description, setDescription] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    if (designation.trim() === '') {
      setProblem('Ein Auftrag braucht eine Bezeichnung.')

      return
    }

    const refused = followUpProblem(
      { id: '', customerId },
      { id: String(predecessor['id']), customerId, status: jobStatusOf(predecessor) },
    )

    if (refused !== null) {
      setTrouble(refused)

      return
    }

    const made = await client.create('jobs', {
      designation: designation.trim(),
      kind,
      status: 'draft',
      description: asTextOrNull(description),
      customerId,
      siteId: siteId === '' ? null : siteId,
      installationId: installationId === '' ? null : installationId,
      parentJobId: null,
      predecessorJobId: String(predecessor['id']),
    })

    if (made.outcome === 'queued') {
      onDone()
      await navigate({ to: `/auftraege/${made.id}` })

      return
    }

    setTrouble(refusalText[made.reason])
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <p className="text-body text-ink">
        {`Ein neuer Auftrag für denselben Kunden, nach „${text(predecessor, 'designation')}“. ` +
          'Art, Objekt und Anlage sind übernommen und lassen sich ändern.'}
      </p>
      <Field
        label="Bezeichnung"
        value={designation}
        required
        {...(problem === null ? {} : { problem })}
        onChange={(event) => {
          setDesignation(event.target.value)
          setProblem(null)
        }}
      />
      <SelectField
        label="Art"
        value={kind}
        options={kindOptions}
        onChange={(value) => {
          setKind(value as JobKind)
        }}
      />
      <SelectField
        label="Objekt"
        value={siteId}
        options={[
          { value: '', label: 'Kein Objekt' },
          ...sites.map((site) => ({ value: String(site['id']), label: text(site, 'designation') })),
        ]}
        onChange={(value) => {
          setSiteId(value)
          // An installation belongs to its site and is not at another one.
          setInstallationId('')
        }}
      />
      <SelectField
        label="Anlage"
        value={installationId}
        disabled={siteId === ''}
        options={[
          { value: '', label: 'Keine Anlage' },
          ...installations.map((installation) => ({
            value: String(installation['id']),
            label: text(installation, 'designation'),
          })),
        ]}
        onChange={(value) => {
          setInstallationId(value)
        }}
      />
      <TextArea
        label="Beschreibung"
        value={description}
        rows={3}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary">
          Folgeauftrag anlegen
        </Button>
        <Button tone="quiet" onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
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
