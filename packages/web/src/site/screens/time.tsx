import {
  effectiveEntries,
  hoursText,
  type IsoDate,
  lateRecordingText,
  minutesBetween,
  type RecordState,
  shippedRules,
  timeEntryKinds,
  type TimeEntryKind,
  workingTimeWarnings,
} from '@opengewerk/domain'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'

import { Button, Card, Field, FieldLabel, SelectField } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import {
  type Activity,
  clockOf,
  consentQuery,
  countingOn,
  discardStopwatch,
  entriesOf,
  instantOf,
  minutesOf,
  recordEntry,
  shiftDay,
  startingOn,
  startStopwatch,
  stopStopwatch,
  timed,
  timeEntryKindLabel,
  timeEntryKindOf,
  type Timing,
  useConsent,
  useMe,
  useMinute,
  useStopwatch,
  useTimeEntries,
  withdrawEntry,
} from '../../app/time.js'
import { answerLocationConsent } from '../../session/time.js'
import { refusalText, type EditResult } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useSync } from '../../sync/provider.js'

/** What a form or a button says back: nothing, or the sentence that went wrong. */
function outcomeText(result: EditResult | string | null): string | null {
  if (result === null) {
    return null
  }

  if (typeof result === 'string') {
    return result
  }

  return result.outcome === 'refused' ? refusalText[result.reason] : null
}

/** "Arbeit, Zählerschrank im Keller" or "Fahrt", as a running stopwatch names itself. */
function useActivityName(activity: Activity | null): string {
  const job = useRecord('jobs', activity?.jobId ?? undefined)

  if (!activity) {
    return ''
  }

  return job
    ? `${timeEntryKindLabel[activity.kind]}, ${text(job, 'designation')}`
    : timeEntryKindLabel[activity.kind]
}

/**
 * The buttons that start and stop, wherever they are shown.
 *
 * Everything goes through `startStopwatch` and `stopStopwatch`, which write an
 * entry through the outbox and never need a network. What the person consented
 * to is asked of the server and cached; without an answer, no place.
 */
function useTiming() {
  const client = useSync()
  const me = useMe()
  const consent = useConsent()
  const [trouble, setTrouble] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(step: (timing: Timing) => Promise<string | null>) {
    if (!me) {
      setTrouble('Wer angemeldet ist, weiß das Gerät gerade nicht. Bitte einmal mit Netz öffnen.')

      return
    }

    setBusy(true)
    setTrouble(null)

    try {
      setTrouble(await step({ client, me, consent }))
    } finally {
      setBusy(false)
    }
  }

  return {
    trouble,
    busy,
    start: (activity: Activity, resume: Activity | null = null) =>
      run((timing) => startStopwatch(timing, activity, resume)),
    stop: () => run((timing) => stopStopwatch(timing)),
    discard: () =>
      run(async () => {
        await discardStopwatch(client)

        return null
      }),
  }
}

/**
 * The stopwatch across the top of every screen on site, while it runs.
 *
 * Visible wherever somebody is, because the one thing a stopwatch must not do
 * is run on unnoticed; the forgotten one is the one that becomes a wrong
 * record. The buttons are the next step from what runs: a break and the end
 * from work, the arrival from travel, going on from a break.
 *
 * Drawn as on the board "Leisten auf der Baustelle", with one correction: the
 * board pressed "Fahrt" into a column one letter wide beside "Angekommen,
 * Arbeit beginnen". Here the sentence keeps a width of its own, and the
 * buttons move under it when both do not fit.
 */
export function StopwatchBar() {
  const running = useStopwatch()
  const minute = useMinute()
  const name = useActivityName(running)
  const timing = useTiming()

  if (!running) {
    return null
  }

  const elapsed = Math.max(0, minute - Math.floor(Date.parse(running.startedAt) / 60_000))
  const forgotten = elapsed > 24 * 60
  // The day as well, once it is not today: "seit 07:30" on the next morning
  // reads as half an hour ago.
  const startedOn = date(running.startedAt)
  const since =
    startedOn === date(today())
      ? clockOf(running.startedAt)
      : `${startedOn}, ${clockOf(running.startedAt)}`

  return (
    <section
      aria-label="Zeitnehmer"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2.5 border-b border-line bg-surface-sunken"
    >
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full bg-copper shadow-[0_0_0_4px_rgb(200_103_31/0.18)]"
      />
      <div className="min-w-0 grow basis-40 leading-[1.25]">
        <div className="text-[15px] font-semibold [overflow-wrap:anywhere]">{name}</div>
        <div className="text-[14px] text-ink-muted numeric">{`seit ${since}, ${hoursText(elapsed)}`}</div>
      </div>
      <div className="ml-auto flex shrink-0 gap-1.5">
        {running.kind === 'work' ? (
          <StopwatchButton
            disabled={timing.busy}
            onClick={() => void timing.start({ kind: 'break', jobId: null }, running)}
          >
            Pause
          </StopwatchButton>
        ) : null}
        {running.kind === 'travel' && running.jobId ? (
          <StopwatchButton
            disabled={timing.busy}
            onClick={() => void timing.start({ kind: 'work', jobId: running.jobId })}
          >
            Angekommen, Arbeit beginnen
          </StopwatchButton>
        ) : null}
        {running.kind === 'break' && running.resume ? (
          <StopwatchButton
            disabled={timing.busy}
            onClick={() => {
              if (running.resume) {
                void timing.start(running.resume)
              }
            }}
          >
            Weiter arbeiten
          </StopwatchButton>
        ) : null}
        {forgotten ? (
          <StopwatchButton
            tone="danger"
            disabled={timing.busy}
            onClick={() => void timing.discard()}
          >
            Verwerfen
          </StopwatchButton>
        ) : null}
        <StopwatchButton tone="primary" disabled={timing.busy} onClick={() => void timing.stop()}>
          Stopp
        </StopwatchButton>
      </div>
      {timing.trouble ? (
        <p role="alert" className="basis-full text-body font-semibold text-conflict">
          {timing.trouble}
          {forgotten
            ? ' Die echte Zeit lässt sich unter "Zeiten" nachtragen, danach den Zeitnehmer verwerfen.'
            : ''}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The buttons in the stopwatch strip: 40 pixels as drawn, so the strip stays a
 * strip and does not become a toolbar, and 44 that take a tap, through the
 * pseudo element that reaches past them.
 */
function StopwatchButton({
  tone = 'secondary',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly tone?: 'primary' | 'secondary' | 'danger'
}) {
  return (
    <button
      type="button"
      className={clsx(
        'relative inline-flex min-h-10 items-center justify-center rounded-[5px] px-3 text-[15px] font-semibold cursor-pointer',
        'before:absolute before:inset-x-0 before:-inset-y-0.5',
        'disabled:cursor-not-allowed disabled:opacity-60',
        tone === 'primary'
          ? 'bg-copper-solid text-on-copper'
          : tone === 'danger'
            ? 'bg-surface text-conflict border border-conflict'
            : 'bg-surface text-ink border border-line-strong',
      )}
      {...rest}
    />
  )
}

/**
 * The day so far, at the top of the start screen: how much has been worked,
 * and the way to travel, a late entry and the list of the day. Starting work
 * happens at a job, where it has something to belong to.
 */
export function TodayTime() {
  const records = useMay('time.write')
  const me = useMe()
  const running = useStopwatch()
  const entries = useTimeEntries()
  const timing = useTiming()
  const on = today() as IsoDate
  const worked = useMemo(() => minutesOf(countingOn(entriesOf(entries, me), on)), [entries, me, on])

  if (!records) {
    return null
  }

  return (
    <Card
      label="Deine Zeit"
      heading={<h2 className="text-body font-semibold">Deine Zeit heute</h2>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-body">{`${hoursText(worked)} Arbeit und Fahrt erfasst.`}</p>
        {running ? null : (
          <Button
            wide
            disabled={timing.busy}
            onClick={() => void timing.start({ kind: 'travel', jobId: null })}
          >
            Fahrt beginnen
          </Button>
        )}
        {timing.trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {timing.trouble}
          </p>
        ) : null}
        <Link
          to="/zeiten"
          className="inline-flex items-center h-control min-h-tap text-body font-semibold text-copper-text"
        >
          Zeiten ansehen und nachtragen
        </Link>
      </div>
    </Card>
  )
}

/**
 * Work and travel at one job, from the job's own screen: the place where it
 * is clear what the time belongs to. Shows what is recorded for the job so
 * far, one's own time only.
 */
export function JobTime({ job }: { readonly job: RecordState }) {
  const records = useMay('time.write')
  const me = useMe()
  const running = useStopwatch()
  const entries = useTimeEntries()
  const timing = useTiming()
  const jobId = String(job['id'])
  const here = useMemo(
    () =>
      effectiveEntries(entriesOf(entries, me)).filter(
        (entry) => maybeText(entry, 'jobId') === jobId,
      ),
    [entries, me, jobId],
  )

  if (!records) {
    return null
  }

  const workingHere = running?.jobId === jobId && running.kind === 'work'

  return (
    <Card label="Zeit" heading={<h2 className="text-body font-semibold">Deine Zeit hier</h2>}>
      <div className="flex flex-col gap-3">
        <p className="text-body">
          {`${hoursText(minutesOf(here, 'work'))} Arbeit, ${hoursText(minutesOf(here, 'travel'))} Fahrt.`}
        </p>
        {workingHere ? (
          <p className="text-body text-ink-muted">{`Die Arbeit hier läuft seit ${clockOf(running.startedAt)}.`}</p>
        ) : (
          <>
            <Button
              tone="secondary"
              wide
              disabled={timing.busy}
              onClick={() => void timing.start({ kind: 'work', jobId })}
            >
              Arbeit hier beginnen
            </Button>
            {running?.jobId === jobId && running.kind === 'travel' ? null : (
              <Button
                tone="quiet"
                wide
                disabled={timing.busy}
                onClick={() => void timing.start({ kind: 'travel', jobId })}
              >
                Fahrt hierher beginnen
              </Button>
            )}
          </>
        )}
        {timing.trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {timing.trouble}
          </p>
        ) : null}
      </div>
    </Card>
  )
}

/**
 * What to say about recording a day this late, or null. A day being typed is
 * no day yet, and one before the rules begin has nothing to say either.
 */
function lateText(on: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
    return null
  }

  try {
    return lateRecordingText(on as IsoDate, today() as IsoDate, shippedRules)
  } catch {
    return null
  }
}

interface EntryFormProps {
  readonly day: string
  readonly entry?: RecordState
  readonly onDone: () => void
}

/**
 * A stretch typed in by hand: the late entry for the day somebody forgot to
 * press, and the correction of an entry that is wrong.
 *
 * An end before the start is taken as the next morning, which is how a night
 * job from ten to two gets written without a second date field. What would be
 * refused is said before anything goes into the outbox.
 */
function EntryForm({ day, entry, onDone }: EntryFormProps) {
  const client = useSync()
  const jobs = useRecords('jobs')
  const [kind, setKind] = useState<TimeEntryKind>(entry ? timeEntryKindOf(entry) : 'work')
  const [jobId, setJobId] = useState(entry ? (maybeText(entry, 'jobId') ?? '') : '')
  const [on, setOn] = useState(day)
  const [from, setFrom] = useState(entry ? clockOf(text(entry, 'startedAt')) : '')
  const [until, setUntil] = useState(entry ? clockOf(text(entry, 'endedAt')) : '')
  const [note, setNote] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  // Said for a late entry, not for a correction: what the law dates is the
  // record, and a correction puts right a record that was made.
  const late = entry ? null : lateText(on)
  const jobOptions = useMemo(
    () => [
      { value: '', label: 'Keinem Auftrag' },
      ...[...jobs]
        .sort((left, right) => text(left, 'designation').localeCompare(text(right, 'designation')))
        .map((job) => ({ value: String(job['id']), label: text(job, 'designation') })),
    ],
    [jobs],
  )

  async function save() {
    const startedAt = instantOf(on, from)
    const endsOn = until <= from ? shiftDay(on, 1) : on
    const endedAt = instantOf(endsOn, until)

    if (!startedAt || !endedAt) {
      setTrouble('Bitte Tag, Beginn und Ende angeben.')

      return
    }

    const result = await recordEntry(
      client,
      {
        kind,
        jobId: jobId === '' ? null : jobId,
        startedAt,
        endedAt,
        note: note.trim() === '' ? null : note.trim(),
      },
      entry ? String(entry['id']) : null,
    )
    const problem = outcomeText(result)

    if (problem) {
      setTrouble(problem)

      return
    }

    onDone()
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <SelectField
        label="Art"
        value={kind}
        options={timeEntryKinds.map((value) => ({ value, label: timeEntryKindLabel[value] }))}
        onChange={(value) => {
          setKind(value as TimeEntryKind)
        }}
      />
      <SelectField label="Auftrag" value={jobId} options={jobOptions} onChange={setJobId} />
      <Field
        label="Tag"
        type="date"
        value={on}
        max={today()}
        onChange={(event) => {
          setOn(event.target.value)
        }}
      />
      <Field
        label="Beginn"
        type="time"
        value={from}
        onChange={(event) => {
          setFrom(event.target.value)
        }}
      />
      <Field
        label="Ende"
        type="time"
        value={until}
        hint={
          from !== '' && until !== '' && until <= from
            ? 'Das Ende liegt am nächsten Tag.'
            : undefined
        }
        onChange={(event) => {
          setUntil(event.target.value)
        }}
      />
      <Field
        label={entry ? 'Grund der Korrektur' : 'Notiz'}
        value={note}
        required={Boolean(entry)}
        onChange={(event) => {
          setNote(event.target.value)
        }}
      />
      {late ? <p className="text-body text-ink-muted">{late}</p> : null}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" tone="primary" wide>
          {entry ? 'Korrektur sichern' : 'Nachtragen'}
        </Button>
        <Button tone="quiet" wide onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/** Taking an entry back, with the reason the law wants beside it. */
function WithdrawForm({
  entry,
  onDone,
}: {
  readonly entry: RecordState
  readonly onDone: () => void
}) {
  const client = useSync()
  const [reason, setReason] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void withdrawEntry(client, entry, reason).then((result) => {
          const problem = outcomeText(result)

          if (problem) {
            setTrouble(problem)
          } else {
            onDone()
          }
        })
      }}
    >
      <Field
        label="Warum dieser Eintrag nicht gilt"
        value={reason}
        required
        onChange={(event) => {
          setReason(event.target.value)
        }}
      />
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" tone="danger" wide>
          Eintrag streichen
        </Button>
        <Button tone="quiet" wide onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/** One entry of the day, with what it replaced and what can still be done about it. */
function EntryRow({
  entry,
  replaced,
  day,
}: {
  readonly entry: RecordState
  readonly replaced: RecordState | null
  readonly day: string
}) {
  const client = useSync()
  const job = useRecord('jobs', maybeText(entry, 'jobId') ?? undefined)
  const [doing, setDoing] = useState<'correct' | 'withdraw' | null>(null)
  const start = text(entry, 'startedAt')
  const end = text(entry, 'endedAt')
  const pending = client.isPending('time_entries', String(entry['id']))

  return (
    <li className="flex flex-col gap-2 p-3 rounded-card border border-line bg-surface">
      <p className="text-body">
        <span className="font-semibold numeric">{`${clockOf(start)} bis ${clockOf(end)}`}</span>
        {`, ${timeEntryKindLabel[timeEntryKindOf(entry)]}`}
        {job ? `, ${text(job, 'designation')}` : ''}
        {`, ${hoursText(minutesBetween(start, end))}`}
      </p>
      {replaced ? (
        <p className="text-table text-ink-muted">
          {`Korrigiert, vorher ${clockOf(text(replaced, 'startedAt'))} bis ${clockOf(text(replaced, 'endedAt'))}. Grund: ${text(entry, 'note')}`}
        </p>
      ) : maybeText(entry, 'note') ? (
        <p className="text-table text-ink-muted">{text(entry, 'note')}</p>
      ) : null}
      {pending ? <p className="text-table text-ink-muted">Noch nicht übertragen.</p> : null}
      {doing === 'correct' ? (
        <EntryForm
          day={day}
          entry={entry}
          onDone={() => {
            setDoing(null)
          }}
        />
      ) : doing === 'withdraw' ? (
        <WithdrawForm
          entry={entry}
          onDone={() => {
            setDoing(null)
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setDoing('correct')
            }}
          >
            Korrigieren
          </Button>
          <Button
            tone="quiet"
            onClick={() => {
              setDoing('withdraw')
            }}
          >
            Streichen
          </Button>
        </div>
      )}
    </li>
  )
}

/**
 * Consent to recording one's place, and taking it back (4.4 ⚖).
 *
 * Asked of the server and answered to it: a consent that only a phone knew
 * about would be no record of one, and a withdrawal has to count from the
 * moment it is said. Without a network the card says so and changes nothing.
 */
function ConsentCard() {
  const queries = useQueryClient()
  const given = useConsent()
  const [trouble, setTrouble] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function answer(value: boolean) {
    setBusy(true)
    setTrouble(null)

    try {
      queries.setQueryData(consentQuery.queryKey, await answerLocationConsent(value))
    } catch {
      setTrouble('Dafür braucht das Gerät eine Verbindung. Bis dahin bleibt es, wie es ist.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card label="Standort" heading={<h2 className="text-body font-semibold">Standort</h2>}>
      <div className="flex flex-col gap-3">
        <p className="text-body">
          {given
            ? 'Du hast eingewilligt: beim Start und beim Stopp merkt sich das Gerät, wo du bist, und nirgends dazwischen.'
            : 'Ohne deine Einwilligung wird kein Standort erfasst. Mit ihr merkt sich das Gerät beim Start und beim Stopp, wo du bist, und nirgends dazwischen.'}
        </p>
        <p className="text-table text-ink-muted">
          Die Einwilligung ist freiwillig und lässt sich jederzeit widerrufen. Einträge danach
          tragen keinen Standort mehr.
        </p>
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <Button
          tone={given ? 'danger' : 'secondary'}
          wide
          disabled={busy}
          onClick={() => void answer(!given)}
        >
          {given ? 'Einwilligung widerrufen' : 'Einwilligen'}
        </Button>
      </div>
    </Card>
  )
}

/**
 * One's own days, one at a time (#76): what was recorded, what the Working
 * Hours Act would say about it, the late entry and the corrections.
 *
 * Only one's own, also for somebody whose role reads everybody's: on a phone
 * on site this is the diary of the person holding it. The office has the
 * overview of all.
 */
export function SiteTimeScreen() {
  const records = useMay('time.write')
  const me = useMe()
  const entries = useTimeEntries()
  const [on, setOn] = useState<string>(today())
  const [adding, setAdding] = useState(false)
  const mine = useMemo(() => entriesOf(entries, me), [entries, me])
  const counting = useMemo(() => effectiveEntries(mine), [mine])
  const ofTheDay = useMemo(() => startingOn(counting, on as IsoDate), [counting, on])
  const byId = useMemo(() => new Map(mine.map((entry) => [String(entry['id']), entry])), [mine])
  const withdrawn = useMemo(
    () => startingOn(mine, on as IsoDate).filter((entry) => entry['withdrawn'] === true),
    [mine, on],
  )
  const warnings = useMemo(
    () => workingTimeWarnings(counting.map(timed), on as IsoDate, shippedRules),
    [counting, on],
  )

  if (!records) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-title font-semibold">Zeiten</h1>
        <p className="text-body">Mit deiner Rolle erfasst du hier keine Zeiten.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <FieldLabel>Zeiten</FieldLabel>
        <h1 className="text-title font-semibold">{on === today() ? 'Heute' : date(on)}</h1>
      </div>

      <div className="flex gap-2">
        <Button
          wide
          onClick={() => {
            setOn(shiftDay(on, -1))
          }}
        >
          Vortag
        </Button>
        <Button
          wide
          disabled={on >= today()}
          onClick={() => {
            setOn(shiftDay(on, 1))
          }}
        >
          Folgetag
        </Button>
      </div>

      <Card label="Summe">
        <dl className="grid grid-cols-3 gap-3">
          {(['work', 'travel', 'break'] as const).map((kind) => (
            <div key={kind}>
              <dt>
                <FieldLabel>{timeEntryKindLabel[kind]}</FieldLabel>
              </dt>
              <dd className="text-body numeric">{hoursText(minutesOf(ofTheDay, kind))}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {warnings.length > 0 ? (
        <Card
          label="Hinweise"
          heading={<h2 className="text-body font-semibold">Nach dem Arbeitszeitgesetz</h2>}
        >
          <ul className="flex flex-col gap-2">
            {warnings.map((warning) => (
              <li key={warning.kind} className="text-body">
                {warning.text}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card label="Einträge" heading={<h2 className="text-body font-semibold">Einträge</h2>}>
        <div className="flex flex-col gap-3">
          {ofTheDay.length === 0 ? (
            <p className="text-body text-ink-muted">An diesem Tag ist nichts erfasst.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ofTheDay.map((entry) => {
                const corrects = maybeText(entry, 'correctsEntryId')

                return (
                  <EntryRow
                    key={String(entry['id'])}
                    entry={entry}
                    replaced={corrects ? (byId.get(corrects) ?? null) : null}
                    day={on}
                  />
                )
              })}
            </ul>
          )}
          {withdrawn.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {withdrawn.map((entry) => (
                <li key={String(entry['id'])} className="text-table text-ink-muted">
                  {`Gestrichen: ${clockOf(text(entry, 'startedAt'))} bis ${clockOf(text(entry, 'endedAt'))}, ${timeEntryKindLabel[timeEntryKindOf(entry)]}. Grund: ${text(entry, 'note')}`}
                </li>
              ))}
            </ul>
          ) : null}
          {adding ? (
            <EntryForm
              day={on}
              onDone={() => {
                setAdding(false)
              }}
            />
          ) : (
            <Button
              wide
              onClick={() => {
                setAdding(true)
              }}
            >
              Zeit nachtragen
            </Button>
          )}
        </div>
      </Card>

      <ConsentCard />
    </div>
  )
}
