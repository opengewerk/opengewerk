import type { RecordState } from '@opengewerk/domain'
import { Panel, useBand } from '@opengewerk/platform-web'
import { NotSent, SiteScreen, SiteText, TitleCount, TopTitle } from '@opengewerk/platform-web/site'
import { maybeText, text, useRecord, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { Zap } from 'lucide-react'
import { createContext, useMemo } from 'react'
import { addressLine } from '../../app/format.js'
import { jobKindLabel, jobKindOf, jobStatusLabel, jobStatusOf } from '../../app/labels.js'
import { clockOf, useStopwatch } from '../../app/time.js'
import { AppointmentsCard } from './appointments.js'
import { OnCallCard } from './on-call.js'
import { MyTasks } from './tasks.js'
import { TodayTime } from './time.js'

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

      {/* While on call, until when and the way to a new call (#293). */}
      <OnCallCard />

      <AppointmentsCard />

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

/**
 * Whether a job stands in the pane beside the list, as on a tablet held across.
 * Read by the job, which is a module of its own so that it is not part of the
 * first page on site (#831).
 */
export const BesideList = createContext(false)

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
