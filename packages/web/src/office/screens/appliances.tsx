import {
  applianceMobilityLabel,
  type ApplianceMobility,
  readFormValues,
  type RecordState,
} from '@opengewerk/domain'
import { Button, Cell, Column, Panel, Status, TablePanel, cardLink } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  Empty,
  FactList,
  NoteBox,
  PageHead,
  RecordColumns,
  Screen,
} from '@opengewerk/platform-web/office'
import {
  RecordForm,
  maybeText,
  text,
  useRecord,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { List, Pencil, Plus, Printer, Search, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  applianceFields,
  applianceFormProblem,
  applianceFormRecord,
  applianceName,
  applianceState,
  asAppliance,
  lastResult,
  useAppliances,
  useApplianceTests,
} from '../../app/appliances.js'
import { addressLine } from '../../app/format.js'
import { definitionOf, isSigned, ProtocolsList } from '../../app/protocols.js'
import { useMay } from '../../app/queries.js'

/**
 * The register of appliances of a site in the office (#303): the card on the
 * record of the site, the register with its report, and an appliance with
 * its protocols, as the boards "Objekt", "Geräteverzeichnis am Objekt" and
 * "Gerät mit seinen Prüfprotokollen" draw them.
 */

/** Where the report of a site comes from; the server prints it out of what it holds. */
export function applianceReportAddress(siteId: string): string {
  return `/sites/${encodeURIComponent(siteId)}/appliance-report`
}

/**
 * The button of a report the server prints, a link the browser opens beside
 * the office; without a network none. The report of the appliances here, the
 * test of the electrical installation on the record of the site (#302).
 */
export function ReportButton({
  href,
  children,
}: {
  readonly href: string
  readonly children: string
}) {
  const { online } = useSyncStatus()

  return online ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap"
    >
      <Printer size={15} strokeWidth={2.3} aria-hidden="true" />
      {children}
    </a>
  ) : (
    <Button
      icon={Printer}
      disabled
      title="Den Prüfbericht druckt der Server, dafür braucht es Verbindung."
    >
      {children}
    </Button>
  )
}

/** "1 mit Mängeln, 2 fällig, 1 noch nicht geprüft", or that nothing is open. */
function openText(
  appliances: readonly RecordState[],
  tests: ReadonlyMap<string, readonly RecordState[]>,
): string {
  const states = appliances.map((appliance) => {
    const tested = tests.get(String(appliance['id']))

    return { state: applianceState(tested), last: lastResult(tested) }
  })
  const defects = states.filter((entry) => entry.last?.defects === true).length
  const due = states.filter((entry) => entry.state.kind === 'due').length
  const untested = states.filter((entry) => entry.last === null).length
  const parts = [
    defects > 0 ? `${String(defects)} mit Mängeln` : '',
    due > 0 ? `${String(due)} fällig` : '',
    untested > 0 ? `${String(untested)} noch nicht geprüft` : '',
  ].filter((part) => part !== '')

  return parts.length === 0 ? 'nichts' : parts.join(', ')
}

/** The card on the record of a site: how many appliances, when last tested, and the ways on. */
export function AppliancesPanel({ siteId }: { readonly siteId: string }) {
  const navigate = useNavigate()
  const appliances = useAppliances(siteId)
  const tests = useApplianceTests()
  const writes = useMay('installation.write')
  const fixed = appliances.filter((appliance) => appliance['mobility'] === 'fixed').length
  const lastTested = appliances
    .map((appliance) => lastResult(tests.get(String(appliance['id'])))?.performedOn ?? '')
    .reduce((latest, day) => (day > latest ? day : latest), '')

  return (
    <Panel
      title="Geräte nach DGUV Vorschrift 3"
      action={
        writes ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              void navigate({ to: `/objekte/${siteId}/geraete/neu` })
            }}
          >
            Gerät anlegen
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {appliances.length === 0 ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            An diesem Objekt gibt es noch kein Gerät. Ein Gerät ist, was an keinem Stromkreis hängt
            und nach DGUV Vorschrift 3 geprüft wird: Bohrmaschine, Kaffeemaschine, Verlängerung.
          </p>
        ) : (
          <FactList
            keyWidth={120}
            facts={[
              {
                label: 'Geräte',
                value:
                  fixed > 0
                    ? `${String(appliances.length)}, davon ${String(fixed)} ortsfest`
                    : String(appliances.length),
              },
              { label: 'Zuletzt geprüft', value: lastTested === '' ? '' : date(lastTested) },
              { label: 'Offen', value: openText(appliances, tests) },
            ]}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={List}
            onClick={() => {
              void navigate({ to: `/objekte/${siteId}/geraete` })
            }}
          >
            Geräteverzeichnis öffnen
          </Button>
          {appliances.length > 0 ? (
            <ReportButton href={applianceReportAddress(siteId)}>Prüfbericht als PDF</ReportButton>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}

type Filter = 'all' | 'due' | 'defects' | 'untested'

const filters: readonly { readonly key: Filter; readonly label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'due', label: 'Fällig' },
  { key: 'defects', label: 'Mit Mängeln' },
  { key: 'untested', label: 'Noch nicht geprüft' },
]

/** The register of a site, `/objekte/$siteId/geraete`, and with `adding` the form of a new appliance above it. */
export function ApplianceRegister({ adding = false }: { readonly adding?: boolean }) {
  const { siteId } = useParams({ strict: false }) as { siteId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const site = useRecord('sites', siteId)
  const customer = useRecord('customers', site ? String(site['customerId']) : undefined)
  const appliances = useAppliances(siteId)
  const tests = useApplianceTests()
  const writes = useMay('installation.write')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const on = today()

  const shown = useMemo(() => {
    const words = search.trim().toLocaleLowerCase('de')

    return appliances.filter((appliance) => {
      const tested = tests.get(String(appliance['id']))
      const last = lastResult(tested)
      const state = applianceState(tested, on)
      const matches =
        words === '' ||
        [
          text(appliance, 'inventoryNumber'),
          text(appliance, 'designation'),
          text(appliance, 'location'),
        ].some((part) => part.toLocaleLowerCase('de').includes(words))

      return (
        matches &&
        (filter === 'all' ||
          (filter === 'due' && state.kind === 'due') ||
          (filter === 'defects' && last?.defects === true) ||
          (filter === 'untested' && last === null))
      )
    })
  }, [appliances, tests, search, filter, on])

  if (!site || !siteId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/objekte', label: 'Objekte' }]} />
        <Empty>Dieses Objekt gibt es nicht mehr, oder dieses Gerät kennt es noch nicht.</Empty>
      </Screen>
    )
  }

  const customerId = String(site['customerId'])
  const register = `/objekte/${siteId}/geraete`

  return (
    <Screen>
      <PageHead
        title="Geräte"
        count={appliances.length === 1 ? '1 Gerät' : `${String(appliances.length)} Geräte`}
        crumbs={[
          { to: '/', label: 'Kunden' },
          ...(customer ? [{ to: `/kunden/${customerId}`, label: text(customer, 'name') }] : []),
          { to: `/objekte/${siteId}`, label: text(site, 'designation') },
        ]}
        sub={`${addressLine(site)}. Geprüft nach DGUV Vorschrift 3, je Gerät mit seinem letzten Protokoll.`}
        actions={
          <>
            {appliances.length > 0 ? (
              <ReportButton href={applianceReportAddress(siteId)}>Prüfbericht als PDF</ReportButton>
            ) : null}
            {writes ? (
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  void navigate({ to: `${register}/neu` })
                }}
              >
                Gerät anlegen
              </Button>
            ) : null}
          </>
        }
      />

      {adding && writes ? (
        <Panel title="Gerät anlegen">
          <RecordForm
            fields={applianceFields}
            record={{ protectionClass: 'I', mobility: 'portable' } as unknown as RecordState}
            submitLabel="Gerät anlegen"
            columns="lg:grid-cols-3"
            starred
            check={applianceFormProblem}
            onCancel={() => {
              void navigate({ to: register })
            }}
            onSubmit={async (values) => {
              const made = await client.create('appliances', { ...asAppliance(values), siteId })

              if (made.outcome === 'queued') {
                void navigate({ to: register })
              }

              return made
            }}
          />
        </Panel>
      ) : null}

      {appliances.length === 0 ? (
        <Panel title="Geräte">
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            An diesem Objekt gibt es noch kein Gerät.
          </p>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-control w-full max-w-[340px] items-center gap-2 rounded-control border border-control bg-surface px-2.5 text-ink-muted">
              <Search size={15} strokeWidth={2.2} aria-hidden="true" />
              <input
                type="search"
                aria-label="Geräte durchsuchen"
                placeholder="Inventarnummer, Gerät oder Standort"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
                className="min-w-0 grow border-0 bg-transparent text-body text-ink outline-none"
              />
            </label>
            {filters.map((entry) => (
              <Button
                key={entry.key}
                size="small"
                tone={filter === entry.key ? 'dark' : 'secondary'}
                aria-pressed={filter === entry.key}
                onClick={() => {
                  setFilter(entry.key)
                }}
              >
                {entry.label}
              </Button>
            ))}
          </div>

          <TablePanel
            caption="Geräte am Objekt"
            cards={shown.map((appliance) => {
              const id = String(appliance['id'])
              const last = lastResult(tests.get(id))

              return {
                key: id,
                title: (
                  <Link to={`/geraete/${id}`} className={cardLink}>
                    {applianceName(appliance)}
                  </Link>
                ),
                sub: [
                  `Schutzklasse ${text(appliance, 'protectionClass')}`,
                  text(appliance, 'location'),
                  last ? `geprüft am ${date(last.performedOn)}` : 'noch nicht geprüft',
                ]
                  .filter((part) => part !== '')
                  .join(' · '),
              }
            })}
            note="Fällig ist ein Gerät ab dem Tag, den sein letztes unterschriebenes Protokoll nennt. Die Frist dazu steht unter „Fristen“."
          >
            <thead>
              <tr>
                <Column className="w-[76px]">Inventar</Column>
                <Column>Gerät</Column>
                <Column className="w-[98px]">Schutzklasse</Column>
                <Column className="w-[150px]">Standort</Column>
                <Column className="w-[96px]">Geprüft am</Column>
                <Column className="w-[150px]">Ergebnis</Column>
                <Column className="w-[150px]">Nächste Prüfung</Column>
              </tr>
            </thead>
            <tbody>
              {shown.map((appliance) => {
                const id = String(appliance['id'])
                const tested = tests.get(id)
                const last = lastResult(tested)
                const state = applianceState(tested, on)
                const maker = [text(appliance, 'manufacturer'), text(appliance, 'model')]
                  .filter((part) => part !== '')
                  .join(' ')
                const fixed = (appliance['mobility'] as ApplianceMobility) === 'fixed'

                return (
                  <tr
                    key={id}
                    className="cursor-pointer hover:bg-surface-sunken"
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest('a, button')) {
                        void navigate({ to: `/geraete/${id}` })
                      }
                    }}
                  >
                    <Cell className="font-medium">{text(appliance, 'inventoryNumber')}</Cell>
                    <Cell>
                      <Link to={`/geraete/${id}`} className="font-semibold">
                        {text(appliance, 'designation')}
                      </Link>
                      {maker !== '' || fixed ? (
                        <div className="text-[12px] text-ink-faint">
                          {[maker, fixed ? applianceMobilityLabel.fixed : '']
                            .filter((part) => part !== '')
                            .join(', ')}
                        </div>
                      ) : null}
                    </Cell>
                    <Cell>{text(appliance, 'protectionClass')}</Cell>
                    <Cell>{text(appliance, 'location')}</Cell>
                    <Cell className="numeric">{last ? date(last.performedOn) : ''}</Cell>
                    <Cell>
                      {last === null ? (
                        <span className="text-ink-faint">noch nicht geprüft</span>
                      ) : last.defects ? (
                        <Status tone="conflict">Mängel</Status>
                      ) : (
                        <Status tone="done">Keine Mängel</Status>
                      )}
                    </Cell>
                    <Cell className="numeric">
                      {state.kind === 'due' ? (
                        <span className="font-semibold text-waiting">{`${date(state.on)}, fällig`}</span>
                      ) : last?.nextOn ? (
                        date(last.nextOn)
                      ) : (
                        ''
                      )}
                    </Cell>
                  </tr>
                )
              })}
            </tbody>
          </TablePanel>
        </>
      )}
    </Screen>
  )
}

/** The register of a site, `/objekte/$siteId/geraete`. */
export function ApplianceRegisterScreen() {
  return <ApplianceRegister />
}

/** The form of a new appliance above the register, `/objekte/$siteId/geraete/neu`. */
export function NewApplianceScreen() {
  return <ApplianceRegister adding />
}

/** An appliance with its protocols, `/geraete/$applianceId`. */
export function ApplianceScreen() {
  const { applianceId } = useParams({ strict: false }) as { applianceId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const appliance = useRecord('appliances', applianceId)
  const site = useRecord('sites', appliance ? String(appliance['siteId']) : undefined)
  const customer = useRecord('customers', site ? String(site['customerId']) : undefined)
  const tests = useApplianceTests()
  const writes = useMay('installation.write')
  const [editing, setEditing] = useState(false)

  if (!appliance || !applianceId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/objekte', label: 'Objekte' }]} />
        <Empty>Dieses Gerät gibt es nicht mehr, oder dieses Gerät kennt es noch nicht.</Empty>
      </Screen>
    )
  }

  const siteId = String(appliance['siteId'])
  const tested = tests.get(applianceId)
  const last = lastResult(tested)
  const lastSigned = (tested ?? []).find((test) => isSigned(test) && definitionOf(test) !== null)
  const found = lastSigned ? readFormValues(lastSigned['values'])?.['defects'] : undefined
  const length = appliance['cordLengthMilli']
  const mobility = appliance['mobility'] as ApplianceMobility

  return (
    <Screen>
      <PageHead
        title={text(appliance, 'designation')}
        crumbs={[
          { to: '/', label: 'Kunden' },
          ...(customer
            ? [{ to: `/kunden/${String(site?.['customerId'])}`, label: text(customer, 'name') }]
            : []),
          ...(site ? [{ to: `/objekte/${siteId}`, label: text(site, 'designation') }] : []),
          { to: `/objekte/${siteId}/geraete`, label: 'Geräte' },
        ]}
        badges={
          <>
            <Status tone="neutral">{`Schutzklasse ${text(appliance, 'protectionClass')}`}</Status>
            <Status tone="neutral">{applianceMobilityLabel[mobility]}</Status>
          </>
        }
        sub={[
          maybeText(appliance, 'inventoryNumber')
            ? `Inventar ${text(appliance, 'inventoryNumber')}`
            : '',
          text(appliance, 'location'),
          client.isPending('appliances', applianceId) ? 'noch nicht übertragen' : '',
        ]
          .filter((part) => part !== '')
          .join(', ')}
        actions={
          writes ? (
            <Button
              icon={Pencil}
              onClick={() => {
                setEditing(true)
              }}
            >
              Bearbeiten
            </Button>
          ) : null
        }
      />

      <RecordColumns
        main={
          <>
            {last?.defects ? (
              <NoteBox tone="conflict" icon={TriangleAlert}>
                {`Letzte Prüfung am ${date(last.performedOn)}: Mängel festgestellt.`}
                {typeof found === 'string' && found !== '' ? ` ${found}` : ''}
              </NoteBox>
            ) : null}
            <Panel title="Prüfprotokolle">
              <ProtocolsList
                applianceId={applianceId}
                jobId={null}
                pathOf={(recordId) => `/pruefprotokolle/${recordId}`}
                onStarted={(recordId) => {
                  void navigate({ to: `/pruefprotokolle/${recordId}` })
                }}
              />
            </Panel>
          </>
        }
        side={
          <Panel title="Gerät">
            {editing ? (
              <RecordForm
                fields={applianceFields}
                record={applianceFormRecord(appliance)}
                submitLabel="Speichern"
                narrow
                check={applianceFormProblem}
                onCancel={() => {
                  setEditing(false)
                }}
                onSubmit={async (values) => {
                  const result = await client.update('appliances', applianceId, asAppliance(values))

                  if (result.outcome === 'queued') {
                    setEditing(false)
                  }

                  return result
                }}
              />
            ) : (
              <FactList
                keyWidth={120}
                facts={[
                  {
                    label: 'Objekt',
                    value: site ? (
                      <Link
                        to={`/objekte/${siteId}`}
                        className="text-copper-text underline underline-offset-2"
                      >
                        {text(site, 'designation')}
                      </Link>
                    ) : (
                      ''
                    ),
                  },
                  { label: 'Inventarnummer', value: text(appliance, 'inventoryNumber') },
                  { label: 'Hersteller', value: text(appliance, 'manufacturer') },
                  { label: 'Typ', value: text(appliance, 'model') },
                  { label: 'Seriennummer', value: text(appliance, 'serialNumber') },
                  { label: 'Schutzklasse', value: text(appliance, 'protectionClass') },
                  { label: 'Art', value: applianceMobilityLabel[mobility] },
                  { label: 'Standort', value: text(appliance, 'location') },
                  {
                    label: 'Anschlussleitung',
                    value:
                      typeof length === 'number'
                        ? `${(length / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3 })} m`
                        : '',
                  },
                  {
                    label: 'Nächste Prüfung',
                    value: last?.nextOn ? `bis zum ${date(last.nextOn)}` : '',
                  },
                  { label: 'Notizen', value: text(appliance, 'notes') },
                ]}
              />
            )}
          </Panel>
        }
      />
    </Screen>
  )
}
