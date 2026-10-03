import { intervalMonthsProblem, intervalProblem, leadProblem } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '../components/button.js'
import { Field, SelectField } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { useRight } from '../session/queries.js'
import { RequestRefused } from '../sync/transport.js'
import {
  type DeadlineKindView,
  deadlineSettings,
  type DeadlineSettingChange,
  setDeadlineSetting,
} from './deadline-requests.js'
import type { DeadlinePeople } from './deadlines.js'
import { NoteBox } from './kit.js'
import { Saved, SettingsPage, SettingsText } from './settings.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * What a field of whole numbers holds: null for empty, a number, or the
 * sentence why it is neither. Empty means the kind's own value.
 */
function numberOf(
  input: string,
  problem: (count: number) => string | null,
): { readonly count: number | null } | { readonly problem: string } {
  const typed = input.trim()

  if (typed === '') {
    return { count: null }
  }

  const count = Number(typed)
  const found = problem(count)

  return found === null ? { count } : { problem: found }
}

/** What the application hands the settings of the deadlines. */
export interface DeadlineSettingsProps<Kind extends DeadlineKindView> {
  /** The right of the application that changes the settings; without it they are only read. */
  readonly rights: { readonly write: string }
  /** The people of the tenant, as a hook of the application. */
  readonly usePeople: () => DeadlinePeople
  /** Who answers for a deadline of a kind when nobody has said otherwise, in words. */
  readonly responsibleLabel: (kind: Kind) => string
  /** The field of the interval and the sentence under it, for a kind that counts one. */
  readonly intervalWords: (kind: Kind) => { readonly label: string; readonly hint: string }
  /** What a kind does when its lead comes, as one sentence. */
  readonly actionsSentence: (kind: Kind) => string
  /** What stands beside the title of a kind: the package it comes from, for one. */
  readonly badge?: (kind: Kind) => ReactNode
  /** The remark under the kinds: what one deadline can have of its own, and who gets it. */
  readonly note: string
}

/**
 * The kinds of deadline and what the tenant sets for each
 * (opengewerk-haustechnik#24): how many days before it is due a deadline
 * reminds, the interval where the kind counts one, in its unit, and who
 * answers for it. An empty field is the kind's own value; whoever has the
 * right changes them, everybody else reads them.
 */
export function DeadlineSettingsScreen<Kind extends DeadlineKindView>(
  props: DeadlineSettingsProps<Kind>,
) {
  const kinds = useQuery({
    queryKey: ['settings', 'deadlines'],
    queryFn: () => deadlineSettings<Kind>(),
  })
  const mayWrite = useRight(props.rights.write)

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
            <KindCard key={kind.key} kind={kind} mayWrite={mayWrite} props={props} />
          ))}
          <NoteBox>{props.note}</NoteBox>
        </>
      )}
    </SettingsPage>
  )
}

function KindCard<Kind extends DeadlineKindView>({
  kind,
  mayWrite,
  props,
}: {
  readonly kind: Kind
  readonly mayWrite: boolean
  readonly props: DeadlineSettingsProps<Kind>
}) {
  const queries = useQueryClient()
  const { me, people } = props.usePeople()
  const months = kind.intervalMonths ?? null
  const counted = kind.intervalDays ?? months
  const own = months === null ? kind.setting.intervalDays : (kind.setting.intervalMonths ?? null)
  const shown = (value: number | null, fallback: number) => String(value ?? fallback)
  const [intervalText, setIntervalText] = useState(shown(own, counted ?? 0))
  const [lead, setLead] = useState(shown(kind.setting.leadDays, kind.leadDays))
  const [responsible, setResponsible] = useState(kind.setting.responsibleUserId ?? '')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const readInterval = numberOf(
    intervalText,
    months === null ? intervalProblem : intervalMonthsProblem,
  )
  const readLead = numberOf(lead, leadProblem)

  // A value typed as the kind's own is kept as "the kind's own", so that a
  // later version of the kind brings its new value along.
  const interval =
    counted === null || !('count' in readInterval) || readInterval.count === counted
      ? null
      : readInterval.count
  const leadDays =
    !('count' in readLead) || readLead.count === kind.leadDays ? null : readLead.count
  const responsibleUserId = responsible === '' ? null : responsible
  const unchanged =
    interval === own &&
    leadDays === kind.setting.leadDays &&
    responsibleUserId === kind.setting.responsibleUserId
  const problem =
    ('problem' in readLead ? readLead.problem : null) ??
    (counted !== null && 'problem' in readInterval ? readInterval.problem : null)

  const change: DeadlineSettingChange =
    months === null
      ? { leadDays, intervalDays: interval, responsibleUserId }
      : { leadDays, intervalMonths: interval, responsibleUserId }

  const save = useMutation({
    mutationFn: () => setDeadlineSetting(kind.key, change),
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
    { value: '', label: props.responsibleLabel(kind) },
    ...people
      .filter((person) => person.active || person.userId === kind.setting.responsibleUserId)
      .map((person) => ({
        value: person.userId,
        label: person.userId === me ? `${person.name} (du)` : person.name,
      })),
  ]
  const words = counted === null ? null : props.intervalWords(kind)

  return (
    <Panel title={kind.title} roomy action={props.badge?.(kind) ?? null}>
      <div className="flex flex-col gap-3">
        <SettingsText>{kind.about}</SettingsText>
        <div
          className={
            counted === null
              ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'
              : 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]'
          }
        >
          {words === null ? null : (
            <Field
              label={words.label}
              numeric
              inputMode="numeric"
              unit={months === null ? 'Tage' : 'Monate'}
              className="sm:max-w-[96px]"
              value={intervalText}
              disabled={!mayWrite}
              onChange={(event) => {
                setIntervalText(event.target.value)
                setSaved(false)
              }}
              hint={words.hint}
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
          <span className="text-[13px] text-ink-muted">{props.actionsSentence(kind)}</span>
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
