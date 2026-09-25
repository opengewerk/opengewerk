import { installationKinds, type RecordState } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { House, Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, cardLink, Cell, Column, Panel, TablePanel } from '../../components/index.js'
import { addressLine, countryOptions, date } from '../../app/format.js'
import { installationKindLabel, installationKindOf, jobStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { RecordForm, asTextOrNull } from '../../app/record-form.js'
import type { FormField } from '../../app/record-form.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync, useSyncStatus } from '../../sync/provider.js'
import { Empty, FactList, PageHead, RecordColumns, Screen } from '../kit.js'
import { ListCard, ListScreen } from '../list.js'
import type { ListColumn, ListSort } from '../list.js'
import { FilesPanel } from './attachments.js'
import { ContactsSection } from './contacts.js'
import { placeOf } from './customers.js'
import { JobsPanel } from './job-table.js'
import { NewJobForm } from './jobs.js'
import { TasksSection } from './tasks.js'

const siteFields: readonly FormField[] = [
  {
    name: 'designation',
    label: 'Bezeichnung',
    required: true,
    hint: 'Wie die Leute vor Ort es nennen: Haus 3, Lager Nord.',
  },
  { name: 'street', label: 'Straße' },
  { name: 'houseNumber', label: 'Hausnummer' },
  { name: 'postalCode', label: 'PLZ', numeric: true },
  { name: 'city', label: 'Ort' },
  { name: 'country', label: 'Land', options: countryOptions },
  { name: 'notes', label: 'Notizen' },
]

export const installationFields: readonly FormField[] = [
  { name: 'designation', label: 'Bezeichnung', required: true },
  {
    name: 'kind',
    label: 'Art',
    required: true,
    options: installationKinds.map((kind) => ({ value: kind, label: installationKindLabel[kind] })),
  },
  { name: 'manufacturer', label: 'Hersteller' },
  { name: 'model', label: 'Typ' },
  { name: 'serialNumber', label: 'Seriennummer' },
  { name: 'commissionedOn', label: 'In Betrieb seit', kind: 'date' },
  {
    name: 'warrantyEndsOn',
    label: 'Gewährleistung bis',
    kind: 'date',
    hint: 'Die Fristen-Engine wacht später darüber.',
  },
  { name: 'notes', label: 'Notizen' },
]

export function asInstallation(values: Record<string, string>) {
  return {
    designation: values['designation']?.trim() ?? '',
    kind: values['kind'] ?? 'other',
    manufacturer: asTextOrNull(values['manufacturer']),
    model: asTextOrNull(values['model']),
    serialNumber: asTextOrNull(values['serialNumber']),
    commissionedOn: asTextOrNull(values['commissionedOn']),
    warrantyEndsOn: asTextOrNull(values['warrantyEndsOn']),
    notes: asTextOrNull(values['notes']),
  }
}

/** "bis 04.11.2024", or nothing where no warranty is known. */
export function warrantyText(installation: RecordState): string {
  return maybeText(installation, 'warrantyEndsOn')
    ? `bis ${date(installation['warrantyEndsOn'])}`
    : ''
}

/** The last change first: "Sortiert nach: Zuletzt geändert", as the list boards do. */
export const lastChanged: ListSort = {
  id: 'changed',
  label: 'Zuletzt geändert',
  compare: (left, right) =>
    text(right, 'updatedAt').localeCompare(text(left, 'updatedAt')) ||
    String(right['id']).localeCompare(String(left['id'])),
}

/** A count of what is open: amber and bold when there is something, grey when not. */
function OpenCount({ value }: { readonly value: number }) {
  return value > 0 ? (
    <span className="font-semibold text-waiting">{value}</span>
  ) : (
    <span className="text-ink-faint">0</span>
  )
}

/**
 * All sites of the business, `objekte_liste()` of the canvas (#219): until now
 * a site was only found through its customer.
 */
export function SiteList() {
  const sites = useRecords('sites')
  const customers = useRecords('customers')
  const installations = useRecords('installations')
  const jobs = useRecords('jobs')

  const counts = useMemo(() => {
    const installed = new Map<string, number>()
    const running = new Map<string, number>()

    for (const installation of installations) {
      const key = text(installation, 'siteId')

      installed.set(key, (installed.get(key) ?? 0) + 1)
    }

    for (const job of jobs) {
      if (jobStatusOf(job) === 'active') {
        const key = text(job, 'siteId')

        running.set(key, (running.get(key) ?? 0) + 1)
      }
    }

    return { installed, running }
  }, [installations, jobs])

  const customerName = (row: RecordState) =>
    text(
      customers.find((customer) => String(customer['id']) === text(row, 'customerId')) ?? null,
      'name',
    )

  const columns: readonly ListColumn[] = [
    { id: 'designation', header: 'Bezeichnung', value: (row) => text(row, 'designation') },
    { id: 'customer', header: 'Kunde', value: customerName, width: 'w-[230px]' },
    { id: 'place', header: 'Ort', value: placeOf, width: 'w-[170px]', muted: true },
    {
      id: 'installations',
      header: 'Anlagen',
      value: (row) => counts.installed.get(String(row['id'])) ?? 0,
      align: 'right',
      width: 'w-[80px]',
      wideOnly: true,
    },
    {
      id: 'open',
      header: 'Offen',
      value: (row) => counts.running.get(String(row['id'])) ?? 0,
      cell: (row) => <OpenCount value={counts.running.get(String(row['id'])) ?? 0} />,
      align: 'right',
      width: 'w-[80px]',
    },
  ]

  return (
    <ListScreen
      title="Objekte"
      caption="Alle Objekte des Betriebs"
      rows={sites}
      columns={columns}
      alsoSearched={(row) => text(row, 'street')}
      hrefFor={(row) => `/objekte/${String(row['id'])}`}
      searchLabel="Objekte durchsuchen"
      searchPlaceholder="Bezeichnung, Kunde, Ort …"
      filters={[
        {
          id: 'open',
          label: 'Mit offenem Auftrag',
          test: (row) => (counts.running.get(String(row['id'])) ?? 0) > 0,
        },
      ]}
      sorts={[
        lastChanged,
        {
          id: 'designation',
          label: 'Bezeichnung',
          compare: (left, right) =>
            text(left, 'designation').localeCompare(text(right, 'designation'), 'de'),
        },
      ]}
      card={(row) => (
        <ListCard
          to={`/objekte/${String(row['id'])}`}
          title={text(row, 'designation')}
          sub={[customerName(row), placeOf(row)].filter(Boolean).join(' · ')}
        />
      )}
      empty={{
        icon: House,
        title: 'Noch kein Objekt angelegt',
        text: 'Ein Objekt ist das Gebäude, zu dem ein Auftrag fährt. Es entsteht am Kunden, unter „Objekte“.',
      }}
    />
  )
}

/**
 * One site, `objekt()` of the canvas: its installations, jobs and files at the
 * left, the facts, the people there and the tasks at the right.
 */
export function SiteScreen() {
  const { siteId } = useParams({ strict: false }) as { siteId?: string }
  const client = useSync()
  const status = useSyncStatus()
  const site = useRecord('sites', siteId)
  const customer = useRecord('customers', site ? String(site['customerId']) : undefined)
  const installations = useRelated('installations', 'siteId', siteId)
  const jobs = useRelated('jobs', 'siteId', siteId)
  const writes = useMay('site.write')
  const createsInstallations = useMay('installation.write')
  const createsJobs = useMay('job.write')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState<'installation' | 'job' | null>(null)
  const navigate = useNavigate()

  if (!site || !siteId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/objekte', label: 'Objekte' }]} />
        <Empty>Dieses Objekt gibt es nicht mehr, oder dieses Gerät kennt es noch nicht.</Empty>
      </Screen>
    )
  }

  const customerId = String(site['customerId'])
  const offline = client.needsConnection('sites') && !status.online

  const installationForm =
    adding === 'installation' ? (
      <RecordForm
        fields={installationFields}
        submitLabel="Anlage anlegen"
        onCancel={() => {
          setAdding(null)
        }}
        onSubmit={async (values) => {
          const made = await client.create('installations', { ...asInstallation(values), siteId })

          if (made.outcome === 'queued') {
            setAdding(null)
          }

          return made
        }}
      />
    ) : null

  const jobForm =
    adding === 'job' ? (
      <NewJobForm
        customerId={customerId}
        siteId={siteId}
        onDone={() => {
          setAdding(null)
        }}
      />
    ) : null

  return (
    <Screen>
      <PageHead
        title={text(site, 'designation')}
        crumbs={[
          { to: '/', label: 'Kunden' },
          ...(customer ? [{ to: `/kunden/${customerId}`, label: text(customer, 'name') }] : []),
        ]}
        sub={
          addressLine(site) + (client.isPending('sites', siteId) ? ' · noch nicht übertragen' : '')
        }
        actions={
          <>
            {writes ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  setEditing(true)
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
            {createsInstallations ? (
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  setAdding('installation')
                }}
              >
                Anlage anlegen
              </Button>
            ) : null}
          </>
        }
      />

      <RecordColumns
        main={
          <>
            {installations.length === 0 ? (
              <Panel
                title="Anlagen"
                action={
                  createsInstallations && adding !== 'installation' ? (
                    <Button size="small" icon={Plus} onClick={() => setAdding('installation')}>
                      Anlage anlegen
                    </Button>
                  ) : null
                }
              >
                {installationForm ?? (
                  <p className="text-[13px] leading-[1.4] text-ink-muted">
                    Noch keine Anlage. Eine Anlage ist, was im Gebäude steht und betreut wird: PV,
                    Speicher, Zähler, Zählerschrank, Wallbox, Heizung.
                  </p>
                )}
              </Panel>
            ) : (
              <TablePanel
                title="Anlagen"
                caption="Anlagen am Objekt"
                lead={installationForm}
                cards={installations.map((installation) => {
                  const id = String(installation['id'])
                  const since = maybeText(installation, 'commissionedOn')

                  return {
                    key: id,
                    title: (
                      <Link to={`/anlagen/${id}`} className={cardLink}>
                        {text(installation, 'designation')}
                      </Link>
                    ),
                    sub: [
                      installationKindLabel[installationKindOf(installation)],
                      text(installation, 'manufacturer'),
                      since ? `in Betrieb seit ${date(since)}` : '',
                    ]
                      .filter((part) => part !== '')
                      .join(' · '),
                  }
                })}
                action={
                  createsInstallations && adding !== 'installation' ? (
                    <Button size="small" icon={Plus} onClick={() => setAdding('installation')}>
                      Anlage anlegen
                    </Button>
                  ) : null
                }
              >
                <thead>
                  <tr>
                    <Column>Bezeichnung</Column>
                    <Column className="w-[130px]">Art</Column>
                    <Column className="w-[120px]">Hersteller</Column>
                    <Column className="w-[120px]">In Betrieb seit</Column>
                    <Column className="w-[130px]">Gewährleistung</Column>
                  </tr>
                </thead>
                <tbody>
                  {installations.map((installation) => {
                    const id = String(installation['id'])

                    return (
                      <tr
                        key={id}
                        className="cursor-pointer hover:bg-surface-sunken"
                        onClick={(event) => {
                          if (!(event.target as HTMLElement).closest('a, button')) {
                            void navigate({ to: `/anlagen/${id}` })
                          }
                        }}
                      >
                        <Cell>
                          <Link
                            to={`/anlagen/${id}`}
                            className="text-inherit no-underline hover:underline"
                          >
                            {text(installation, 'designation')}
                          </Link>
                        </Cell>
                        <Cell>{installationKindLabel[installationKindOf(installation)]}</Cell>
                        <Cell>{text(installation, 'manufacturer')}</Cell>
                        <Cell className="numeric">
                          {maybeText(installation, 'commissionedOn')
                            ? date(installation['commissionedOn'])
                            : ''}
                        </Cell>
                        <Cell className="numeric">{warrantyText(installation)}</Cell>
                      </tr>
                    )
                  })}
                </tbody>
              </TablePanel>
            )}

            <JobsPanel
              caption="Aufträge am Objekt"
              jobs={jobs}
              columns={[
                { key: 'number', width: 'w-[110px]' },
                { key: 'kind', width: 'w-[120px]' },
                { key: 'status', width: 'w-[130px]' },
              ]}
              lead={jobForm}
              action={
                createsJobs && adding !== 'job' ? (
                  <Button size="small" icon={Plus} onClick={() => setAdding('job')}>
                    Auftrag anlegen
                  </Button>
                ) : null
              }
              empty="Für dieses Objekt läuft noch kein Auftrag."
            />

            <FilesPanel
              field="siteId"
              id={siteId}
              home={{ customerId, siteId }}
              empty="Noch keine Datei am Objekt."
            />
          </>
        }
        side={
          <>
            <Panel title="Objekt">
              {editing ? (
                <RecordForm
                  fields={siteFields}
                  record={site}
                  submitLabel="Speichern"
                  disabled={offline}
                  disabledReason={
                    offline
                      ? 'Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.'
                      : undefined
                  }
                  onCancel={() => {
                    setEditing(false)
                  }}
                  onSubmit={async (values) => {
                    const saved = await client.update('sites', siteId, {
                      designation: values['designation']?.trim() ?? '',
                      street: asTextOrNull(values['street']),
                      houseNumber: asTextOrNull(values['houseNumber']),
                      postalCode: asTextOrNull(values['postalCode']),
                      city: asTextOrNull(values['city']),
                      country: values['country'] ?? 'DE',
                      notes: asTextOrNull(values['notes']),
                    })

                    if (saved.outcome === 'queued') {
                      setEditing(false)
                    }

                    return saved
                  }}
                />
              ) : (
                <FactList
                  keyWidth={90}
                  facts={[
                    {
                      label: 'Kunde',
                      value: customer ? (
                        <Link
                          to={`/kunden/${customerId}`}
                          className="text-copper-text underline underline-offset-2"
                        >
                          {text(customer, 'name')}
                        </Link>
                      ) : null,
                    },
                    { label: 'Anschrift', value: addressLine(site) },
                    { label: 'Notizen', value: maybeText(site, 'notes') },
                  ]}
                />
              )}
            </Panel>
            <ContactsSection
              parent={{ siteId }}
              empty="Noch kein Ansprechpartner am Objekt. Etwa ein Mieter oder der Hausmeister."
            />
            <TasksSection
              field="siteId"
              id={siteId}
              links={{ customerId, siteId }}
              empty="Für dieses Objekt ist keine Aufgabe offen."
            />
          </>
        }
      />
    </Screen>
  )
}
