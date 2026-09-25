import type { JobKind, JobStatus, RecordState } from '@opengewerk/domain'
import { followUpProblem, jobKinds, jobStatuses } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import clsx from 'clsx'
import { Calendar, Pencil, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import {
  Button,
  Field,
  NumberBadge,
  Panel,
  SelectField,
  Status,
  statusIcons,
  TextArea,
  useBand,
} from '../../components/index.js'
import type { StatusTone } from '../../components/index.js'
import { date } from '../../app/format.js'
import { JobNoteList, useJobNotes } from '../../app/job-notes.js'
import { jobKindLabel, jobKindOf, jobStatusLabel, jobStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { RecordForm, asTextOrNull } from '../../app/record-form.js'
import type { FormField } from '../../app/record-form.js'
import { usePeople } from '../../app/tasks.js'
import { assignToJob } from '../../session/jobs.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { RequestRefused } from '../../sync/transport.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { Empty, FactList, PageHead, RecordColumns, Screen } from '../kit.js'
import { lastChanged, ListCard, ListScreen } from '../list.js'
import type { ListColumn } from '../list.js'
import { FilesPanel } from './attachments.js'
import { DocumentChainCard, JobDocumentsPanel, useJobDocuments } from './documents.js'
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

/** Whom a job has, by name, for the list and the card of the job. */
function useCrews(): ReadonlyMap<string, readonly string[]> {
  const assignments = useRecords('job_assignments')
  const { people } = usePeople()

  return useMemo(() => {
    const crews = new Map<string, string[]>()

    for (const assignment of assignments) {
      const name = people.find((person) => person.userId === text(assignment, 'userId'))?.name

      if (name) {
        const jobId = text(assignment, 'jobId')

        crews.set(jobId, [...(crews.get(jobId) ?? []), name])
      }
    }

    return crews
  }, [assignments, people])
}

/**
 * All jobs of the business, as the board "Aufträge" of the canvas has them
 * (#219): the number first, then what it is, for whom and who is on it.
 */
export function JobList() {
  const jobs = useRecords('jobs')
  const customers = useRecords('customers')
  const crews = useCrews()

  const names = useMemo(
    () => new Map(customers.map((customer) => [String(customer['id']), text(customer, 'name')])),
    [customers],
  )
  const customerName = (row: RecordState) => names.get(text(row, 'customerId')) ?? ''
  const crew = (row: RecordState) => (crews.get(String(row['id'])) ?? []).join(', ')

  const columns: readonly ListColumn[] = [
    {
      id: 'number',
      header: 'Nummer',
      value: (row) => text(row, 'number'),
      // A job made on a device gets its number when it arrives.
      cell: (row) =>
        maybeText(row, 'number') ?? <span className="text-ink-faint">noch ohne Nummer</span>,
      width: 'w-[116px]',
    },
    { id: 'designation', header: 'Bezeichnung', value: (row) => text(row, 'designation') },
    {
      id: 'kind',
      header: 'Art',
      value: (row) => jobKindLabel[jobKindOf(row)],
      width: 'w-[110px]',
      wideOnly: true,
    },
    {
      id: 'status',
      header: 'Status',
      value: (row) => jobStatusLabel[jobStatusOf(row)],
      cell: (row) => <JobState job={row} />,
      width: 'w-[136px]',
    },
    { id: 'customer', header: 'Kunde', value: customerName, width: 'w-[190px]' },
    { id: 'crew', header: 'Monteure', value: crew, width: 'w-[170px]', wideOnly: true },
  ]
  const byStatus = (status: JobStatus) => (row: RecordState) => jobStatusOf(row) === status

  return (
    <ListScreen
      title="Aufträge"
      caption="Alle Aufträge des Betriebs"
      rows={jobs}
      columns={columns}
      hrefFor={(row) => `/auftraege/${String(row['id'])}`}
      searchLabel="Aufträge durchsuchen"
      searchPlaceholder="Nummer, Bezeichnung, Kunde …"
      filters={[
        { id: 'active', label: 'Laufend', test: byStatus('active') },
        { id: 'draft', label: 'Entwurf', test: byStatus('draft') },
        { id: 'completed', label: 'Abgeschlossen', test: byStatus('completed') },
        { id: 'cancelled', label: 'Abgebrochen', test: byStatus('cancelled') },
      ]}
      sorts={[
        lastChanged,
        {
          id: 'number',
          label: 'Nummer',
          compare: (left, right) =>
            text(right, 'number').localeCompare(text(left, 'number'), 'de', { numeric: true }),
        },
      ]}
      card={(row) => (
        <ListCard
          to={`/auftraege/${String(row['id'])}`}
          title={text(row, 'designation')}
          sub={[maybeText(row, 'number'), customerName(row)].filter(Boolean).join(' · ')}
          right={<JobState job={row} />}
        />
      )}
      note="Ein Auftrag entsteht am Kunden oder am Objekt."
      empty={{
        icon: Calendar,
        title: 'Noch kein Auftrag angelegt',
        text: 'Ein Auftrag entsteht am Kunden oder am Objekt, unter „Aufträge“.',
      }}
    />
  )
}

export function JobScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const job = useRecord('jobs', jobId)

  if (!job || !jobId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/auftraege', label: 'Aufträge' }]} />
        <Empty>Diesen Auftrag gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.</Empty>
      </Screen>
    )
  }

  // Keyed, so that going from a job to its follow-up starts with no form open.
  return <JobRecord key={jobId} job={job} />
}

type Tab = 'overview' | 'documents' | 'time' | 'files'

const tabs: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'documents', label: 'Belege' },
  { id: 'time', label: 'Zeiten' },
  { id: 'files', label: 'Dateien' },
]

/**
 * One job, `auftrag()` of the canvas (#219): its chain of documents across
 * the top, the documents, the time and the files at the left, the job, who is
 * on it, its tasks and what followed it at the right. On a phone the parts
 * stand behind tabs, as the board "Auftrag im Büro, Telefon" has them.
 */
function JobRecord({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const client = useSync()
  const band = useBand()
  const customer = useRecord('customers', String(job['customerId']))
  const site = useRecord('sites', maybeText(job, 'siteId') ?? undefined)
  const writesJobs = useMay('job.write')
  const documentsState = useJobDocuments(job)
  const [editing, setEditing] = useState(false)
  const [following, setFollowing] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [more, setMore] = useState(false)

  const status = jobStatusOf(job)
  const number = maybeText(job, 'number')
  const sub = [
    jobKindLabel[jobKindOf(job)],
    maybeText(job, 'createdAt') ? `angelegt ${date(job['createdAt'])}` : null,
    site ? `Objekt ${text(site, 'designation')}` : null,
    !number && client.isPending('jobs', jobId) ? 'Nummer folgt beim Abgleich' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const { mayWrite: writesDocuments, working, trouble } = documentsState

  const facts = (
    <Panel title="Auftrag">
      {editing ? (
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
      ) : (
        <JobFacts job={job} />
      )}
    </Panel>
  )
  const followUp = following ? (
    <Panel title="Folgeauftrag">
      <FollowUpForm
        predecessor={job}
        onDone={() => {
          setFollowing(false)
        }}
      />
    </Panel>
  ) : null
  const documents = <JobDocumentsPanel state={documentsState} />
  const notes = <JobNotesPanel jobId={jobId} />
  const time = <JobTimeSection jobId={jobId} />
  const files = (
    <FilesPanel
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
  )
  const people = <JobPeople jobId={jobId} />
  const tasks = (
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
  )
  const related = <RelatedJobs jobId={jobId} />
  const chain = <DocumentChainCard documents={documentsState.documents} />

  return (
    <Screen>
      <PageHead
        crumbs={[
          { to: '/auftraege', label: 'Aufträge' },
          ...(customer
            ? [{ to: `/kunden/${String(customer['id'])}`, label: text(customer, 'name') }]
            : []),
        ]}
        phoneBack={{ to: '/auftraege', label: 'Aufträge' }}
        title={text(job, 'designation')}
        badges={
          <>
            {number ? <NumberBadge>{number}</NumberBadge> : null}
            <JobState job={job} />
          </>
        }
        sub={sub}
        wideActions
        actions={
          <>
            <Button
              icon={Pencil}
              disabled={editing}
              onClick={() => {
                setEditing(true)
                setTab('overview')
              }}
            >
              Bearbeiten
            </Button>
            {writesDocuments ? (
              <Button disabled={working} onClick={() => void documentsState.start('quote')}>
                Angebot anlegen
              </Button>
            ) : null}
            {/* On a phone two in a row, and the rest behind "Weitere Aktionen",
                as the board draws the head there. */}
            {band === 'S' && (writesDocuments || (status === 'completed' && writesJobs)) ? (
              <Button
                aria-expanded={more}
                onClick={() => {
                  setMore((open) => !open)
                }}
              >
                Weitere Aktionen
              </Button>
            ) : null}
            {band !== 'S' || more ? (
              <>
                {writesDocuments ? (
                  <Button
                    disabled={working}
                    onClick={() => void documentsState.start('cost_estimate')}
                  >
                    Kostenvoranschlag anlegen
                  </Button>
                ) : null}
                {status === 'completed' && writesJobs ? (
                  <Button
                    disabled={following}
                    onClick={() => {
                      setFollowing(true)
                      setTab('overview')
                    }}
                  >
                    Folgeauftrag anlegen
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {band === 'S' ? (
        <>
          <Tabs tab={tab} onChange={setTab} />
          <div role="tabpanel" id={`${jobId}-${tab}`} className="flex flex-col gap-3">
            {tab === 'overview' ? (
              <>
                {followUp}
                {facts}
                {chain}
                {notes}
                {people}
                {tasks}
                {related}
              </>
            ) : tab === 'documents' ? (
              documents
            ) : tab === 'time' ? (
              time
            ) : (
              files
            )}
          </div>
        </>
      ) : (
        <>
          {chain}
          <RecordColumns
            main={
              <>
                {followUp}
                {documents}
                {notes}
                {time}
                {files}
              </>
            }
            side={
              <>
                {facts}
                {people}
                {tasks}
                {related}
              </>
            }
          />
        </>
      )}
    </Screen>
  )
}

/**
 * What the site wrote about the job (#220), the newest first, with who wrote
 * it when. The office reads the notes here and writes none: what is to be done
 * stays in the description, which is the office's.
 */
function JobNotesPanel({ jobId }: { readonly jobId: string }) {
  const notes = useJobNotes(jobId)

  return (
    <Panel title="Notizen von der Baustelle">
      {notes.length === 0 ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Von der Baustelle gibt es zu diesem Auftrag noch keine Notiz.
        </p>
      ) : (
        <JobNoteList notes={notes} label="Notizen von der Baustelle" />
      )}
    </Panel>
  )
}

/** The parts of a job on a phone, as tabs in a bar, "Übersicht" first. */
function Tabs({ tab, onChange }: { readonly tab: Tab; readonly onChange: (tab: Tab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Bereiche des Auftrags"
      className="flex gap-1 rounded-[5px] border border-line bg-surface-sunken p-[3px]"
    >
      {tabs.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          onClick={() => {
            onChange(entry.id)
          }}
          className={clsx(
            'min-h-10 grow basis-0 cursor-pointer rounded-[3px] text-[14px]',
            tab === entry.id ? 'bg-surface font-semibold text-ink' : 'text-ink-muted',
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}

/** "Auftrag": for whom, where, what, and what it follows. */
function JobFacts({ job }: { readonly job: RecordState }) {
  const customer = useRecord('customers', String(job['customerId']))
  const site = useRecord('sites', maybeText(job, 'siteId') ?? undefined)
  const installation = useRecord('installations', maybeText(job, 'installationId') ?? undefined)
  const predecessor = useRecord('jobs', maybeText(job, 'predecessorJobId') ?? undefined)
  const link = (to: string, label: string) => (
    <Link to={to} className="text-copper-text underline underline-offset-2">
      {label}
    </Link>
  )

  return (
    <FactList
      keyWidth={96}
      facts={[
        {
          label: 'Kunde',
          value: customer
            ? link(`/kunden/${String(customer['id'])}`, text(customer, 'name'))
            : null,
        },
        {
          label: 'Objekt',
          value: site ? link(`/objekte/${String(site['id'])}`, text(site, 'designation')) : null,
        },
        {
          label: 'Anlage',
          value: installation
            ? link(`/anlagen/${String(installation['id'])}`, text(installation, 'designation'))
            : null,
        },
        { label: 'Beschreibung', value: maybeText(job, 'description') },
        ...(predecessor
          ? [
              {
                label: 'Folgt auf',
                value: (
                  <>
                    {link(
                      `/auftraege/${String(predecessor['id'])}`,
                      text(predecessor, 'designation'),
                    )}
                    {maybeText(predecessor, 'number') ? (
                      <span className="numeric block">{text(predecessor, 'number')}</span>
                    ) : null}
                  </>
                ),
              },
            ]
          : []),
      ]}
    />
  )
}

/** The jobs that came out of this one: its follow-ups and its parts. */
function RelatedJobs({ jobId }: { readonly jobId: string }) {
  const followers = useRelated('jobs', 'predecessorJobId', jobId)
  const children = useRelated('jobs', 'parentJobId', jobId)

  return (
    <>
      {followers.length > 0 ? (
        <Panel title="Folgeaufträge">
          <JobLines jobs={followers} />
        </Panel>
      ) : null}
      {children.length > 0 ? (
        <Panel title="Teilaufträge">
          <JobLines jobs={children} />
        </Panel>
      ) : null}
    </>
  )
}

/**
 * Jobs as lines in a card, `list_lines()` of the canvas: the name as a link,
 * the state beside it, the number at the right. The state in a word and a
 * symbol, never in a colour alone.
 */
function JobLines({ jobs }: { readonly jobs: readonly RecordState[] }) {
  return (
    <ul>
      {jobs.map((job) => (
        <li
          key={String(job['id'])}
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-row py-2 last:border-b-0"
        >
          <Link
            to={`/auftraege/${String(job['id'])}`}
            className="text-[14px] font-medium text-copper-text underline underline-offset-2"
          >
            {text(job, 'designation')}
          </Link>
          <JobState job={job} />
          <div className="grow" />
          {maybeText(job, 'number') ? (
            <span className="numeric text-[13px] text-ink-faint">{text(job, 'number')}</span>
          ) : null}
        </li>
      ))}
    </ul>
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

  let content: ReactNode

  if (chosen !== null) {
    content = (
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
              <label className="flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  className="size-4"
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
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="small"
            disabled={working}
            onClick={() => {
              setChosen(null)
              setTrouble(null)
            }}
          >
            Abbrechen
          </Button>
          <Button type="submit" size="small" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Speichern'}
          </Button>
        </div>
      </form>
    )
  } else {
    content = (
      <div className="flex flex-col gap-2">
        {on.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-[14px] text-ink">
            {on.map((userId) => (
              <li key={userId} className="flex items-center gap-2">
                <UserRound size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                {nameOf(userId)}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[13px] leading-[1.4] text-ink-faint">
          {on.length > 0
            ? 'Ein Monteur hat auf seinem Gerät nur die Aufträge, denen er zugeordnet ist.'
            : 'Noch niemand ist diesem Auftrag zugeordnet. Ein Monteur hat auf seinem Gerät nur ' +
              'die Aufträge, denen er zugeordnet ist.'}
        </p>
      </div>
    )
  }

  return (
    <Panel
      title="Monteure"
      action={
        mayWrite && chosen === null ? (
          <Button
            size="small"
            onClick={() => {
              setChosen(new Set(on))
            }}
          >
            Zuordnen
          </Button>
        ) : null
      }
    >
      {content}
      {trouble ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </Panel>
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
