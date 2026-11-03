import type { RecordState } from '@opengewerk/domain'
import { Button, Confirm, Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  SiteAnchor,
  SiteFacts,
  SiteLink,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check, MapPin, Signature, Smartphone } from 'lucide-react'
import { useContext, useMemo, useState } from 'react'
import { berlinMoment } from '../../app/appointments.js'
import { DocumentState } from '../../app/document-state.js'
import { JobAcceptance } from './acceptance.js'
import { JobDefects } from './defects.js'
import { addressLine } from '../../app/format.js'
import {
  documentKindOf,
  documentStatusOf,
  jobKindLabel,
  jobKindOf,
  jobStatusLabel,
  jobStatusOf,
} from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { JobAppliances } from './appliances.js'
import { InstallationPanel } from './installation.js'
import { UrgentRepairNote } from '../../app/service-calls.js'
import { JobContacts } from './contacts.js'
import { JobFiles } from './files.js'
import { JobNotes } from './notes.js'
import { InstallationProtocols } from './protocol.js'
import { shownStatus } from './report.js'
import { SiteAccessPanel } from './access.js'
import { JobAppointmentCard } from './appointments.js'
import { JobInstructionsCard } from './call-instructions.js'
import { JobTasks } from './tasks.js'
import { JobTime } from './time.js'
import { SiteHeader } from '../header.js'
import { BesideList } from './jobs.js'

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
      setTrouble(refusalFor(made))

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
 * The delivery notes of the job (#299), made in the office out of its order
 * confirmation: here to be read and, if the recipient wants to, signed. Only
 * where the job has one.
 */
function JobDeliveryNotes({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const documents = useRelated('documents', 'jobId', jobId)
  const signatures = useRecords('document_signatures')
  const notes = documents.filter((document) => documentKindOf(document) === 'delivery_note')

  if (notes.length === 0) {
    return null
  }

  return (
    <Panel title="Lieferscheine">
      <SiteRows label="Lieferscheine">
        {notes.map((note) => (
          <SiteRow
            key={String(note['id'])}
            to={`/auftraege/${jobId}/lieferscheine/${String(note['id'])}`}
            title={`Lieferschein vom ${date(note['documentDate'])}`}
            right={
              <DocumentState
                status={shownStatus(
                  documentStatusOf(note),
                  signatures.find(
                    (signature) => String(signature['documentId']) === String(note['id']),
                  ) ?? null,
                )}
              />
            }
          />
        ))}
      </SiteRows>
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
          ...(maybeText(job, 'emergencyAt')
            ? [
                {
                  label: 'Notdiensteinsatz',
                  value: `Anruf ${berlinMoment(text(job, 'emergencyAt'))} Uhr`,
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

  // The ways into the site, when this device holds them (#286).
  // Only at an open job, as it stands on the device: a job closed here
  // without a network takes the ways in off the screen at once, not at the
  // next exchange (Greptile on #445).
  const access =
    site && (status === 'active' || status === 'draft') ? (
      <SiteAccessPanel siteId={String(site['id'])} />
    ) : null

  const plant = installation ? (
    <InstallationPanel
      installation={installation}
      base={`/auftraege/${jobId}`}
      protocols={
        <InstallationProtocols jobId={jobId} installationId={String(installation['id'])} />
      }
    />
  ) : null

  // The appliances of the site after DGUV Vorschrift 3, under the installation (#303).
  const appliances = site ? <JobAppliances jobId={jobId} siteId={String(site['id'])} /> : null

  // For a service call it is the request the call was about (#292), first on
  // the sheet; for a project what the office wants done.
  const service = jobKindOf(job) === 'service'
  const todo = maybeText(job, 'description') ? (
    <Panel title={service ? 'Anliegen' : 'Was zu tun ist'}>
      <p className="text-[17px] leading-[1.45] whitespace-pre-line [overflow-wrap:anywhere]">
        {text(job, 'description')}
      </p>
    </Panel>
  ) : null

  const end = (
    <div className="flex flex-col gap-2">
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      {status === 'completed' ? (
        <SiteText muted>Dieser Auftrag ist abgeschlossen.</SiteText>
      ) : status === 'cancelled' ? (
        // A job the office cancelled stays on the devices for 30 days (#735).
        // Finishing it is refused by the sync, so it is not offered.
        <SiteText muted>Dieser Auftrag ist abgebrochen.</SiteText>
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
    </div>
  )

  // The appointment, the mark of an urgent repair and the instructions of a
  // service call (#292), the job sheet of the board "Auftragszettel".
  const appointment = <JobAppointmentCard jobId={jobId} />
  const urgent = job['urgentRepair'] === true ? <UrgentRepairNote site /> : null
  const instructions = <JobInstructionsCard job={job} />
  const contacts = <JobContacts job={job} />
  const lineage = <JobLineage job={job} />
  // What happened on site (#220), under what the office wants done, as the
  // board "Auftrag, ganze Seite" puts the two together.
  const notes = (
    <>
      <JobNotes job={job} />
      {/* What is wrong with the work, under what happened (#311). */}
      <JobDefects job={job} />
    </>
  )
  const time = <JobTime job={job} />
  const writing = (
    <>
      <JobReports job={job} />
      <JobDeliveryNotes job={job} />
      {/* The acceptance of the job after § 640 BGB (#310). */}
      <JobAcceptance job={job} />
    </>
  )
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
            {appointment}
            {urgent}
            {service ? todo : null}
            {where}
            {access}
            {instructions}
            {plant}
            {appliances}
            {contacts}
            {lineage}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {service ? null : todo}
            {notes}
            {writing}
            {time}
            {files}
            {tasks}
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

      {appointment}
      {urgent}
      {service ? todo : null}
      {where}
      {access}
      {instructions}
      {contacts}
      {lineage}
      {plant}
      {appliances}
      {service ? null : todo}
      {notes}
      {time}
      {writing}
      {files}
      {tasks}
      {end}
    </SiteScreen>
  )
}
