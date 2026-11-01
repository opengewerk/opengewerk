import { type FederalState, federalStates, ruleScopeNames } from '@opengewerk/domain'
import { Button, Cell, Column, Panel, SelectField, TablePanel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Saved, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { useMay } from '../../app/queries.js'
import { absencesKey, holidaySettings, setHolidaySettings } from '../../session/absences.js'

/**
 * The public holidays of the business (#288, Feature-Gliederung 4.4): the
 * state it is in, the local holidays it switches on, and the holidays of the
 * year with where the law says them. Boards "Feiertage, Baden-Württemberg"
 * and "Feiertage, Bayern mit örtlichen" of the canvas, version 95. Only
 * whoever sets the settings changes them; the office reads them.
 */

const weekday = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** A source without the date and the gazette of its law, which the title of the cell keeps. */
function shortSource(source: string): string {
  return source.split(' (')[0] ?? source
}

function weekdayOf(on: string): string {
  return weekday[new Date(`${on}T00:00:00Z`).getUTCDay()] ?? ''
}

export function HolidaysScreen() {
  const year = Number(today().slice(0, 4))
  const mayWrite = useMay('settings.write')
  const queries = useQueryClient()
  const [look, setLook] = useState<FederalState | null>(null)
  const [local, setLocal] = useState<readonly string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const view = useQuery({
    queryKey: [...absencesKey, 'holidays', year, look],
    queryFn: () => holidaySettings(year, look ?? undefined),
  })
  const data = view.data
  const shown = data?.shown ?? null
  const chosen = local ?? (data && data.state === shown ? data.local : [])
  const unchanged = data !== undefined && data.state === shown && local === null

  async function save() {
    if (shown === null) {
      return
    }

    try {
      await setHolidaySettings(shown, chosen)
      setProblem(null)
      setSaved(true)
      setLocal(null)
      setLook(null)
      await queries.invalidateQueries({ queryKey: absencesKey })
    } catch (error) {
      setSaved(false)
      setProblem(
        error instanceof RequestRefused
          ? error.message
          : 'Die Feiertage ließen sich nicht speichern.',
      )
    }
  }

  return (
    <SettingsPage
      active="feiertage"
      title="Feiertage"
      sub="Nach welchen Feiertagen Urlaub und Zeitkonto zählen."
    >
      <Panel title="Bundesland" roomy>
        <div className="flex flex-col gap-3">
          <SettingsText>
            Nach dem Bundesland zählen Urlaub und Zeitkonto die gesetzlichen Feiertage.
          </SettingsText>
          <div className="sm:max-w-[280px]">
            <SelectField
              label="Bundesland"
              value={shown ?? ''}
              disabled={!mayWrite}
              options={[
                ...(shown === null ? [{ value: '', label: 'Noch keins gewählt' }] : []),
                ...[...federalStates]
                  .sort((one, other) =>
                    ruleScopeNames[one].localeCompare(ruleScopeNames[other], 'de'),
                  )
                  .map((state) => ({ value: state, label: ruleScopeNames[state] })),
              ]}
              onChange={(value) => {
                setSaved(false)
                setLocal(null)
                setLook(value === '' ? null : (value as FederalState))
              }}
            />
          </div>
          {shown === null ? (
            <SettingsText muted>
              Ohne Bundesland zählt OpenGewerk keine Feiertage, und jeder Werktag der Arbeitszeit
              ist ein Urlaubstag.
            </SettingsText>
          ) : null}
        </div>
      </Panel>
      {data && shown !== null ? (
        <Panel title="Örtliche Feiertage" roomy>
          <div className="flex flex-col gap-2.5">
            {data.options.length === 0 ? (
              <SettingsText muted>
                {`In ${ruleScopeNames[shown]} gibt es keine Feiertage, die nur in einzelnen Gemeinden gelten.`}
              </SettingsText>
            ) : (
              <>
                <SettingsText muted>
                  Sie gelten nur dort, wo das Gesetz es sagt. Zuschalten, wenn der Betrieb dort
                  arbeitet.
                </SettingsText>
                {data.options.map((option) => (
                  <label
                    key={option.key}
                    className="flex items-start gap-2.5 py-1 text-[14px] leading-[1.4]"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={!mayWrite}
                      checked={chosen.includes(option.key)}
                      onChange={(event) => {
                        setSaved(false)
                        setLocal(
                          event.target.checked
                            ? [...chosen, option.key]
                            : chosen.filter((key) => key !== option.key),
                        )
                      }}
                    />
                    <span>
                      {option.on === null
                        ? option.name
                        : `${option.name}, ${date(option.on).slice(0, 6)}`}
                      <span className="block text-[13px] text-ink-muted">
                        {option.where.charAt(0).toUpperCase() + option.where.slice(1)}
                      </span>
                    </span>
                  </label>
                ))}
              </>
            )}
          </div>
        </Panel>
      ) : null}
      {mayWrite && shown !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" icon={Check} disabled={unchanged} onClick={() => void save()}>
            Speichern
          </Button>
          {saved ? (
            <Saved>Gespeichert. Urlaub und Zeitkonto zählen ab jetzt mit diesen Feiertagen.</Saved>
          ) : null}
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="m-0 text-body font-semibold text-conflict">
          {problem}
        </p>
      ) : null}
      {data && shown !== null ? (
        <TablePanel
          caption={`Feiertage ${String(year)} in ${ruleScopeNames[shown]}`}
          cards={data.holidays.map((holiday) => ({
            key: holiday.key,
            title: `${date(holiday.on)}, ${holiday.name}`,
            sub: shortSource(holiday.source),
          }))}
          note="Aus dem Regelpaket „Feiertage“, je Land nach seinem Feiertagsgesetz. Fällt ein Feiertag auf einen Arbeitstag, zählt er nicht als Urlaub."
        >
          <thead>
            <tr>
              <Column className="w-[100px]">Tag</Column>
              <Column className="w-[40px]">
                <span className="sr-only">Wochentag</span>
              </Column>
              <Column>Feiertag</Column>
              <Column className="w-[300px]">Fundstelle</Column>
            </tr>
          </thead>
          <tbody>
            {data.holidays.map((holiday) => (
              <tr key={holiday.key}>
                <Cell>{date(holiday.on)}</Cell>
                <Cell className="text-ink-muted">{weekdayOf(holiday.on)}</Cell>
                <Cell className="font-medium">{holiday.name}</Cell>
                <Cell className="text-ink-muted">
                  <span title={holiday.source}>{shortSource(holiday.source)}</span>
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      ) : null}
    </SettingsPage>
  )
}
