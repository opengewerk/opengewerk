import type { RecordState } from '@opengewerk/domain'
import { inverterPowerText, inverterProblems } from '@opengewerk/domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { moveAmong, nextPosition } from '../../app/electrical.js'
import { installationKindOf } from '../../app/labels.js'
import {
  companionFields,
  figureOf,
  inverterFields,
  inverterLine,
  PvForm,
  systemPeakText,
  useCompanions,
  useInverters,
  useSystemModules,
} from '../../app/photovoltaic.js'
import type { FormField } from '../../app/record-form.js'
import { useMay } from '../../app/queries.js'
import { refusalFor } from '../../sync/client.js'
import { text } from '../../sync/fields.js'
import { useRecords, useSync } from '../../sync/provider.js'
import { SmallIcon } from './boards.js'
import { Entries } from './pv-structure.js'

/**
 * The cards of a PV system on its record (#300), as the board "PV-Anlage:
 * Wechselrichter und was dazugehört" draws them: its inverters where a meter
 * cabinet has its boards, and the batteries, meters and wallboxes that belong
 * to it.
 */

/**
 * The inverters of a PV system: a line per inverter with what it is and what
 * hangs at it, and the arrows to put it in its place.
 */
export function InvertersSection({ installationId }: { readonly installationId: string }) {
  const client = useSync()
  const inverters = useInverters(installationId)
  const strings = useRecords('pv_strings')
  const modules = useRecords('pv_modules')
  const writes = useMay('installation.write')
  const [adding, setAdding] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'inverters', inverters, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  return (
    <Panel
      title="Wechselrichter"
      action={
        writes && !adding ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            Wechselrichter anlegen
          </Button>
        ) : null
      }
    >
      {trouble ? (
        <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {adding ? (
        <div className="mb-3">
          <PvForm
            fields={inverterFields}
            record={{ designation: `WR ${String(inverters.length + 1)}` }}
            rules={inverterProblems}
            columns="lg:grid-cols-3"
            submitLabel="Wechselrichter anlegen"
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
        </div>
      ) : null}

      {inverters.length === 0 ? (
        adding ? null : (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Noch kein Wechselrichter. Unter ihm stehen seine Strings und an denen die Module, mit
            ihren Seriennummern.
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {inverters.map((inverter, index) => {
            const id = String(inverter['id'])
            const own = strings.filter((pvString) => text(pvString, 'inverterId') === id)
            const onIt = modules.filter((module) =>
              own.some((pvString) => String(pvString['id']) === text(module, 'pvStringId')),
            )
            const designation = text(inverter, 'designation')

            return (
              <li
                key={id}
                className="flex items-center gap-2.5 rounded-control border border-line bg-ground px-[11px] py-[9px]"
              >
                <div className="min-w-0 grow">
                  <Link
                    to={`/wechselrichter/${id}`}
                    className="text-[14px] font-semibold text-copper-text underline underline-offset-2"
                  >
                    {designation}
                  </Link>
                  <div className="text-[13px] text-ink-faint">
                    {[
                      inverterLine(inverter, own, onIt),
                      client.isPending('inverters', id) ? 'noch nicht übertragen' : null,
                    ]
                      .filter((part): part is string => part !== null && part !== '')
                      .join(', ')}
                  </div>
                </div>
                {writes ? (
                  <>
                    <SmallIcon
                      label={`${designation} nach oben`}
                      disabled={index === 0}
                      onClick={() => void move(id, -1)}
                    >
                      <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                    </SmallIcon>
                    <SmallIcon
                      label={`${designation} nach unten`}
                      disabled={index === inverters.length - 1}
                      onClick={() => void move(id, 1)}
                    >
                      <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                    </SmallIcon>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** "Dazu gehören": the batteries, meters and wallboxes that say they belong to this PV system. */
export function CompanionsSection({ installationId }: { readonly installationId: string }) {
  const companions = useCompanions(installationId)

  return (
    <Panel title="Dazu gehören">
      <div className="flex flex-col gap-2.5">
        {companions.length > 0 ? <Entries installations={companions} withInverter /> : null}
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Speicher, Zähler und Wallbox sind eigene Anlagen am Objekt. Unter „Bearbeiten“ sagt jede,
          zu welcher PV-Anlage sie gehört und an welchem Wechselrichter sie hängt.
        </p>
      </div>
    </Panel>
  )
}

/**
 * The two facts a PV system adds to its record: its peak power, "9,60 kWp aus
 * 24 Modulen", and its inverters, "1, zusammen 10,0 kW".
 */
export function usePvSystemFacts(installationId: string) {
  const inverters = useInverters(installationId)
  const modules = useSystemModules(installationId)

  return useMemo(() => {
    const inverterWatts = inverters.map((inverter) => figureOf(inverter, 'ratedPowerW'))
    const allKnown = inverterWatts.every((value) => value !== null)
    const sum = inverterWatts.reduce<number>((total, value) => total + (value ?? 0), 0)

    return [
      { label: 'Leistung', value: systemPeakText(modules) },
      {
        label: 'Wechselrichter',
        value:
          inverters.length === 0
            ? null
            : allKnown
              ? `${String(inverters.length)}, zusammen ${inverterPowerText(sum)}`
              : String(inverters.length),
      },
    ]
  }, [inverters, modules])
}

/**
 * The PV systems at a site other than this installation, and their
 * inverters: the choices a battery, a meter or a wallbox has for where it
 * belongs.
 */
export function useCompanionFields(
  siteId: string | undefined,
  installationId?: string,
): readonly FormField[] {
  const installations = useRecords('installations')
  const inverters = useRecords('inverters')

  return useMemo(() => {
    const systems = installations.filter(
      (one) =>
        text(one, 'siteId') === siteId &&
        installationKindOf(one) === 'pv_system' &&
        String(one['id']) !== installationId,
    )
    const ids = new Set(systems.map((system) => String(system['id'])))

    return companionFields(
      systems,
      inverters.filter((inverter) => ids.has(text(inverter, 'installationId'))),
    )
  }, [installations, inverters, siteId, installationId])
}

/** "PV-Anlage Dach" as a link, for the facts of a battery, a meter or a wallbox. */
export function LinkTo({
  to,
  record,
}: {
  readonly to: string
  readonly record: RecordState | null
}) {
  return record ? (
    <Link to={to} className="text-copper-text underline underline-offset-2">
      {text(record, 'designation')}
    </Link>
  ) : null
}
