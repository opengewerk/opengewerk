import { basisPointsFrom, type IsoDate, markupLabel } from '@opengewerk/domain'
import { Button, Field, Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  Saved,
  SettingsHistory,
  SettingsPage,
  SettingsState,
  SettingsText,
} from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { useMay } from '../../app/queries.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { latestPeriod, proposedFrom } from './taxes.js'

/** The setting this screen changes: the markup on material of the whole business (#463). */
export const markupSetting = 'material.markup_basis_points'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The markup on material for the whole business (#463): what comes on an
 * article's purchase price to make its selling price, unless its supplier or
 * the article has its own. Without one no selling price comes from a purchase
 * price at all.
 *
 * Set from today on like the other settings; the selling prices that follow
 * the purchase price are worked out anew in the background from that day,
 * fixed ones stay and no document changes. Only the owner changes it; the
 * office sees it with nothing to press, as the payment term.
 */
export function MarkupSettingScreen() {
  const history = useQuery({ queryKey: ['parameters'], queryFn: parameterHistory })
  const mayWrite = useMay('settings.write')

  return (
    <SettingsPage
      active="aufschlag"
      title="Aufschlag auf Material"
      sub="Wie aus dem Einkaufspreis eines Artikels sein Verkaufspreis wird."
    >
      {history.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : history.isError ? (
        <SettingsText muted>
          {saidWhy(history.error, 'Die Einstellungen kamen nicht an.')}
        </SettingsText>
      ) : (
        <MarkupSection
          periods={history.data.filter((period) => period.key === markupSetting)}
          mayWrite={mayWrite}
        />
      )}
      <Panel title="Gut zu wissen" roomy>
        <div className="flex flex-col gap-2">
          <SettingsText>
            Ohne Aufschlag entsteht aus einem Einkaufspreis kein Verkaufspreis. Die Vorschau eines
            Imports sagt es, bevor übernommen wird.
          </SettingsText>
          <SettingsText muted>
            Einkaufspreis und Aufschlag sehen Inhaber und Büro. Sie stehen nie im Druck, in der
            E-Rechnung oder auf der Baustelle.
          </SettingsText>
        </div>
      </Panel>
    </SettingsPage>
  )
}

function MarkupSection({
  periods,
  mayWrite,
}: {
  readonly periods: readonly ParameterPeriod[]
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const standing = latestPeriod(periods)
  const [typed, setTyped] = useState(
    standing === null ? '' : String(standing.value / 100).replace('.', ','),
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const from = proposedFrom(periods, today() as IsoDate)
  const read = basisPointsFrom(typed)
  const problem = typed.trim() === '' || 'basisPoints' in read ? null : read.problem
  const unchanged = 'basisPoints' in read && read.basisPoints === standing?.value

  const save = useMutation({
    mutationFn: (basisPoints: number) =>
      setParameter({ key: markupSetting, from, value: basisPoints, note: null }),
    onSuccess: () => {
      setTrouble(null)
      setSaved(true)
      void queries.invalidateQueries({ queryKey: ['parameters'] })
    },
    onError: (error) => {
      setSaved(false)
      setTrouble(saidWhy(error, 'Der Aufschlag ließ sich nicht speichern.'))
    },
  })

  return (
    <Panel title="Aufschlag auf Material" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText>
          Auf den Einkaufspreis eines Artikels kommt dieser Aufschlag, und daraus entsteht sein
          Verkaufspreis. Ein Lieferant und ein Artikel können einen eigenen haben; dann gilt der
          engere, zuerst der des Artikels, dann der des Lieferanten.
        </SettingsText>

        <SettingsState>
          {standing === null
            ? 'Noch kein Aufschlag eingestellt.'
            : `${markupLabel(standing.value)} seit dem ${date(standing.validFrom)}.`}
        </SettingsState>

        {periods.length > 0 ? (
          <SettingsHistory
            items={[...periods]
              .sort((left, right) => right.validFrom.localeCompare(left.validFrom))
              .map((period) => `Ab ${date(period.validFrom)}: ${markupLabel(period.value)}`)}
          />
        ) : null}

        {mayWrite ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setSaved(false)

              if ('basisPoints' in read) {
                save.mutate(read.basisPoints)
              }
            }}
          >
            <div>
              <Field
                label="Aufschlag"
                className="sm:max-w-[160px]"
                name="markup"
                inputMode="decimal"
                numeric
                required
                unit="%"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value)
                }}
                {...(problem === null ? {} : { problem })}
                hint={
                  `Gilt ab dem ${date(from)}. Die Verkaufspreise, die dem Einkaufspreis folgen, ` +
                  'rechnen sich ab dann neu; feste Verkaufspreise bleiben, und kein Beleg ändert sich.'
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                tone="primary"
                icon={Check}
                disabled={save.isPending || !('basisPoints' in read) || unchanged}
              >
                {save.isPending ? 'Einen Moment' : 'Speichern'}
              </Button>
              {saved ? (
                <Saved>Gespeichert. Die Verkaufspreise rechnen sich im Hintergrund neu.</Saved>
              ) : null}
            </div>
          </form>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
