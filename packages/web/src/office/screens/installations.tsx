import type { RecordState } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Zap } from 'lucide-react'
import { useState } from 'react'

import { Button, Panel, Status } from '../../components/index.js'
import { date } from '../../app/format.js'
import { installationKindLabel, installationKindOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { RecordForm } from '../../app/record-form.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { Empty, FactList, PageHead, RecordColumns, Screen } from '../kit.js'
import { lastChanged, ListCard, ListScreen } from '../list.js'
import type { ListColumn } from '../list.js'
import { FilesPanel } from './attachments.js'
import { useBoards } from '../../app/electrical.js'
import { BoardsSection, ChartButton } from './boards.js'
import { JobsPanel } from './job-table.js'
import { NewJobForm } from './jobs.js'
import { ProtocolsSection } from './protocols.js'
import { asInstallation, installationFields, warrantyText } from './sites.js'

/**
 * All installations of the business, `anlagen_liste()` of the canvas (#219):
 * until now an installation was only found through its site.
 */
export function InstallationList() {
  const installations = useRecords('installations')
  const sites = useRecords('sites')
  const customers = useRecords('customers')

  const siteOf = (row: RecordState) =>
    sites.find((site) => String(site['id']) === text(row, 'siteId')) ?? null
  const customerOf = (row: RecordState) => {
    const site = siteOf(row)

    return site
      ? (customers.find((customer) => String(customer['id']) === text(site, 'customerId')) ?? null)
      : null
  }

  const columns: readonly ListColumn[] = [
    { id: 'designation', header: 'Bezeichnung', value: (row) => text(row, 'designation') },
    {
      id: 'kind',
      header: 'Art',
      value: (row) => installationKindLabel[installationKindOf(row)],
      width: 'w-[120px]',
    },
    {
      id: 'site',
      header: 'Objekt',
      value: (row) => text(siteOf(row), 'designation'),
      width: 'w-[190px]',
    },
    {
      id: 'customer',
      header: 'Kunde',
      value: (row) => text(customerOf(row), 'name'),
      width: 'w-[210px]',
      wideOnly: true,
    },
    {
      id: 'manufacturer',
      header: 'Hersteller',
      value: (row) => text(row, 'manufacturer'),
      cell: (row) =>
        maybeText(row, 'manufacturer') ?? <span className="text-ink-faint">nicht angegeben</span>,
      width: 'w-[110px]',
      wideOnly: true,
    },
    {
      id: 'commissioned',
      header: 'In Betrieb seit',
      value: (row) => text(row, 'commissionedOn'),
      cell: (row) =>
        maybeText(row, 'commissionedOn') ? (
          date(row['commissionedOn'])
        ) : (
          <span className="text-ink-faint">nicht angegeben</span>
        ),
      width: 'w-[120px]',
    },
  ]

  // The chips of the board, the kinds that are asked for most.
  const kinds = ['pv_system', 'battery', 'wallbox', 'meter_cabinet'] as const

  return (
    <ListScreen
      title="Anlagen"
      caption="Alle Anlagen des Betriebs"
      rows={installations}
      columns={columns}
      alsoSearched={(row) => [text(row, 'serialNumber'), text(row, 'model')].join(' ')}
      hrefFor={(row) => `/anlagen/${String(row['id'])}`}
      searchLabel="Anlagen durchsuchen"
      searchPlaceholder="Bezeichnung, Hersteller, Seriennummer …"
      filters={kinds.map((kind) => ({
        id: kind,
        label: installationKindLabel[kind],
        test: (row: RecordState) => installationKindOf(row) === kind,
      }))}
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
          to={`/anlagen/${String(row['id'])}`}
          title={text(row, 'designation')}
          sub={[installationKindLabel[installationKindOf(row)], text(siteOf(row), 'designation')]
            .filter(Boolean)
            .join(' · ')}
        />
      )}
      empty={{
        icon: Zap,
        title: 'Noch keine Anlage angelegt',
        text: 'Eine Anlage ist, was im Gebäude steht und betreut wird: PV, Speicher, Zähler, Zählerschrank, Wallbox, Heizung. Sie entsteht am Objekt.',
      }}
    />
  )
}

/**
 * One installation, `anlage()` of the canvas: its boards, protocols, jobs and
 * files at the left, its facts at the right, and the way into the structure
 * of boards, sections and circuits in the head.
 *
 * The PV structure below a PV system, inverters and strings, is not on this
 * screen yet: it arrives with phase 2.
 */
export function InstallationScreen() {
  const { installationId } = useParams({ strict: false }) as { installationId?: string }
  const client = useSync()
  const installation = useRecord('installations', installationId)
  const site = useRecord('sites', installation ? String(installation['siteId']) : undefined)
  const customer = useRecord('customers', site ? String(site['customerId']) : undefined)
  const jobs = useRelated('jobs', 'installationId', installationId)
  const boards = useBoards(installationId ?? '')
  const writes = useMay('installation.write')
  const createsJobs = useMay('job.write')
  const [editing, setEditing] = useState(false)
  const [addingJob, setAddingJob] = useState(false)
  const navigate = useNavigate()

  if (!installation || !installationId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/anlagen', label: 'Anlagen' }]} />
        <Empty>Diese Anlage gibt es nicht mehr, oder dieses Gerät kennt sie noch nicht.</Empty>
      </Screen>
    )
  }

  const firstBoard = boards[0]

  return (
    <Screen>
      <PageHead
        title={text(installation, 'designation')}
        crumbs={[
          { to: '/', label: 'Kunden' },
          ...(customer
            ? [{ to: `/kunden/${String(customer['id'])}`, label: text(customer, 'name') }]
            : []),
          ...(site
            ? [{ to: `/objekte/${String(site['id'])}`, label: text(site, 'designation') }]
            : []),
        ]}
        badges={
          <Status tone="neutral">{installationKindLabel[installationKindOf(installation)]}</Status>
        }
        actions={
          <>
            {boards.length > 0 ? <ChartButton installationId={installationId} /> : null}
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
            {firstBoard ? (
              <Button
                tone="primary"
                icon={Zap}
                onClick={() => {
                  void navigate({ to: `/verteiler/${String(firstBoard['id'])}` })
                }}
              >
                Anlagenstruktur öffnen
              </Button>
            ) : null}
          </>
        }
      />

      <RecordColumns
        main={
          <>
            <BoardsSection installationId={installationId} />
            <ProtocolsSection installationId={installationId} />
            <JobsPanel
              caption="Aufträge an der Anlage"
              jobs={jobs}
              columns={[
                { key: 'number', width: 'w-[110px]' },
                { key: 'status', width: 'w-[130px]' },
              ]}
              lead={
                addingJob && customer && site ? (
                  <NewJobForm
                    customerId={String(customer['id'])}
                    siteId={String(site['id'])}
                    installationId={installationId}
                    onDone={() => {
                      setAddingJob(false)
                    }}
                  />
                ) : null
              }
              action={
                createsJobs && customer && !addingJob ? (
                  <Button size="small" icon={Plus} onClick={() => setAddingJob(true)}>
                    Auftrag anlegen
                  </Button>
                ) : null
              }
              empty="An dieser Anlage wurde noch kein Auftrag angelegt."
            />
            <FilesPanel
              field="installationId"
              id={installationId}
              home={{
                customerId: customer ? String(customer['id']) : null,
                siteId: site ? String(site['id']) : null,
                installationId,
              }}
              empty="Noch keine Datei an der Anlage, etwa ein Schaltplan oder das Foto des Typenschilds."
            />
          </>
        }
        side={
          <Panel title="Anlage">
            {editing ? (
              <RecordForm
                fields={installationFields}
                record={installation}
                submitLabel="Speichern"
                onCancel={() => {
                  setEditing(false)
                }}
                onSubmit={async (values) => {
                  const saved = await client.update(
                    'installations',
                    installationId,
                    asInstallation(values),
                  )

                  if (saved.outcome === 'queued') {
                    setEditing(false)
                  }

                  return saved
                }}
              />
            ) : (
              <FactList
                keyWidth={110}
                facts={[
                  {
                    label: 'Objekt',
                    value: site ? (
                      <Link
                        to={`/objekte/${String(site['id'])}`}
                        className="text-copper-text underline underline-offset-2"
                      >
                        {text(site, 'designation')}
                      </Link>
                    ) : null,
                  },
                  { label: 'Hersteller', value: maybeText(installation, 'manufacturer') },
                  { label: 'Typ', value: maybeText(installation, 'model') },
                  { label: 'Seriennummer', value: maybeText(installation, 'serialNumber') },
                  {
                    label: 'In Betrieb seit',
                    value: maybeText(installation, 'commissionedOn')
                      ? date(installation['commissionedOn'])
                      : null,
                  },
                  { label: 'Gewährleistung', value: warrantyText(installation) },
                  { label: 'Notizen', value: maybeText(installation, 'notes') },
                ]}
              />
            )}
          </Panel>
        }
      />
    </Screen>
  )
}
