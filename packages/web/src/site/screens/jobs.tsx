import type { RecordState } from '@opengewerk/domain'
import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { Check, MapPin, Pencil, Signature, Smartphone, Zap } from 'lucide-react'
import { createContext, useContext, useMemo, useState } from 'react'

import { Button, Confirm, DocumentState, Panel, useBand } from '../../components/index.js'
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
import { useMay } from '../../app/queries.js'
import { clockOf, useStopwatch } from '../../app/time.js'
import { RecordForm, asTextOrNull } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { InstallationBoards } from './boards.js'
import { JobContacts } from './contacts.js'
import { JobFiles } from './files.js'
import { InstallationProtocols } from './protocol.js'
import { shownStatus } from './report.js'
import { JobTasks, MyTasks } from './tasks.js'
import { JobTime, TodayTime } from './time.js'
import { SiteHeader } from '../header.js'
import {
  NotSent,
  SiteAnchor,
  SiteFacts,
  SiteLink,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  SiteTrouble,
  TitleCount,
  TopTitle,
} from '../kit.js'

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

/** "Donnerstag, 24. September", the day over the list as the board has it. */
const dayOfList = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/**
 * A job in the list, `job_card()` of the board "Offene Aufträge": the number
 * with its state at the right, the title, for whom and where, the kind, and
 * the installation it is about. The one the stopwatch runs for has a copper
 * edge and "Arbeit läuft" beside its number, so it is found without reading.
 */
function JobCard({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const site = useRecord('sites', job['siteId'] ? String(job['siteId']) : undefined)
  const customer = useRecord('customers', String(job['customerId']))
  const installation = useRecord(
    'installations',
    job['installationId'] ? String(job['installationId']) : undefined,
  )
  const running = useStopwatch()
  const client = useSync()
  const working = running?.jobId === jobId && running.kind === 'work'
  const number = maybeText(job, 'number')
  const who = [customer ? text(customer, 'name') : null, site ? text(site, 'designation') : null]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ')
  const address = site ? addressLine(site) : ''

  return (
    <li>
      <Link
        to={`/auftraege/${jobId}`}
        // The whole card is the target, with a thumb in a glove in mind. A
        // link and not a handler, so the keyboard and the screen reader get
        // the same thing the thumb does.
        // The job open beside the list on a tablet is ringed in slate, as on
        // the board "Tablet quer"; the router marks its link as the page.
        className={clsx(
          'block rounded-[6px] border border-l-4 border-line bg-surface py-[13px] pr-3.5 pl-4 text-ink no-underline aria-[current=page]:ring-2 aria-[current=page]:ring-ink',
          working ? 'border-l-copper' : 'border-l-control',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="numeric text-[16px] font-bold whitespace-nowrap">
            {number ?? 'Nummer folgt'}
          </span>
          {working ? (
            <span className="rounded-[3px] bg-copper-solid px-[7px] py-px font-condensed text-[14px] font-semibold tracking-[0.8px] whitespace-nowrap text-on-copper uppercase">
              Arbeit läuft
            </span>
          ) : null}
          <span className="grow" />
          <span className="numeric text-[15px] whitespace-nowrap text-ink-muted">
            {working ? `seit ${clockOf(running.startedAt)}` : jobStatusLabel[jobStatusOf(job)]}
          </span>
        </span>
        <span className="mt-1 block text-[19px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
          {text(job, 'designation')}
        </span>
        {who || address ? (
          <span className="mt-1 block text-[16px] leading-[1.35] text-ink-muted [overflow-wrap:anywhere]">
            {who}
            {who && address ? <br /> : null}
            {address}
          </span>
        ) : null}
        <span className="mt-0.5 block text-[15px] text-ink-faint">
          {jobKindLabel[jobKindOf(job)]}
          {client.isPending('jobs', jobId) ? (
            <>
              {', '}
              <NotSent />
            </>
          ) : null}
        </span>
        {installation ? (
          <span className="mt-1.5 flex items-center gap-1.5 text-[15px] text-ink-muted">
            <Zap size={15} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-faint" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {text(installation, 'designation')}
            </span>
          </span>
        ) : null}
      </Link>
    </li>
  )
}

/**
 * The first screen on site, the board "Offene Aufträge": the day, the open
 * jobs with the one being worked on marked, then the time of the day and the
 * tasks that are one's own.
 */
export function SiteJobList() {
  const jobs = useRecords('jobs')
  const open = useMemo(() => openJobs(jobs), [jobs])

  return (
    <SiteScreen gap={14}>
      <TopTitle
        over={dayOfList.format(new Date())}
        title="Offene Aufträge"
        right={<TitleCount count={open.length} label="offen" />}
      />

      {open.length === 0 ? (
        <Panel title="Nichts offen">
          <SiteText>
            Gerade ist kein Auftrag offen. Was im Büro angelegt wird, erscheint hier, sobald das
            Gerät wieder Netz hatte.
          </SiteText>
        </Panel>
      ) : (
        <ul aria-label="Offene Aufträge" className="flex flex-col gap-2.5">
          {open.map((job) => (
            <JobCard key={String(job['id'])} job={job} />
          ))}
        </ul>
      )}

      <TodayTime />

      <MyTasks />
    </SiteScreen>
  )
}

/** Whether a job stands in the pane beside the list, as on a tablet held across. */
const BesideList = createContext(false)

/**
 * The list and a job side by side from 1024 pixels on, the board "Tablet
 * quer, Liste und Auftrag": the list in a column of its own, the job chosen in
 * it beside it, and each of the two scrolls for itself. Below that the list
 * and a job are one screen each, as on the phone.
 *
 * Only the list and the job itself: what opens from a job, a report or a
 * board, takes the whole width again, with the way back in its header.
 */
export function SiteJobsLayout() {
  const band = useBand()
  const path = useRouterState({ select: (state) => state.location.pathname })

  if (band === 'S' || band === 'M') {
    return <Outlet />
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[404px] shrink-0 overflow-y-auto">
        <SiteJobList />
      </div>
      <div className="min-w-0 grow overflow-y-auto border-l border-line">
        <BesideList.Provider value={true}>
          {path === '/' ? <NoJobChosen /> : <Outlet />}
        </BesideList.Provider>
      </div>
    </div>
  )
}

/** The pane beside the list before a job is chosen. */
function NoJobChosen() {
  return (
    <div className="flex h-full items-center justify-center px-5 py-4">
      <SiteText muted>Einen Auftrag in der Liste wählen, er steht dann hier.</SiteText>
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
  // Signed here and not sent yet, the server still says draft; the device
  // knows better, as the report itself does (#223).
  const signatures = useRecords('document_signatures')
  const signatureOf = useMemo(
    () => new Map(signatures.map((signature) => [String(signature['documentId']), signature])),
    [signatures],
  )
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
    <Panel title="Regieberichte">
      <div className="flex flex-col gap-2">
        {reports.length === 0 ? (
          <SiteText muted>Zu diesem Auftrag gibt es noch keinen.</SiteText>
        ) : (
          <SiteRows label="Regieberichte">
            {reports.map((report) => (
              <SiteRow
                key={String(report['id'])}
                to={`/auftraege/${jobId}/berichte/${String(report['id'])}`}
                title={`Regiebericht vom ${date(report['documentDate'])}`}
                right={
                  <DocumentState
                    status={shownStatus(
                      documentStatusOf(report),
                      signatureOf.get(String(report['id'])) ?? null,
                    )}
                  />
                }
              />
            ))}
          </SiteRows>
        )}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
        {/* The one copper button of the screen (#223): a report is what a
            technician writes here. */}
        <Button tone="primary" wide height={52} icon={Signature} onClick={() => void start()}>
          Regiebericht schreiben
        </Button>
      </div>
    </Panel>
  )
}

/**
 * Which job this one follows, and which follow it (#170). On site that is
 * where to look up what was done before: the meter cabinet the wallbox hangs
 * on, the handover a repair comes after. Only what this device holds; a job
 * it does not have is left out rather than named as missing.
 */
function JobLineage({ job }: { readonly job: RecordState }) {
  const before = useRecord('jobs', maybeText(job, 'predecessorJobId') ?? undefined)
  const after = useRelated('jobs', 'predecessorJobId', String(job['id']))

  if (!before && after.length === 0) {
    return null
  }

  const linked = (other: RecordState) => (
    <>
      <SiteLink to={`/auftraege/${String(other['id'])}`}>{text(other, 'designation')}</SiteLink>
      <span className="text-ink-muted">{`, ${jobStatusLabel[jobStatusOf(other)]}`}</span>
    </>
  )

  return (
    <Panel title="Vorher und danach">
      <SiteFacts
        facts={[
          ...(before ? [{ label: 'Folgt auf', value: linked(before) }] : []),
          ...(after.length > 0
            ? [
                {
                  label: 'Folgeaufträge',
                  value: (
                    <ul className="flex flex-col gap-1">
                      {after.map((follower) => (
                        <li key={String(follower['id'])}>{linked(follower)}</li>
                      ))}
                    </ul>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Panel>
  )
}

/**
 * One job on site.
 *
 * One main action per screen, and here it is finishing the job. Everything
 * else is reading: who, where, which system, what was agreed, and the reports
 * written for it, which open on a screen of their own. The working time of
 * #76 starts here, under what was agreed, because here it is clear what the
 * time belongs to.
 *
 * Finishing and the note are the progress of a job (`job.progress`, #128),
 * and both buttons ask for that right before they show: a button that leads
 * to an operation the server refuses was what this screen offered every
 * technician until then.
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
  // Closing a job asks first (#222): it leaves the list, and after 30 days the devices.
  const [closing, setClosing] = useState(false)
  const reports = useMay('job.progress')
  const beside = useContext(BesideList)

  if (!job || !jobId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen Auftrag hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  const status = jobStatusOf(job)
  const address = addressLine(site)
  const phone = customer ? maybeText(customer, 'phone') : null
  const numberLine = maybeText(job, 'number') ? (
    <>
      <span className="numeric">{text(job, 'number')}</span>
      {', '}
    </>
  ) : client.isPending('jobs', jobId) ? (
    'Nummer folgt beim Abgleich, '
  ) : null

  const where = (
    <Panel title="Wo und für wen">
      <SiteFacts
        facts={[
          { label: 'Kunde', value: customer ? text(customer, 'name') : 'nicht angegeben' },
          { label: 'Objekt', value: site ? text(site, 'designation') : 'nicht angegeben' },
          ...(address
            ? [
                {
                  label: 'Anschrift',
                  // A link into the phone's map app: the one thing a
                  // technician standing next to a van wants from an address.
                  value: (
                    <SiteAnchor href={`geo:0,0?q=${encodeURIComponent(address)}`} icon={MapPin}>
                      {address}
                    </SiteAnchor>
                  ),
                },
              ]
            : []),
          ...(phone
            ? [
                {
                  label: 'Telefon',
                  value: (
                    <SiteAnchor href={`tel:${phone}`} icon={Smartphone}>
                      {phone}
                    </SiteAnchor>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Panel>
  )

  const plant = installation ? (
    <Panel title="Anlage">
      <div className="flex flex-col gap-2.5">
        <SiteFacts
          facts={[
            {
              label: installationKindLabel[installationKindOf(installation)],
              value: <b className="font-semibold">{text(installation, 'designation')}</b>,
            },
            ...(maybeText(installation, 'serialNumber')
              ? [
                  {
                    label: 'Seriennummer',
                    value: <span className="numeric">{text(installation, 'serialNumber')}</span>,
                  },
                ]
              : []),
            ...(maybeText(installation, 'commissionedOn')
              ? [{ label: 'In Betrieb seit', value: date(installation['commissionedOn']) }]
              : []),
          ]}
        />
        <InstallationBoards jobId={jobId} installationId={String(installation['id'])} />
        <InstallationProtocols jobId={jobId} installationId={String(installation['id'])} />
      </div>
    </Panel>
  ) : null

  const todo = maybeText(job, 'description') ? (
    <Panel title="Was zu tun ist">
      <p className="text-[17px] leading-[1.45] whitespace-pre-line [overflow-wrap:anywhere]">
        {text(job, 'description')}
      </p>
    </Panel>
  ) : null

  const note =
    reports && noting ? (
      <Panel title="Notiz zum Auftrag">
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
      </Panel>
    ) : null

  const end = (
    <div className="flex flex-col gap-2">
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      {status === 'completed' ? (
        <SiteText muted>Dieser Auftrag ist abgeschlossen.</SiteText>
      ) : reports ? (
        // Slate, as the board has it: finishing is going somewhere, not
        // the thing this screen is for.
        <Button
          tone="dark"
          wide
          height={52}
          icon={Check}
          onClick={() => {
            setTrouble(null)
            setClosing(true)
          }}
        >
          Auftrag abschließen
        </Button>
      ) : null}

      <Confirm
        open={closing}
        title="Auftrag abschließen?"
        confirm="Abschließen"
        tone="primary"
        onConfirm={() => {
          setClosing(false)

          void client.update('jobs', jobId, { status: 'completed' }).then((saved) => {
            if (saved.outcome === 'refused') {
              setTrouble('Das ging nicht. Der Auftrag bleibt offen.')
            }
          })
        }}
        onCancel={() => {
          setClosing(false)
        }}
      >
        {`„${text(job, 'designation')}“ gilt danach als abgeschlossen. Auf den Geräten der Monteure bleibt er noch 30 Tage zu sehen.`}
      </Confirm>

      {reports ? (
        <Button
          wide
          height={48}
          icon={Pencil}
          onClick={() => {
            setNoting((open) => !open)
          }}
        >
          {noting ? 'Notiz schließen' : 'Notiz schreiben'}
        </Button>
      ) : null}
    </div>
  )

  const contacts = <JobContacts job={job} />
  const lineage = <JobLineage job={job} />
  const time = <JobTime job={job} />
  const writing = <JobReports job={job} />
  const files = <JobFiles job={job} />
  const tasks = <JobTasks job={job} />

  // Beside the list two columns as on the board "Tablet quer": where and for
  // whom over the installation on the left, what to do over the reports on
  // the right, the rest under them. Two stacks rather than one grid, because
  // the installation with its boards and protocols is far taller than a card
  // beside it and would leave a hole in every row; a reader and the tab key
  // go down the left column, then down the right. The two columns need 640
  // pixels of the pane, which a tablet of 1180 has; a narrower one, a window
  // of 1024, sets the stacks under each other, or buttons in a card of half
  // that width would run over its edge.
  if (beside) {
    return (
      <div className="@container flex min-w-0 flex-col gap-3 px-5 py-4">
        <div>
          <p className="font-condensed text-[14px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
            {jobKindLabel[jobKindOf(job)]}
          </p>
          <h1 className="mt-0.5 text-[27px] leading-[1.2] font-bold [overflow-wrap:anywhere]">
            {text(job, 'designation')}
          </h1>
          <p className="mt-0.5 text-[16px] text-ink-muted">
            {numberLine}
            {jobStatusLabel[status]}
          </p>
        </div>
        <div className="grid grid-cols-1 items-start gap-3 @min-[40rem]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            {where}
            {plant}
            {contacts}
            {lineage}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {todo}
            {writing}
            {time}
            {files}
            {tasks}
            {note}
            {end}
          </div>
        </div>
      </div>
    )
  }

  return (
    <SiteScreen>
      <SiteHeader
        title={text(job, 'designation')}
        sub={
          <>
            {`${jobKindLabel[jobKindOf(job)]}, `}
            {numberLine}
            {jobStatusLabel[status]}
          </>
        }
      />

      {where}
      {contacts}
      {lineage}
      {plant}
      {todo}
      {time}
      {writing}
      {files}
      {tasks}
      {note}
      {end}
    </SiteScreen>
  )
}
