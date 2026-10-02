import {
  actionsSentence,
  defaultResponsibleLabel,
  intervalProblem,
  leadProblem,
  sourceWords,
} from '@opengewerk/domain'
import { Button, Field, Panel, SelectField, Status } from '@opengewerk/platform-web'
import { NoteBox, Saved, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { useMay } from '../../app/queries.js'
import { usePeople } from '../../app/tasks.js'
import {
  type DeadlineKindView,
  deadlineSettings,
  setDeadlineSetting,
} from '../../session/deadlines.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** The title of a trade package, for the chip beside a kind that comes from one. */
const tradeTitles: Readonly<Record<string, string>> = { elektro: 'Elektro und PV' }

/**
 * What a days field holds: null for empty, a number, or the sentence why it
 * is neither. Empty means the kind's own value.
 */
function daysOf(
  input: string,
  problem: (days: number) => string | null,
): { readonly days: number | null } | { readonly problem: string } {
  const typed = input.trim()

  if (typed === '') {
    return { days: null }
  }

  const days = Number(typed)
  const found = problem(days)

  return found === null ? { days } : { problem: found }
}

/**
 * The kinds of deadline and what the business sets for each (#283),
 * `einst_fristen()` of the canvas: how many days before it is due a deadline
 * reminds, the interval where the kind counts one, and who answers for it.
 * An empty field is the kind's own value; the owner changes them, the office
 * reads them.
 */
export function DeadlineSettingsScreen() {
  const kinds = useQuery({ queryKey: ['settings', 'deadlines'], queryFn: deadlineSettings })
  const mayWrite = useMay('settings.write')

  return (
    <SettingsPage
      active="fristen"
      title="Fristen"
      sub="Wann an Fristen erinnert wird und wer sie bekommt, je Art."
    >
      {kinds.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : kinds.isError ? (
        <SettingsText muted>
          {saidWhy(kinds.error, 'Die Einstellungen kamen nicht an.')}
        </SettingsText>
      ) : (
        <>
          {(Array.isArray(kinds.data) ? kinds.data : []).map((kind) => (
            <KindCard key={kind.key} kind={kind} mayWrite={mayWrite} />
          ))}
          <NoteBox>
            Eine einzelne Frist kann in der Liste „Fristen“ einen eigenen Vorlauf und eine andere
            verantwortliche Person bekommen. Ist die Person gesperrt, geht die Frist an den Inhaber.
          </NoteBox>
        </>
      )}
    </SettingsPage>
  )
}

function KindCard({
  kind,
  mayWrite,
}: {
  readonly kind: DeadlineKindView
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const { me, people } = usePeople()
  const shown = (value: number | null, own: number) => String(value ?? own)
  const [intervalText, setIntervalText] = useState(
    shown(kind.setting.intervalDays, kind.intervalDays ?? 0),
  )
  const [lead, setLead] = useState(shown(kind.setting.leadDays, kind.leadDays))
  const [responsible, setResponsible] = useState(kind.setting.responsibleUserId ?? '')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const readInterval = daysOf(intervalText, intervalProblem)
  const readLead = daysOf(lead, leadProblem)
  const words = sourceWords[kind.source]

  // A value typed as the kind's own is kept as "the kind's own", so that a
  // later version of the kind brings its new value along.
  const intervalDays =
    kind.intervalDays === null ||
    !('days' in readInterval) ||
    readInterval.days === kind.intervalDays
      ? null
      : readInterval.days
  const leadDays = !('days' in readLead) || readLead.days === kind.leadDays ? null : readLead.days
  const responsibleUserId = responsible === '' ? null : responsible
  const unchanged =
    intervalDays === kind.setting.intervalDays &&
    leadDays === kind.setting.leadDays &&
    responsibleUserId === kind.setting.responsibleUserId
  const problem =
    ('problem' in readLead ? readLead.problem : null) ??
    (kind.intervalDays !== null && 'problem' in readInterval ? readInterval.problem : null)

  const save = useMutation({
    mutationFn: () => setDeadlineSetting(kind.key, { leadDays, intervalDays, responsibleUserId }),
    onSuccess: () => {
      setTrouble(null)
      setSaved(true)
      void queries.invalidateQueries({ queryKey: ['settings', 'deadlines'] })
      void queries.invalidateQueries({ queryKey: ['deadlines'] })
    },
    onError: (error) => {
      setSaved(false)
      setTrouble(saidWhy(error, 'Die Einstellung ließ sich nicht speichern.'))
    },
  })

  const options = [
    { value: '', label: defaultResponsibleLabel(kind) },
    ...people
      .filter((person) => person.active || person.userId === kind.setting.responsibleUserId)
      .map((person) => ({
        value: person.userId,
        label: person.userId === me ? `${person.name} (du)` : person.name,
      })),
  ]

  return (
    <Panel
      title={kind.title}
      roomy
      action={
        kind.trade ? <Status tone="neutral">{tradeTitles[kind.trade] ?? kind.trade}</Status> : null
      }
    >
      <div className="flex flex-col gap-3">
        <SettingsText>{kind.about}</SettingsText>
        <div
          className={
            kind.intervalDays === null
              ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'
              : 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]'
          }
        >
          {kind.intervalDays === null ? null : (
            <Field
              label={words.interval.label}
              numeric
              inputMode="numeric"
              unit="Tage"
              className="sm:max-w-[96px]"
              value={intervalText}
              disabled={!mayWrite}
              onChange={(event) => {
                setIntervalText(event.target.value)
                setSaved(false)
              }}
              hint={words.interval.hint}
              {...('problem' in readInterval ? { problem: readInterval.problem } : {})}
            />
          )}
          <Field
            label="Vorlauf"
            numeric
            inputMode="numeric"
            unit="Tage"
            className="sm:max-w-[96px]"
            value={lead}
            disabled={!mayWrite}
            onChange={(event) => {
              setLead(event.target.value)
              setSaved(false)
            }}
            hint="So viele Tage vor der Fälligkeit wird erinnert."
            {...('problem' in readLead ? { problem: readLead.problem } : {})}
          />
          <SelectField
            label="Verantwortlich"
            value={responsible}
            disabled={!mayWrite}
            onChange={(value) => {
              setResponsible(value)
              setSaved(false)
            }}
            options={options}
          />
        </div>
        {trouble ? (
          <p role="alert" className="text-[13px] text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-ink-muted">{actionsSentence(kind.actions)}</span>
          <div className="grow" />
          {saved ? <Saved /> : null}
          {mayWrite ? (
            <Button
              tone="primary"
              icon={Check}
              disabled={unchanged || problem !== null || save.isPending}
              onClick={() => {
                save.mutate()
              }}
            >
              Speichern
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}
