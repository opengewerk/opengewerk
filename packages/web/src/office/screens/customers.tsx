import { customerKinds, type RecordState } from '@opengewerk/domain'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowRight, Check, Clock, Pencil, Plus, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import {
  Button,
  cardLink,
  Cell,
  Column,
  Field,
  Panel,
  SelectField,
  Status,
  TablePanel,
} from '../../components/index.js'
import { useThreeColumns } from '../../components/band.js'
import { addressLine, countryOptions, date, euros } from '../../app/format.js'
import {
  customerKindLabel,
  customerKindOf,
  documentKindLabel,
  documentKindOf,
  jobStatusOf,
} from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { RecordForm, asBoolean, asTextOrNull, yesOrNo } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import type { EditResult } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync, useSyncStatus } from '../../sync/provider.js'
import { Empty, FactList, NoteBox, PageHead, RecordColumns, Screen } from '../kit.js'
import { ListCard, ListScreen } from '../list.js'
import type { ListColumn, ListFilter } from '../list.js'
import { FilesPanel } from './attachments.js'
import { ContactsSection } from './contacts.js'
import { DocumentMarker } from './document-marker.js'
import { useGrossByDocument } from './document-gross.js'
import { JobsPanel } from './job-table.js'
import { JobState, NewJobForm } from './jobs.js'
import { TasksSection } from './tasks.js'

const kindOptions = customerKinds.map((kind) => ({
  value: kind,
  label: customerKindLabel[kind],
}))

/** The values a form collected, in the types the record wants. */
function asCustomer(values: Record<string, string>) {
  return {
    name: values['name']?.trim() ?? '',
    kind: values['kind'] ?? 'private',
    email: asTextOrNull(values['email']),
    phone: asTextOrNull(values['phone']),
    street: asTextOrNull(values['street']),
    houseNumber: asTextOrNull(values['houseNumber']),
    postalCode: asTextOrNull(values['postalCode']),
    city: asTextOrNull(values['city']),
    country: values['country'] ?? 'DE',
    vatId: asTextOrNull(values['vatId']),
    buyerReference: asTextOrNull(values['buyerReference']),
    isBusiness: asBoolean(values['isBusiness']),
    isConstructionServiceRecipient: asBoolean(values['isConstructionServiceRecipient']),
    notes: asTextOrNull(values['notes']),
  }
}

/** "68159 Mannheim": where a customer or a site is, as a list shows it. */
export function placeOf(row: RecordState | null): string {
  return [maybeText(row, 'postalCode'), maybeText(row, 'city')].filter(Boolean).join(' ')
}

/** How many sites each customer has, and how many of its jobs are running. */
function useCountsByCustomer(): {
  readonly sites: ReadonlyMap<string, number>
  readonly running: ReadonlyMap<string, number>
} {
  const sites = useRecords('sites')
  const jobs = useRecords('jobs')

  return useMemo(() => {
    const bySites = new Map<string, number>()
    const byRunning = new Map<string, number>()

    for (const site of sites) {
      const key = text(site, 'customerId')

      bySites.set(key, (bySites.get(key) ?? 0) + 1)
    }

    for (const job of jobs) {
      if (jobStatusOf(job) === 'active') {
        const key = text(job, 'customerId')

        byRunning.set(key, (byRunning.get(key) ?? 0) + 1)
      }
    }

    return { sites: bySites, running: byRunning }
  }, [sites, jobs])
}

/** A count of what is open: amber and bold when there is something, grey when not. */
function OpenCount({ value }: { readonly value: number }) {
  return value > 0 ? (
    <span className="font-semibold text-waiting">{value}</span>
  ) : (
    <span className="text-ink-faint">0</span>
  )
}

/** "2 offen" on the card of a customer on a phone. */
function OpenBadge({ value }: { readonly value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-bold text-waiting">
      <Clock size={14} strokeWidth={2.3} aria-hidden="true" />
      {`${String(value)} offen`}
    </span>
  )
}

/** "Kunde seit 12.03.2024 · 41 Objekte · 2 Aufträge laufen". */
function customerSummary(customer: RecordState, sites: number, running: number): string {
  const since = maybeText(customer, 'createdAt')

  return [
    since ? `Kunde seit ${date(since)}` : null,
    sites === 1 ? '1 Objekt' : `${String(sites)} Objekte`,
    running === 1 ? '1 Auftrag läuft' : `${String(running)} Aufträge laufen`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function CustomerList() {
  const customers = useRecords('customers')
  const counts = useCountsByCustomer()
  const navigate = useNavigate()
  const creates = useMay('customer.create')

  const sorted = useMemo(
    () =>
      [...customers].sort((left, right) =>
        text(left, 'name').localeCompare(text(right, 'name'), 'de'),
      ),
    [customers],
  )

  const columns: readonly ListColumn[] = [
    { id: 'name', header: 'Name', value: (row) => text(row, 'name') },
    {
      id: 'kind',
      header: 'Art',
      value: (row) => customerKindLabel[customerKindOf(row)],
      width: 'w-[124px]',
      muted: true,
    },
    { id: 'place', header: 'Ort', value: placeOf, width: 'w-[150px]', muted: true },
    {
      id: 'sites',
      header: 'Objekte',
      value: (row) => counts.sites.get(String(row['id'])) ?? 0,
      align: 'right',
      width: 'w-[76px]',
      wideOnly: true,
    },
    {
      id: 'open',
      header: 'Offen',
      value: (row) => counts.running.get(String(row['id'])) ?? 0,
      cell: (row) => <OpenCount value={counts.running.get(String(row['id'])) ?? 0} />,
      align: 'right',
      width: 'w-[64px]',
    },
  ]

  // The chips in the order of the canvas, and a customer of every kind can be
  // found: the board has room for four, the business has five.
  const filters: readonly ListFilter[] = (
    ['business', 'private', 'property_management', 'general_contractor'] as const
  ).map((kind) => ({
    id: kind,
    label: customerKindLabel[kind],
    test: (row) => customerKindOf(row) === kind,
  }))

  const openNew = () => {
    void navigate({ to: '/kunden/neu' })
  }

  return (
    <ListScreen
      title="Kunden"
      caption="Alle Kunden des Betriebs"
      rows={sorted}
      columns={columns}
      alsoSearched={(row) => [text(row, 'vatId'), text(row, 'street')].join(' ')}
      hrefFor={(row) => `/kunden/${String(row['id'])}`}
      searchLabel="Kunden durchsuchen"
      searchPlaceholder="Name, Ort, Umsatzsteuer-Id …"
      filters={filters}
      primary={creates ? { label: 'Neuer Kunde', onPress: openNew } : undefined}
      card={(row) => {
        const running = counts.running.get(String(row['id'])) ?? 0

        return (
          <ListCard
            to={`/kunden/${String(row['id'])}`}
            title={text(row, 'name')}
            sub={[customerKindLabel[customerKindOf(row)], placeOf(row)].filter(Boolean).join(' · ')}
            right={running > 0 ? <OpenBadge value={running} /> : null}
          />
        )
      }}
      preview={(row) => <CustomerPreview customer={row} />}
      record={(row, close) => (
        <CustomerBeside key={String(row['id'])} customerId={String(row['id'])} onClose={close} />
      )}
      empty={{
        icon: Users,
        title: 'Noch kein Kunde angelegt',
        text: 'Ein Kunde ist der Anfang von allem: an ihm hängen Objekte, Anlagen, Aufträge und Belege. Der erste entsteht über „Neuer Kunde“.',
      }}
    />
  )
}

/**
 * What the list shows of the selected customer from 1600 pixels on, as
 * `preview()` of the board "Kunden, FHD": who, where, what runs, whom to call,
 * and the way into the record.
 */
function CustomerPreview({ customer }: { readonly customer: RecordState }) {
  const id = String(customer['id'])
  const navigate = useNavigate()
  const createsJobs = useMay('job.write')
  const sites = useRelated('sites', 'customerId', id)
  const jobs = useRelated('jobs', 'customerId', id)
  const contacts = useRelated('contacts', 'customerId', id)
  const running = jobs.filter((job) => jobStatusOf(job) === 'active')
  const email = maybeText(customer, 'email')

  return (
    <aside
      aria-label={`Vorschau: ${text(customer, 'name')}`}
      className="flex w-[420px] shrink-0 flex-col gap-4 rounded-[5px] border border-line bg-surface px-[18px] py-4"
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 grow">
          <h2 className="text-[19px] font-semibold [overflow-wrap:anywhere]">
            {text(customer, 'name')}
          </h2>
          <div className="mt-[3px] text-[13px] text-ink-faint">
            {customerSummary(customer, sites.length, running.length)
              .split(' · ')
              .slice(0, 2)
              .join(' · ')}
          </div>
        </div>
        <Status tone="neutral">{customerKindLabel[customerKindOf(customer)]}</Status>
      </div>

      <FactList
        keyWidth={92}
        facts={[
          { label: 'Anschrift', value: addressLine(customer) },
          { label: 'Telefon', value: maybeText(customer, 'phone') },
          {
            label: 'E-Mail',
            value: email ? (
              <a href={`mailto:${email}`} className="text-copper-text underline underline-offset-2">
                {email}
              </a>
            ) : null,
          },
          { label: 'USt-IdNr.', value: maybeText(customer, 'vatId') },
        ]}
      />

      <div>
        <PreviewLabel>Laufende Aufträge</PreviewLabel>
        {running.length === 0 ? (
          <p className="py-2 text-[13px] text-ink-muted">Gerade läuft kein Auftrag.</p>
        ) : (
          <ul className="text-[14px]">
            {running.map((job) => (
              <li
                key={String(job['id'])}
                className="flex items-center gap-2.5 border-b border-row py-2"
              >
                <Link
                  to={`/auftraege/${String(job['id'])}`}
                  className="text-[14px] font-medium text-copper-text underline underline-offset-2"
                >
                  {text(job, 'designation')}
                </Link>
                <JobState job={job} />
                <div className="grow" />
                <span className="numeric text-[13px] text-ink-faint">{text(job, 'number')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <PreviewLabel>Ansprechpartner</PreviewLabel>
        {contacts.length === 0 ? (
          <p className="py-2 text-[13px] text-ink-muted">Noch kein Ansprechpartner.</p>
        ) : (
          <ul className="text-[14px]">
            {contacts.map((contact) => (
              <li
                key={String(contact['id'])}
                className="border-b border-row py-1.5 last:border-b-0"
              >
                <b className="font-semibold">
                  {[maybeText(contact, 'givenName'), maybeText(contact, 'familyName')]
                    .filter(Boolean)
                    .join(' ')}
                </b>
                {maybeText(contact, 'role') ? `, ${text(contact, 'role')}` : ''}
                {maybeText(contact, 'phone') ? (
                  <>
                    <br />
                    <a
                      href={`tel:${text(contact, 'phone').replace(/[^\d+]/g, '')}`}
                      className="text-copper-text underline underline-offset-2"
                    >
                      {text(contact, 'phone')}
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/kunden/${id}`}
          className="inline-flex h-control min-h-tap items-center gap-[7px] rounded-control border border-ink bg-ink px-[14px] text-body font-semibold text-ground no-underline"
        >
          <ArrowRight size={15} strokeWidth={2.3} aria-hidden="true" />
          Akte öffnen
        </Link>
        {createsJobs ? (
          <Button
            icon={Plus}
            onClick={() => {
              // The form opens on the record, where the job then stands.
              void navigate({ to: `/kunden/${id}`, search: { neu: 'auftrag' } })
            }}
          >
            Auftrag anlegen
          </Button>
        ) : null}
      </div>
    </aside>
  )
}

function PreviewLabel({ children }: { readonly children: ReactNode }) {
  return (
    <h3 className="mb-0.5 font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
      {children}
    </h3>
  )
}

/**
 * The whole record beside the list from 2400 pixels on, as the boards
 * "Kunden, QHD" and "Kunden, UWQHD" draw it: in two columns, and in three from
 * 3000 pixels, in a frame with a cross that closes it.
 */
function CustomerBeside({
  customerId,
  onClose,
}: {
  readonly customerId: string
  readonly onClose: () => void
}) {
  const three = useThreeColumns()

  return (
    <section
      aria-label="Kundenakte"
      className="flex min-w-0 grow flex-col gap-3.5 rounded-[6px] border border-line bg-ground px-5 py-[18px]"
    >
      <CustomerRecord
        customerId={customerId}
        layout={three ? 'three' : 'beside'}
        onClose={onClose}
      />
    </section>
  )
}

export function CustomerScreen() {
  const { customerId } = useParams({ strict: false }) as { customerId?: string }

  return (
    <Screen>
      <CustomerRecord customerId={customerId} layout="screen" />
    </Screen>
  )
}

/**
 * The record of a customer, `kunde()` of the canvas: the head with the kind,
 * since when and how much, the objects, the jobs and the files at the left,
 * the facts, the people and the tasks at the right.
 *
 * Beside the list from 2400 pixels it is the record of the boards there:
 * objects, jobs and documents, in two columns or in three.
 */
function CustomerRecord({
  customerId,
  layout,
  onClose,
}: {
  readonly customerId: string | undefined
  readonly layout: 'screen' | 'beside' | 'three'
  readonly onClose?: () => void
}) {
  const client = useSync()
  const customer = useRecord('customers', customerId)
  const sites = useRelated('sites', 'customerId', customerId)
  const jobs = useRelated('jobs', 'customerId', customerId)
  const writes = useMay('customer.write')
  const createsJobs = useMay('job.write')
  // "Auftrag anlegen" in the preview beside the list leads here with the
  // form open.
  const search = useSearch({ strict: false }) as { readonly neu?: string }
  const [addingJob, setAddingJob] = useState(search.neu === 'auftrag')
  const navigate = useNavigate()

  if (!customer || !customerId) {
    return (
      <>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/', label: 'Kunden' }]} />
        <Empty>Diesen Kunden gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.</Empty>
      </>
    )
  }

  const running = jobs.filter((job) => jobStatusOf(job) === 'active').length
  const pending = client.isPending('customers', customerId)

  const head = (
    <PageHead
      title={text(customer, 'name')}
      crumbs={layout === 'screen' ? [{ to: '/', label: 'Kunden' }] : undefined}
      badges={<Status tone="neutral">{customerKindLabel[customerKindOf(customer)]}</Status>}
      sub={
        customerSummary(customer, sites.length, running) +
        (pending ? ' · noch nicht übertragen' : '')
      }
      actions={
        <>
          {writes ? (
            <Button
              icon={Pencil}
              onClick={() => {
                void navigate({ to: `/kunden/${customerId}/bearbeiten` })
              }}
            >
              Bearbeiten
            </Button>
          ) : null}
          {createsJobs ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                setAddingJob(true)
              }}
            >
              Auftrag anlegen
            </Button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              aria-label="Akte schließen"
              onClick={onClose}
              className="flex size-control cursor-pointer items-center justify-center rounded-control border border-control text-ink-muted"
            >
              <X size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </>
      }
    />
  )

  const sitesPanel = <CustomerSites customerId={customerId} sites={sites} />
  const jobsPanel = (
    <CustomerJobs customerId={customerId} jobs={jobs} adding={addingJob} onAdding={setAddingJob} />
  )
  const facts = <CustomerFacts customer={customer} />
  const contacts = (
    <ContactsSection
      parent={{ customerId }}
      empty="Noch kein Ansprechpartner. Bei einer Hausverwaltung etwa die Bauleitung oder die Buchhaltung."
    />
  )
  const tasks = (
    <TasksSection
      field="customerId"
      id={customerId}
      links={{ customerId }}
      empty="Für diesen Kunden ist keine Aufgabe offen."
    />
  )

  if (layout === 'three') {
    return (
      <>
        {head}
        <div className="flex items-start gap-3.5">
          <div className="flex min-w-0 basis-0 grow flex-col gap-3">
            {sitesPanel}
            {jobsPanel}
          </div>
          <div className="flex min-w-0 basis-0 grow flex-col gap-3">
            <CustomerDocuments customerId={customerId} />
            {tasks}
          </div>
          <div className="flex w-[380px] shrink-0 flex-col gap-3">
            {facts}
            {contacts}
          </div>
        </div>
      </>
    )
  }

  if (layout === 'beside') {
    return (
      <>
        {head}
        <div className="flex items-start gap-3.5">
          <div className="flex min-w-0 grow flex-col gap-3">
            {sitesPanel}
            {jobsPanel}
            <CustomerDocuments customerId={customerId} />
          </div>
          <div className="flex w-[340px] shrink-0 flex-col gap-3">
            {facts}
            {contacts}
            {tasks}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {head}
      <RecordColumns
        main={
          <>
            {sitesPanel}
            {jobsPanel}
            <FilesPanel
              field="customerId"
              id={customerId}
              home={{ customerId }}
              empty="Noch keine Datei beim Kunden. Was an einem Objekt oder Auftrag abgelegt wird, steht auch hier."
            />
          </>
        }
        side={
          <>
            {facts}
            {contacts}
            {tasks}
          </>
        }
      />
    </>
  )
}

/** "Stammdaten": what a document needs to know about the customer. */
function CustomerFacts({ customer }: { readonly customer: RecordState }) {
  const email = maybeText(customer, 'email')

  return (
    <Panel title="Stammdaten">
      <FactList
        keyWidth={100}
        facts={[
          { label: 'Anschrift', value: addressLine(customer) },
          {
            label: 'E-Mail',
            value: email ? (
              <a href={`mailto:${email}`} className="text-copper-text underline underline-offset-2">
                {email}
              </a>
            ) : null,
          },
          { label: 'Telefon', value: maybeText(customer, 'phone') },
          { label: 'USt-IdNr.', value: maybeText(customer, 'vatId') },
          { label: 'Käuferreferenz', value: maybeText(customer, 'buyerReference') },
          { label: 'Unternehmen', value: customer['isBusiness'] === true ? 'Ja' : 'Nein' },
          {
            label: 'Bauleistung',
            value:
              customer['isConstructionServiceRecipient'] === true
                ? 'Ja, § 13b UStG'
                : 'Nein, § 13b UStG',
          },
          { label: 'Notizen', value: maybeText(customer, 'notes') },
        ]}
      />
    </Panel>
  )
}

/** "Objekte": the buildings of the customer, with their installations and what runs there. */
function CustomerSites({
  customerId,
  sites,
}: {
  readonly customerId: string
  readonly sites: readonly RecordState[]
}) {
  const client = useSync()
  const creates = useMay('site.write')
  const installations = useRecords('installations')
  const jobs = useRecords('jobs')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()

  const sorted = [...sites].sort((left, right) =>
    text(left, 'designation').localeCompare(text(right, 'designation'), 'de'),
  )

  const form = adding ? (
    <RecordForm
      fields={[
        { name: 'designation', label: 'Bezeichnung', required: true },
        { name: 'street', label: 'Straße' },
        { name: 'houseNumber', label: 'Hausnummer' },
        { name: 'postalCode', label: 'PLZ', numeric: true },
        { name: 'city', label: 'Ort' },
        { name: 'country', label: 'Land', options: countryOptions },
        { name: 'notes', label: 'Notizen' },
      ]}
      submitLabel="Objekt anlegen"
      onCancel={() => {
        setAdding(false)
      }}
      onSubmit={async (values) => {
        const made = await client.create('sites', {
          customerId,
          designation: values['designation']?.trim() ?? '',
          street: asTextOrNull(values['street']),
          houseNumber: asTextOrNull(values['houseNumber']),
          postalCode: asTextOrNull(values['postalCode']),
          city: asTextOrNull(values['city']),
          country: values['country'] ?? 'DE',
          notes: asTextOrNull(values['notes']),
        })

        if (made.outcome === 'queued') {
          setAdding(false)
        }

        return made
      }}
    />
  ) : null

  const action =
    creates && !adding ? (
      <Button
        size="small"
        icon={Plus}
        onClick={() => {
          setAdding(true)
        }}
      >
        Objekt anlegen
      </Button>
    ) : null

  if (sorted.length === 0) {
    return (
      <Panel title="Objekte" action={action}>
        {form}
        {adding ? null : (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Noch kein Objekt. Ein Objekt ist das Gebäude, zu dem ein Auftrag fährt.
          </p>
        )}
      </Panel>
    )
  }

  const count = (id: string) =>
    installations.filter((installation) => text(installation, 'siteId') === id).length
  const running = (id: string) =>
    jobs.filter((job) => text(job, 'siteId') === id && jobStatusOf(job) === 'active').length
  const cards = sorted.map((site) => {
    const id = String(site['id'])
    const installed = count(id)
    const open = running(id)

    return {
      key: id,
      title: (
        <Link to={`/objekte/${id}`} className={cardLink}>
          {text(site, 'designation')}
        </Link>
      ),
      sub: [addressLine(site), installed === 1 ? '1 Anlage' : `${String(installed)} Anlagen`]
        .filter((part) => part !== '')
        .join(' · '),
      right: open > 0 ? <OpenBadge value={open} /> : null,
    }
  })

  return (
    <TablePanel
      title="Objekte"
      caption="Objekte des Kunden"
      action={action}
      lead={form}
      cards={cards}
    >
      <thead>
        <tr>
          <Column>Bezeichnung</Column>
          <Column className="w-[240px]">Anschrift</Column>
          <Column numeric className="w-[76px]">
            Anlagen
          </Column>
          <Column numeric className="w-[70px]">
            Offen
          </Column>
        </tr>
      </thead>
      <tbody>
        {sorted.map((site) => {
          const id = String(site['id'])

          return (
            <tr
              key={id}
              className="cursor-pointer hover:bg-surface-sunken"
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('a')) {
                  void navigate({ to: `/objekte/${id}` })
                }
              }}
            >
              <Cell>
                <Link to={`/objekte/${id}`} className="text-inherit no-underline hover:underline">
                  {text(site, 'designation')}
                </Link>
              </Cell>
              <Cell>{addressLine(site)}</Cell>
              <Cell numeric>{count(id)}</Cell>
              <Cell numeric>
                <OpenCount value={running(id)} />
              </Cell>
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}

/** "Aufträge": the jobs of the customer, the new one in a form over them. */
function CustomerJobs({
  customerId,
  jobs,
  adding,
  onAdding,
}: {
  readonly customerId: string
  readonly jobs: readonly RecordState[]
  readonly adding: boolean
  readonly onAdding: (adding: boolean) => void
}) {
  const writes = useMay('job.write')

  return (
    <JobsPanel
      caption="Aufträge des Kunden"
      jobs={jobs}
      columns={[
        { key: 'number', width: 'w-[106px]' },
        { key: 'kind', width: 'w-[104px]' },
        { key: 'status', width: 'w-[124px]' },
        { key: 'site', width: 'w-[150px]' },
      ]}
      lead={
        adding ? (
          <NewJobForm
            customerId={customerId}
            onDone={() => {
              onAdding(false)
            }}
          />
        ) : null
      }
      action={
        writes && !adding ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              onAdding(true)
            }}
          >
            Auftrag anlegen
          </Button>
        ) : null
      }
      empty="Für diesen Kunden läuft noch kein Auftrag."
    />
  )
}

/** "Belege": the documents of the customer, beside the list from 2400 pixels. */
function CustomerDocuments({ customerId }: { readonly customerId: string }) {
  const documents = useRelated('documents', 'customerId', customerId)
  const gross = useGrossByDocument()
  const navigate = useNavigate()

  if (documents.length === 0) {
    return (
      <Panel title="Belege">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Noch kein Beleg für diesen Kunden.
        </p>
      </Panel>
    )
  }

  const sorted = [...documents].sort((left, right) =>
    String(right['id']).localeCompare(String(left['id'])),
  )

  const cards = sorted.map((document) => {
    const id = String(document['id'])
    const amount = gross.get(id)

    return {
      key: id,
      title: (
        <Link to={`/belege/${id}`} className={cardLink}>
          {documentKindLabel[documentKindOf(document)]}
        </Link>
      ),
      sub: [text(document, 'number'), amount === null || amount === undefined ? '' : euros(amount)]
        .filter((part) => part !== '')
        .join(' · '),
      right: <DocumentMarker document={document} />,
    }
  })

  return (
    <TablePanel title="Belege" caption="Belege des Kunden" cards={cards}>
      <thead>
        <tr>
          <Column>Art</Column>
          <Column className="w-[116px]">Nummer</Column>
          <Column className="w-[150px]">Status</Column>
          <Column numeric className="w-[110px]">
            Betrag
          </Column>
        </tr>
      </thead>
      <tbody>
        {sorted.map((document) => {
          const id = String(document['id'])
          const amount = gross.get(id)

          return (
            <tr
              key={id}
              className="cursor-pointer hover:bg-surface-sunken"
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('a')) {
                  void navigate({ to: `/belege/${id}` })
                }
              }}
            >
              <Cell>
                <Link to={`/belege/${id}`} className="text-inherit no-underline hover:underline">
                  {documentKindLabel[documentKindOf(document)]}
                </Link>
              </Cell>
              <Cell className="numeric">{text(document, 'number')}</Cell>
              <Cell>
                <DocumentMarker document={document} />
              </Cell>
              <Cell numeric>{amount === null || amount === undefined ? '' : euros(amount)}</Cell>
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}

/** The fields of a customer, in the cards of the board "Neuer Kunde". */
interface CustomerDraft {
  name: string
  kind: string
  street: string
  houseNumber: string
  postalCode: string
  city: string
  country: string
  email: string
  phone: string
  vatId: string
  buyerReference: string
  isBusiness: string
  isConstructionServiceRecipient: string
  notes: string
}

function draftOf(customer: RecordState | null): CustomerDraft {
  const held = (field: string) =>
    typeof customer?.[field] === 'string' ? String(customer[field]) : ''

  return {
    name: held('name'),
    kind: held('kind') || 'private',
    street: held('street'),
    houseNumber: held('houseNumber'),
    postalCode: held('postalCode'),
    city: held('city'),
    country: held('country') || 'DE',
    email: held('email'),
    phone: held('phone'),
    vatId: held('vatId'),
    buyerReference: held('buyerReference'),
    isBusiness: customer?.['isBusiness'] === true ? 'true' : 'false',
    isConstructionServiceRecipient:
      customer?.['isConstructionServiceRecipient'] === true ? 'true' : 'false',
    notes: held('notes'),
  }
}

export function NewCustomerScreen() {
  return <CustomerFormScreen customerId={undefined} />
}

export function EditCustomerScreen() {
  const { customerId } = useParams({ strict: false }) as { customerId?: string }

  return <CustomerFormScreen customerId={customerId} />
}

/**
 * A customer to create or to change, `neuer_kunde()` of the canvas: the
 * customer, the address and how to reach them at the left, tax and notes at
 * the right, and the two buttons in the head.
 *
 * Changing one needs a connection, which ADR 0005 decides for master data;
 * the form says so before anybody fills it in.
 */
function CustomerFormScreen({ customerId }: { readonly customerId: string | undefined }) {
  const client = useSync()
  const status = useSyncStatus()
  const navigate = useNavigate()
  const customer = useRecord('customers', customerId)
  const [draft, setDraft] = useState<CustomerDraft>(() => draftOf(customer))
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [wrong, setWrong] = useState<readonly string[]>([])
  const editing = customerId !== undefined
  const offline = editing && client.needsConnection('customers') && !status.online

  if (editing && !customer) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/', label: 'Kunden' }]} />
        <Empty>Diesen Kunden gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.</Empty>
      </Screen>
    )
  }

  const set = (field: keyof CustomerDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }
  const back = () => {
    void navigate({ to: editing ? `/kunden/${customerId}` : '/' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)
    setWrong([])
    setWorking(true)

    try {
      const values = asCustomer(draft as unknown as Record<string, string>)
      const result: EditResult = editing
        ? await client.update('customers', customerId, values)
        : await client.create('customers', values)

      if (result.outcome === 'refused') {
        setTrouble(refusalText[result.reason])
        setWrong(result.fields)

        return
      }

      await navigate({ to: `/kunden/${editing ? customerId : result.id}` })
    } finally {
      setWorking(false)
    }
  }

  const problem = (field: string) =>
    wrong.includes(field) ? 'Dieses Feld ist der Grund.' : undefined
  const input = (
    field: keyof CustomerDraft,
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      label={label}
      value={draft[field]}
      problem={problem(field)}
      onChange={(event) => {
        set(field)(event.target.value)
      }}
      {...extra}
    />
  )

  return (
    <Screen>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <PageHead
          title={editing ? `${text(customer, 'name')} bearbeiten` : 'Neuer Kunde'}
          crumbs={
            editing
              ? [
                  { to: '/', label: 'Kunden' },
                  { to: `/kunden/${customerId}`, label: text(customer, 'name') },
                ]
              : [{ to: '/', label: 'Kunden' }]
          }
          actions={
            <>
              <Button onClick={back} disabled={working}>
                Abbrechen
              </Button>
              <Button type="submit" tone="primary" icon={Check} disabled={working || offline}>
                {working ? 'Wird gespeichert' : editing ? 'Speichern' : 'Kunde anlegen'}
              </Button>
            </>
          }
        />

        {offline ? (
          <NoteBox tone="waiting">
            Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.
          </NoteBox>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="flex min-w-0 grow flex-col gap-3">
            <FormPanel title="Kunde">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                {input('name', 'Name', { required: true })}
                <SelectField
                  label="Art"
                  value={draft.kind}
                  options={kindOptions}
                  onChange={set('kind')}
                  required
                />
              </div>
            </FormPanel>
            <FormPanel title="Anschrift">
              <div className="flex flex-col gap-2.5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
                  {input('street', 'Straße')}
                  {input('houseNumber', 'Hausnummer')}
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]">
                  {input('postalCode', 'PLZ', { numeric: true })}
                  {input('city', 'Ort')}
                  <SelectField
                    label="Land"
                    value={draft.country}
                    options={countryOptions}
                    onChange={set('country')}
                  />
                </div>
                <NoteBox>
                  Ein Kunde im Ausland bekommt seine Rechnung als PDF, nicht als E-Rechnung.
                </NoteBox>
              </div>
            </FormPanel>
            <FormPanel title="Erreichbar">
              <div className="grid gap-3 sm:grid-cols-2">
                {input('email', 'E-Mail', { type: 'email' })}
                {input('phone', 'Telefon', { type: 'tel' })}
              </div>
            </FormPanel>
          </div>
          <div className="flex min-w-0 flex-col gap-3 lg:w-[420px] lg:shrink-0">
            <FormPanel title="Umsatzsteuer und E-Rechnung">
              <div className="flex flex-col gap-[11px]">
                {input('vatId', 'USt-IdNr.', { hint: 'Zum Beispiel DE123456789.' })}
                {input('buyerReference', 'Käuferreferenz', {
                  hint: 'Braucht die XRechnung. Eine Behörde nennt hier ihre Leitweg-ID.',
                })}
                <SelectField
                  label="Unternehmen im Sinne der Umsatzsteuer"
                  value={draft.isBusiness}
                  options={[...yesOrNo].reverse()}
                  onChange={set('isBusiness')}
                  hint="Entscheidet über die Pflicht zur E-Rechnung."
                />
                <SelectField
                  label="Bauleistungsempfänger nach §13b UStG"
                  value={draft.isConstructionServiceRecipient}
                  options={[...yesOrNo]}
                  onChange={set('isConstructionServiceRecipient')}
                  hint="Dann geht die Steuerschuld auf den Kunden über."
                />
              </div>
            </FormPanel>
            <FormPanel title="Notizen">{input('notes', 'Notizen')}</FormPanel>
          </div>
        </div>
      </form>
    </Screen>
  )
}

/** A card of a form, `form_section()` of the canvas: a little more room inside. */
function FormPanel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Panel title={title} roomy>
      {children}
    </Panel>
  )
}
