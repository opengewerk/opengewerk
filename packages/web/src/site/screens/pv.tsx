import type { RecordState } from '@opengewerk/domain'
import { inverterProblems, pvStringProblems } from '@opengewerk/domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { maybeText, text, useRecord, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ChevronRight, Pencil, Plus, ScanBarcode } from 'lucide-react'
import { useState } from 'react'

import { nextPosition } from '../../app/electrical.js'
import { installationKindLabel, installationKindOf } from '../../app/labels.js'
import {
  azimuthOf,
  batchCount,
  batchProblems,
  batchStart,
  figureOf,
  inverterFields,
  inverterLine,
  inverterPower,
  makeAndModel,
  moduleBatchFields,
  modulesInWords,
  PvForm,
  serialsMissingText,
  stringFields,
  peakCell,
  stringLine,
  systemPeakText,
  tiltOf,
  useCompanions,
  useInverters,
  usePvModules,
  usePvStrings,
  useSystemModules,
  withoutSerial,
  addModules,
} from '../../app/photovoltaic.js'
import { SiteHeader } from '../header.js'
import { useStructureBase } from '../structure-base.js'
import { NotSent, SiteFacts, SiteLabel, SiteRow, SiteRows, SiteScreen, SiteText } from '../kit.js'

/**
 * The PV structure of a job's PV system on site (#300): read it, and add what
 * is missing, an inverter, a string, a row of modules, without a network like
 * everything here. Moving and removing is left to the office, as for the
 * boards: a thumb on a roof should not be one tap away from deleting a string
 * with twelve modules on it.
 */

/**
 * The card "Anlage" at a PV system, `site_pv_anlage_card()` of the canvas: the
 * inverters where a cabinet has its boards, the way to one more, and what
 * belongs to the system. On the screen of a job, or of the installation a
 * label opened (#308); `base` is where the structure hangs.
 */
export function InstallationInverters({
  base,
  installationId,
}: {
  readonly base: string
  readonly installationId: string
}) {
  const client = useSync()
  const inverters = useInverters(installationId)
  const strings = useRecords('pv_strings')
  const companions = useCompanions(installationId)
  const [adding, setAdding] = useState(false)

  return (
    <>
      <section aria-label="Wechselrichter">
        <SiteLabel className="mt-1">Wechselrichter</SiteLabel>
        {inverters.length === 0 ? (
          <p className="py-2 text-[16px] leading-[1.45] text-ink-muted">
            Für diese PV-Anlage ist noch kein Wechselrichter erfasst.
          </p>
        ) : (
          <SiteRows>
            {inverters.map((inverter) => {
              const id = String(inverter['id'])
              const own = strings.filter((pvString) => text(pvString, 'inverterId') === id)

              return (
                <SiteRow
                  key={id}
                  to={`${base}/wechselrichter/${id}`}
                  title={text(inverter, 'designation')}
                  meta={
                    <>
                      {inverterLine(inverter, own, [], false)}
                      {client.isPending('inverters', id) ? (
                        <>
                          {', '}
                          <NotSent />
                        </>
                      ) : null}
                    </>
                  }
                />
              )
            })}
          </SiteRows>
        )}
      </section>

      {adding ? (
        <PvForm
          fields={inverterFields}
          record={{ designation: `WR ${String(inverters.length + 1)}` }}
          rules={inverterProblems}
          submitLabel="Wechselrichter sichern"
          onCancel={() => {
            setAdding(false)
          }}
          onSubmit={async (values) => {
            const made = await client.create('inverters', {
              ...values,
              installationId,
              position: nextPosition(inverters),
            })

            if (made.outcome === 'queued') {
              setAdding(false)
            }

            return made
          }}
        />
      ) : (
        <Button
          wide
          height={48}
          icon={Plus}
          onClick={() => {
            setAdding(true)
          }}
        >
          Wechselrichter nachtragen
        </Button>
      )}

      {companions.length > 0 ? (
        <section aria-label="Dazu gehören">
          <SiteLabel className="mt-1">Dazu gehören</SiteLabel>
          <ul className="flex flex-col">
            {companions.map((one) => (
              <Companion key={String(one['id'])} installation={one} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

/**
 * A battery, a meter or a wallbox of the system, in the look of a row. Not a
 * link: an installation has no screen of its own on site.
 */
function Companion({ installation }: { readonly installation: RecordState }) {
  const inverter = useRecord('inverters', maybeText(installation, 'inverterId') ?? undefined)

  return (
    <li className="flex min-h-14 flex-col justify-center border-b border-row py-2">
      <span className="text-[17px] font-semibold [overflow-wrap:anywhere]">
        {text(installation, 'designation')}
      </span>
      <span className="mt-0.5 text-[15px] leading-[1.35] text-ink-muted">
        {[
          makeAndModel(installation) ?? installationKindLabel[installationKindOf(installation)],
          inverter ? `am ${text(inverter, 'designation')}` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(', ')}
      </span>
    </li>
  )
}

/** The peak power of a PV system on site: "9,60 kWp aus 24 Modulen", or null. */
export function usePvSystemPeak(installationId: string | undefined): string | null {
  return systemPeakText(useSystemModules(installationId))
}

function Missing({ what }: { readonly what: string }) {
  return (
    <SiteScreen>
      <SiteHeader title="Nicht gefunden" />
      <SiteText>{`${what} hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.`}</SiteText>
    </SiteScreen>
  )
}

/**
 * A string of an inverter as a card, `string_card()` of the canvas: its name,
 * what it is, and the serial numbers still missing.
 */
function StringCard({
  to,
  pvString,
  modules,
}: {
  readonly to: string
  readonly pvString: RecordState
  readonly modules: readonly RecordState[]
}) {
  const client = useSync()
  const id = String(pvString['id'])
  const missing = withoutSerial(modules)

  return (
    <li>
      <Link
        to={to}
        className="flex min-h-16 items-center gap-2.5 rounded-[6px] border border-line bg-surface px-3 py-2.5 text-ink no-underline"
      >
        <span className="min-w-0 grow">
          <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
            {text(pvString, 'designation')}
          </span>
          <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">
            {stringLine(pvString, modules)}
            {client.isPending('pv_strings', id) ? (
              <>
                {', '}
                <NotSent />
              </>
            ) : null}
          </span>
          {missing > 0 ? (
            <span className="mt-0.5 block text-[15px] font-semibold text-waiting">
              {missing === 1 ? '1 Seriennummer fehlt' : `${String(missing)} Seriennummern fehlen`}
            </span>
          ) : null}
        </span>
        <ChevronRight
          size={20}
          strokeWidth={2.2}
          aria-hidden="true"
          className="shrink-0 text-ink-faint"
        />
      </Link>
    </li>
  )
}

/** One inverter on site, the board "Wechselrichter mit seinen Strings". */
export function SiteInverterScreen() {
  const { inverterId } = useParams({ strict: false }) as { inverterId?: string }
  const base = useStructureBase()
  const client = useSync()
  const inverter = useRecord('inverters', inverterId)
  const system = useRecord('installations', maybeText(inverter, 'installationId') ?? undefined)
  const strings = usePvStrings(inverterId)
  const modules = useRecords('pv_modules')
  const [adding, setAdding] = useState(false)

  if (!inverter || !inverterId || !base) {
    return <Missing what="Diesen Wechselrichter" />
  }

  const inputs = figureOf(inverter, 'mppInputs')

  return (
    <SiteScreen gap={10}>
      <SiteHeader
        title={text(inverter, 'designation')}
        sub={['Wechselrichter', system ? text(system, 'designation') : '']
          .filter((part) => part !== '')
          .join(', ')}
      />

      {adding ? (
        <Panel title="String nachtragen">
          <PvForm
            fields={stringFields(inverter)}
            record={{ designation: `String ${String(strings.length + 1)}` }}
            rules={pvStringProblems}
            submitLabel="String sichern"
            onCancel={() => {
              setAdding(false)
            }}
            onSubmit={async (values) => {
              const made = await client.create('pv_strings', {
                ...values,
                inverterId,
                position: nextPosition(strings),
              })

              if (made.outcome === 'queued') {
                setAdding(false)
              }

              return made
            }}
          />
        </Panel>
      ) : (
        <>
          <Panel title="Was bekannt ist">
            <SiteFacts
              facts={[
                { label: 'Modell', value: makeAndModel(inverter) ?? 'nicht angegeben' },
                {
                  label: 'Seriennummer',
                  value: maybeText(inverter, 'serialNumber') ? (
                    <span className="numeric">{text(inverter, 'serialNumber')}</span>
                  ) : (
                    'nicht angegeben'
                  ),
                },
                { label: 'Nennleistung', value: inverterPower(inverter) ?? 'nicht angegeben' },
                {
                  label: 'MPP-Eingänge',
                  value: inputs === null ? 'nicht angegeben' : String(inputs),
                },
              ]}
            />
          </Panel>

          <Button
            tone="primary"
            wide
            height={52}
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            String nachtragen
          </Button>

          {strings.length === 0 ? (
            <SiteText muted>An diesem Wechselrichter ist noch kein String erfasst.</SiteText>
          ) : (
            <ul aria-label="Strings" className="flex flex-col gap-2.5">
              {strings.map((pvString) => {
                const id = String(pvString['id'])

                return (
                  <StringCard
                    key={id}
                    to={`${base}/wechselrichter/${inverterId}/strings/${id}`}
                    pvString={pvString}
                    modules={modules.filter((module) => text(module, 'pvStringId') === id)}
                  />
                )
              })}
            </ul>
          )}
        </>
      )}
    </SiteScreen>
  )
}

/**
 * One string on site, the board "String mit seinen Modulen": what is known, a
 * way to fill in the rest, its modules with their serial numbers, and a way
 * to add a row of them.
 */
export function SitePvStringScreen() {
  const { inverterId, stringId } = useParams({ strict: false }) as {
    inverterId?: string
    stringId?: string
  }
  const base = useStructureBase()
  const navigate = useNavigate()
  const client = useSync()
  const pvString = useRecord('pv_strings', stringId)
  const inverter = useRecord('inverters', maybeText(pvString, 'inverterId') ?? undefined)
  const modules = usePvModules(stringId)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)

  if (!pvString || !stringId) {
    return <Missing what="Diesen String" />
  }

  const input = figureOf(pvString, 'mppInput')
  const missing = serialsMissingText(modules)

  return (
    <SiteScreen>
      <SiteHeader
        title={text(pvString, 'designation')}
        sub={
          editing
            ? 'Angaben ergänzen'
            : [
                inverter ? text(inverter, 'designation') : '',
                input === null ? '' : `MPP-Eingang ${String(input)}`,
              ]
                .filter((part) => part !== '')
                .join(', ')
        }
      />

      {editing ? (
        <PvForm
          fields={stringFields(inverter, pvString)}
          record={pvString}
          rules={pvStringProblems}
          submitLabel="Angaben sichern"
          onCancel={() => {
            setEditing(false)
          }}
          onSubmit={async (values) => {
            const saved = await client.update('pv_strings', stringId, values)

            if (saved.outcome === 'queued') {
              setEditing(false)
            }

            return saved
          }}
        />
      ) : adding ? (
        <Panel title="Module nachtragen">
          <PvForm
            fields={moduleBatchFields}
            record={batchStart(modules)}
            rules={batchProblems}
            note={(inputs) => {
              const count = batchCount(inputs)

              return `Legt ${count === null ? 'die Module' : modulesInWords(count)} mit denselben Angaben am Ende des Strings an.`
            }}
            submitLabel={(inputs) => {
              const count = batchCount(inputs)

              return count === null ? 'Module sichern' : `${modulesInWords(count)} sichern`
            }}
            onCancel={() => {
              setAdding(false)
            }}
            onSubmit={async (values) => {
              const made = await addModules(client, stringId, modules, values)

              if (made.outcome === 'queued') {
                setAdding(false)
              }

              return made
            }}
          />
        </Panel>
      ) : (
        <>
          <Panel title="Was bekannt ist">
            <SiteFacts
              facts={[
                { label: 'Ausrichtung', value: azimuthOf(pvString) ?? 'nicht angegeben' },
                { label: 'Neigung', value: tiltOf(pvString) ?? 'nicht angegeben' },
                { label: 'Module', value: moduleFacts(modules) },
              ]}
            />
          </Panel>

          {/* The camera for the serial numbers, while a module has none (#300). */}
          {missing ? (
            <>
              <Button
                tone="primary"
                wide
                height={52}
                icon={ScanBarcode}
                onClick={() => {
                  void navigate({
                    to: `${base ?? ''}/wechselrichter/${inverterId ?? ''}/strings/${stringId}/scannen`,
                  })
                }}
              >
                Seriennummern scannen
              </Button>
              <SiteText muted size={15}>
                {`${missing} Jede gescannte Nummer geht an das nächste Modul ohne.`}
              </SiteText>
            </>
          ) : null}

          <Button
            wide
            height={48}
            icon={Pencil}
            onClick={() => {
              setEditing(true)
            }}
          >
            Angaben ergänzen
          </Button>

          <Panel title="Module">
            <div className="flex flex-col gap-2">
              {modules.length === 0 ? (
                <SiteText muted>An diesem String ist noch kein Modul erfasst.</SiteText>
              ) : (
                <ul aria-label="Module" className="flex flex-col">
                  {modules.map((module, index) => (
                    <ModuleRow key={String(module['id'])} module={module} number={index + 1} />
                  ))}
                </ul>
              )}
              <Button
                wide
                height={48}
                icon={Plus}
                onClick={() => {
                  setAdding(true)
                }}
              >
                Module nachtragen
              </Button>
            </div>
          </Panel>
        </>
      )}
    </SiteScreen>
  )
}

/** "12, zusammen 4,80 kWp", as the facts of a string on site say it. */
function moduleFacts(modules: readonly RecordState[]): string {
  const peak = peakCell(modules)

  if (modules.length === 0) {
    return 'noch keine'
  }

  return peak === '' ? String(modules.length) : `${String(modules.length)}, zusammen ${peak}`
}

/** A module of the string, `module_row()`: its number, and what it is or that its serial number is missing. */
function ModuleRow({ module, number }: { readonly module: RecordState; readonly number: number }) {
  const client = useSync()
  const serial = maybeText(module, 'serialNumber')
  const watts = figureOf(module, 'ratedPowerW')

  return (
    <li className="flex min-h-14 flex-col justify-center border-b border-row py-2">
      <span className="text-[17px] font-semibold">{`Modul ${String(number)}`}</span>
      {serial ? (
        <span className="mt-0.5 text-[15px] leading-[1.35] text-ink-muted [overflow-wrap:anywhere]">
          {[makeAndModel(module), watts === null ? null : `${String(watts)} Wp`, `SN ${serial}`]
            .filter((part): part is string => part !== null)
            .join(', ')}
          {client.isPending('pv_modules', String(module['id'])) ? (
            <>
              {', '}
              <NotSent />
            </>
          ) : null}
        </span>
      ) : (
        <span className="mt-0.5 text-[15px] font-semibold text-waiting">
          Seriennummer fehlt
          {client.isPending('pv_modules', String(module['id'])) ? (
            <span className="font-normal text-ink-muted">
              {', '}
              <NotSent />
            </span>
          ) : null}
        </span>
      )}
    </li>
  )
}
