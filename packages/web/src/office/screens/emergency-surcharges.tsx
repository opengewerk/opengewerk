import {
  basisPointsFrom,
  defaultNight,
  type EmergencyKind,
  emergencyKindLabel,
  emergencyKinds,
  type IsoDate,
  markupLabel,
  type TenantParameterKey,
} from '@opengewerk/domain'
import { Button, Choice, Field, Panel } from '@opengewerk/platform-web'
import { date, euros, parseEuros, today } from '@opengewerk/platform-web/format'
import { SettingsPage, SettingsState, SettingsText } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { useMay } from '../../app/queries.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { latestPeriod, proposedFrom } from './taxes.js'

/**
 * What an emergency call costs the customer extra (#293, Feature-Gliederung
 * 4.1): for the night, the weekend and public holidays a flat amount or a
 * percentage of the working time, and when the night begins and ends. Board
 * "Einstellungen, Notdienstzuschläge" of the canvas, version 125.
 *
 * Settings of the business from a day on, like the markup on material: the
 * invoice out of the report of a call takes what applied on the day of the
 * call. Saving sets the other of flat amount and percentage to nothing, from
 * the same day, so that a kind never has both.
 */

type Mode = 'flat' | 'percent'

function key(kind: EmergencyKind, mode: Mode): TenantParameterKey {
  return `emergency.${kind}_${mode === 'flat' ? 'flat_cents' : 'basis_points'}` as TenantParameterKey
}

function saidWhy(error: unknown, otherwise: string): string {
  return error instanceof RequestRefused ? error.message : otherwise
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function minuteOf(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())

  if (!match) {
    return null
  }

  const minute = Number(match[1]) * 60 + Number(match[2])

  return Number(match[2]) < 60 && minute < 24 * 60 ? minute : null
}

function KindSection({
  kind,
  periods,
  mayWrite,
}: {
  readonly kind: EmergencyKind
  readonly periods: readonly ParameterPeriod[]
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const flat = latestPeriod(periods.filter((period) => period.key === key(kind, 'flat')))
  const percent = latestPeriod(periods.filter((period) => period.key === key(kind, 'percent')))
  const standingMode: Mode = (percent?.value ?? 0) > 0 ? 'percent' : 'flat'
  const [mode, setMode] = useState<Mode>(standingMode)
  const [typed, setTyped] = useState(
    standingMode === 'percent'
      ? String((percent?.value ?? 0) / 100).replace('.', ',')
      : flat && flat.value > 0
        ? (flat.value / 100).toFixed(2).replace('.', ',')
        : '',
  )
  const night = kind === 'night'
  const fromPeriod = latestPeriod(
    periods.filter((period) => period.key === 'emergency.night_from_minute'),
  )
  const untilPeriod = latestPeriod(
    periods.filter((period) => period.key === 'emergency.night_until_minute'),
  )
  const [nightFrom, setNightFrom] = useState(clock(fromPeriod?.value ?? defaultNight.fromMinute))
  const [nightUntil, setNightUntil] = useState(
    clock(untilPeriod?.value ?? defaultNight.untilMinute),
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)

  const relevant = periods.filter(
    (period) =>
      period.key === key(kind, 'flat') ||
      period.key === key(kind, 'percent') ||
      (night && period.key.startsWith('emergency.night_')),
  )
  const from = proposedFrom(relevant, today() as IsoDate)
  const standing =
    standingMode === 'percent' && percent
      ? `${markupLabel(percent.value)} auf die Arbeitszeit seit dem ${date(percent.validFrom)}.`
      : flat && flat.value > 0
        ? `${euros(flat.value)} je Einsatz seit dem ${date(flat.validFrom)}.`
        : 'Noch kein Zuschlag eingestellt.'

  async function save() {
    setTrouble(null)
    setSaved(false)

    const amount =
      typed.trim() === ''
        ? 0
        : mode === 'flat'
          ? parseEuros(typed)
          : (() => {
              const read = basisPointsFrom(typed)

              return 'basisPoints' in read ? read.basisPoints : null
            })()

    if (amount === null) {
      setTrouble(
        mode === 'flat'
          ? 'Der Betrag ist eine Zahl in Euro, zum Beispiel 45,00.'
          : 'Der Aufschlag ist ein Prozentsatz, zum Beispiel 50.',
      )

      return
    }

    const startsAt = night ? minuteOf(nightFrom) : null
    const endsAt = night ? minuteOf(nightUntil) : null

    if (night && (startsAt === null || endsAt === null)) {
      setTrouble('Beginn und Ende der Nacht sind Uhrzeiten wie 20:00.')

      return
    }

    setWorking(true)

    try {
      await setParameter({ key: key(kind, mode), from, value: amount, note: null })
      await setParameter({
        key: key(kind, mode === 'flat' ? 'percent' : 'flat'),
        from,
        value: 0,
        note: null,
      })

      if (night && startsAt !== null && endsAt !== null) {
        await setParameter({
          key: 'emergency.night_from_minute',
          from,
          value: startsAt,
          note: null,
        })
        await setParameter({ key: 'emergency.night_until_minute', from, value: endsAt, note: null })
      }

      setSaved(true)
      await queries.invalidateQueries({ queryKey: ['parameters'] })
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Zuschlag ließ sich nicht speichern.'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={emergencyKindLabel[kind]} roomy>
      <div className="flex flex-col gap-3">
        <SettingsState>{standing}</SettingsState>
        {mayWrite ? (
          <>
            <Choice
              label="Art"
              value={mode}
              options={[
                {
                  value: 'flat',
                  label: 'Pauschale je Einsatz',
                  note: 'Eine Position mit diesem Betrag.',
                },
                {
                  value: 'percent',
                  label: 'Aufschlag auf die Arbeitszeit',
                  note: 'Ein Prozentsatz der Positionen in Stunden.',
                },
              ]}
              onChange={(value) => {
                setMode(value)
                setTyped('')
              }}
            />
            <div className="flex flex-wrap gap-3">
              <div className="w-[200px]">
                <Field
                  label={mode === 'flat' ? 'Betrag in €' : 'Aufschlag in %'}
                  numeric
                  value={typed}
                  hint="Leer heißt kein Zuschlag."
                  onChange={(event) => {
                    setTyped(event.target.value)
                  }}
                />
              </div>
              {night ? (
                <>
                  <div className="w-[120px]">
                    <Field
                      label="Nacht von"
                      value={nightFrom}
                      onChange={(event) => {
                        setNightFrom(event.target.value)
                      }}
                    />
                  </div>
                  <div className="w-[120px]">
                    <Field
                      label="bis"
                      value={nightUntil}
                      onChange={(event) => {
                        setNightUntil(event.target.value)
                      }}
                    />
                  </div>
                </>
              ) : null}
            </div>
            {trouble ? (
              <p role="alert" className="text-[13px] font-semibold text-conflict">
                {trouble}
              </p>
            ) : null}
            {saved ? (
              <p role="status" className="text-[13px] text-done">
                {`Gespeichert, gilt ab dem ${date(from)}.`}
              </p>
            ) : null}
            <div>
              <Button
                tone="primary"
                icon={Check}
                disabled={working}
                onClick={() => {
                  void save()
                }}
              >
                Speichern
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  )
}

export function EmergencySurchargesScreen() {
  const history = useQuery({ queryKey: ['parameters'], queryFn: parameterHistory })
  const mayWrite = useMay('settings.write')

  return (
    <SettingsPage
      active="notdienst"
      title="Notdienstzuschläge"
      sub="Was ein Notdiensteinsatz den Kunden zusätzlich kostet."
    >
      <Panel roomy>
        <div className="flex flex-col gap-2">
          <SettingsText>
            Ein Notdiensteinsatz ist ein Serviceeinsatz mit dem Zeitpunkt, zu dem der Kunde
            angerufen hat: angelegt in der Bereitschaft, oder im Büro so gekennzeichnet. Die
            Rechnung aus seinem Regiebericht bekommt den Zuschlag als eigene Position, an einem
            Feiertag den für Feiertage, am Wochenende den für das Wochenende, sonst nachts den für
            die Nacht.
          </SettingsText>
          <SettingsText muted>
            Zuschläge für die Mitarbeiter (Nacht, Sonntag, Notdienst) gehören zum Lohnexport und
            stehen nicht hier.
          </SettingsText>
        </div>
      </Panel>
      {history.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : history.isError ? (
        <SettingsText muted>
          {saidWhy(history.error, 'Die Einstellungen kamen nicht an.')}
        </SettingsText>
      ) : (
        emergencyKinds.map((kind) => (
          <KindSection key={kind} kind={kind} periods={history.data} mayWrite={mayWrite} />
        ))
      )}
    </SettingsPage>
  )
}
