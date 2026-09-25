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
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight, Play, Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'

import {
  Button,
  Field,
  Panel,
  SelectField,
  TextArea,
  useButtonLook,
} from '../../components/index.js'
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
import { SiteActionBar } from '../action-bar.js'
import { SiteHeader } from '../header.js'
import { SiteLink, SiteScreen, SiteText, SiteTrouble, TopTitle } from '../kit.js'

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
    <Panel title="Deine Zeit heute">
      <div className="flex flex-col gap-2">
        <SiteText>{`${hoursText(worked)} Arbeit und Fahrt erfasst.`}</SiteText>
        {running ? null : (
          <Button
            wide
            height={48}
            disabled={timing.busy}
            onClick={() => void timing.start({ kind: 'travel', jobId: null })}
          >
            Fahrt beginnen
          </Button>
        )}
        {timing.trouble ? <SiteTrouble>{timing.trouble}</SiteTrouble> : null}
        <p className="text-[17px]">
          <SiteLink to="/zeiten">Zeiten ansehen und nachtragen</SiteLink>
        </p>
      </div>
    </Panel>
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
    <Panel title="Deine Zeit hier">
      <div className="flex flex-col gap-1.5">
        <SiteText>
          {`${hoursText(minutesOf(here, 'work'))} Arbeit, ${hoursText(minutesOf(here, 'travel'))} Fahrt.`}
        </SiteText>
        {workingHere ? (
          <SiteText muted>{`Die Arbeit hier läuft seit ${clockOf(running.startedAt)}.`}</SiteText>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1">
            <Button
              wide
              height={52}
              icon={Play}
              disabled={timing.busy}
              onClick={() => void timing.start({ kind: 'work', jobId })}
            >
              Arbeit hier beginnen
            </Button>
            {running?.jobId === jobId && running.kind === 'travel' ? null : (
              <Button
                tone="quiet"
                wide
                height={44}
                disabled={timing.busy}
                onClick={() => void timing.start({ kind: 'travel', jobId })}
              >
                Fahrt hierher beginnen
              </Button>
            )}
          </div>
        )}
        {timing.trouble ? <SiteTrouble>{timing.trouble}</SiteTrouble> : null}
      </div>
    </Panel>
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

/** The day a path names, or today when it names none or no day at all. */
function dayOf(param: string | undefined): string {
  return param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today()
}

/** Where the times of a day are: today under "/zeiten", any other day under its date. */
export function dayPath(day: string): string {
  return day === today() ? '/zeiten' : `/zeiten/${day}`
}

/** "Heute" for today, the date for any other day. */
function dayTitle(day: string): string {
  return day === today() ? 'Heute' : date(day)
}

/**
 * A stretch typed in by hand, the board "Zeit nachtragen": the late entry for
 * the day somebody forgot to press, and the correction of an entry that is
 * wrong. A screen of its own with the two buttons at its foot, as the board
 * draws it, and back to the day once it is saved.
 *
 * An end before the start is taken as the next morning, which is how a night
 * job from ten to two gets written without a second date field. What would be
 * refused is said before anything goes into the outbox.
 */
export function SiteTimeEntryScreen() {
  const { day: dayParam, entryId } = useParams({ strict: false }) as {
    day?: string
    entryId?: string
  }
  const records = useMay('time.write')
  const me = useMe()
  const entries = useTimeEntries()
  const day = dayOf(dayParam)
  const correcting = entryId !== undefined
  const entry = useMemo(
    () =>
      entryId
        ? entriesOf(entries, me).find((candidate) => String(candidate['id']) === entryId)
        : undefined,
    [entries, me, entryId],
  )
  const title = correcting ? 'Zeit korrigieren' : 'Zeit nachtragen'

  if (!records || (correcting && !entry)) {
    return (
      <SiteScreen>
        <SiteHeader title={title} />
        <SiteText>
          {records
            ? 'Diesen Eintrag hat dieses Gerät nicht.'
            : 'Mit deiner Rolle erfasst du hier keine Zeiten.'}
        </SiteText>
      </SiteScreen>
    )
  }

  return (
    <SiteScreen gap={14}>
      <SiteHeader title={title} sub={dayTitle(day)} />
      {/* Remounted per entry, so a form never carries the values of another. */}
      <EntryForm key={entryId ?? day} day={day} {...(entry ? { entry } : {})} />
    </SiteScreen>
  )
}

function EntryForm({ day, entry }: { readonly day: string; readonly entry?: RecordState }) {
  const client = useSync()
  const navigate = useNavigate()
  const jobs = useRecords('jobs')
  const [kind, setKind] = useState<TimeEntryKind>(entry ? timeEntryKindOf(entry) : 'work')
  const [jobId, setJobId] = useState(entry ? (maybeText(entry, 'jobId') ?? '') : '')
  const [on, setOn] = useState(day)
  const [from, setFrom] = useState(entry ? clockOf(text(entry, 'startedAt')) : '')
  const [until, setUntil] = useState(entry ? clockOf(text(entry, 'endedAt')) : '')
  const [note, setNote] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const formId = useId()
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

    void navigate({ to: dayPath(on) })
  }

  return (
    <>
      <form
        id={formId}
        className="flex flex-col gap-3.5"
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
        <div className="grid grid-cols-2 items-start gap-2.5">
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
        </div>
        <TextArea
          label={entry ? 'Grund der Korrektur' : 'Notiz'}
          rows={3}
          value={note}
          required={Boolean(entry)}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
        {late ? <SiteText muted>{late}</SiteText> : null}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </form>
      <SiteActionBar>
        <Button
          wide
          className="flex-1 basis-0"
          onClick={() => {
            void navigate({ to: dayPath(day) })
          }}
        >
          Abbrechen
        </Button>
        <Button
          type="submit"
          form={formId}
          tone="primary"
          wide
          icon={Check}
          className="flex-2 basis-0"
        >
          {entry ? 'Korrektur sichern' : 'Nachtragen'}
        </Button>
      </SiteActionBar>
    </>
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
      className="mt-2 flex flex-col gap-3"
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
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" tone="danger" height={48}>
          Eintrag streichen
        </Button>
        <Button tone="quiet" height={48} onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/**
 * One entry of the day, as the card "Einträge" of the board "Zeiten, heute"
 * draws it: from when to when in bold, what and for which job, what it
 * replaced, whether it is up yet, and correcting or striking it.
 */
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
  const [withdrawing, setWithdrawing] = useState(false)
  const correctLook = useButtonLook('secondary', 'normal', 44)
  const start = text(entry, 'startedAt')
  const end = text(entry, 'endedAt')
  const pending = client.isPending('time_entries', String(entry['id']))

  return (
    <li className="border-b border-row py-2.5">
      <p className="text-[17px] leading-[1.4] [overflow-wrap:anywhere]">
        <b className="numeric font-semibold">{`${clockOf(start)} bis ${clockOf(end)}`}</b>
        {`, ${timeEntryKindLabel[timeEntryKindOf(entry)]}`}
        {job ? `, ${text(job, 'designation')}` : ''}
        {`, ${hoursText(minutesBetween(start, end))}`}
      </p>
      {replaced ? (
        <p className="mt-0.5 text-[15px] text-ink-muted">
          {`Korrigiert, vorher ${clockOf(text(replaced, 'startedAt'))} bis ${clockOf(text(replaced, 'endedAt'))}. Grund: ${text(entry, 'note')}`}
        </p>
      ) : maybeText(entry, 'note') ? (
        <p className="mt-0.5 text-[15px] text-ink-muted">{text(entry, 'note')}</p>
      ) : null}
      {pending ? (
        <p className="mt-0.5 text-[15px] font-semibold text-waiting">Noch nicht übertragen.</p>
      ) : null}
      {withdrawing ? (
        <WithdrawForm
          entry={entry}
          onDone={() => {
            setWithdrawing(false)
          }}
        />
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to={`/zeiten/${day}/korrigieren/${String(entry['id'])}`} className={correctLook}>
            Korrigieren
          </Link>
          <Button
            tone="danger"
            height={44}
            onClick={() => {
              setWithdrawing(true)
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
    <Panel title="Standort">
      <div className="flex flex-col gap-2.5">
        <SiteText size={16}>
          {given
            ? 'Du hast eingewilligt: beim Start und beim Stopp merkt sich das Gerät, wo du bist, und nirgends dazwischen.'
            : 'Ohne deine Einwilligung wird kein Standort erfasst. Mit ihr merkt sich das Gerät beim Start und beim Stopp, wo du bist, und nirgends dazwischen.'}
        </SiteText>
        <SiteText muted size={15}>
          Die Einwilligung ist freiwillig und lässt sich jederzeit widerrufen. Einträge danach
          tragen keinen Standort mehr.
        </SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
        <Button
          tone={given ? 'danger' : 'secondary'}
          wide
          height={48}
          disabled={busy}
          onClick={() => void answer(!given)}
        >
          {given ? 'Einwilligung widerrufen' : 'Einwilligen'}
        </Button>
      </div>
    </Panel>
  )
}

/** A step to the day before or after, a square button beside the title. */
function DayStep({
  to,
  label,
  icon: Icon,
}: {
  readonly to: string | null
  readonly label: string
  readonly icon: typeof ChevronLeft
}) {
  const look =
    'flex size-12 items-center justify-center rounded-control border border-control bg-surface text-ink'

  // No day after today: the step is there and cannot be taken.
  return to === null ? (
    <span aria-disabled="true" className={clsx(look, 'border-line text-disabled')}>
      <Icon size={22} strokeWidth={2.2} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  ) : (
    <Link to={to} aria-label={label} className={look}>
      <Icon size={22} strokeWidth={2.2} aria-hidden="true" />
    </Link>
  )
}

/**
 * One's own days, one at a time (#76), the board "Zeiten, heute": what was
 * recorded, what the Working Hours Act would say about it, the late entry and
 * the corrections.
 *
 * Only one's own, also for somebody whose role reads everybody's: on a phone
 * on site this is the diary of the person holding it. The office has the
 * overview of all.
 */
export function SiteTimeScreen() {
  const { day: dayParam } = useParams({ strict: false }) as { day?: string }
  const records = useMay('time.write')
  const me = useMe()
  const entries = useTimeEntries()
  const on = dayOf(dayParam)
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
  const addLook = useButtonLook('secondary', 'normal', 48)

  if (!records) {
    return (
      <SiteScreen>
        <TopTitle over="Zeiten" title="Zeiten" />
        <SiteText>Mit deiner Rolle erfasst du hier keine Zeiten.</SiteText>
      </SiteScreen>
    )
  }

  return (
    <SiteScreen>
      <TopTitle
        over="Zeiten"
        title={dayTitle(on)}
        right={
          <div className="flex gap-1.5">
            <DayStep to={dayPath(shiftDay(on, -1))} label="Vortag" icon={ChevronLeft} />
            <DayStep
              to={on >= today() ? null : dayPath(shiftDay(on, 1))}
              label="Folgetag"
              icon={ChevronRight}
            />
          </div>
        }
      />

      <Panel>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(['work', 'travel', 'break'] as const).map((kind) => (
            <div key={kind} className="flex flex-col-reverse">
              <dt className="text-[15px] text-ink-muted">{timeEntryKindLabel[kind]}</dt>
              <dd className="numeric text-[24px] font-bold">
                {hoursText(minutesOf(ofTheDay, kind))}
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      {warnings.length > 0 ? (
        <Panel title="Nach dem Arbeitszeitgesetz">
          <ul className="flex flex-col gap-2">
            {warnings.map((warning) => (
              <li
                key={warning.kind}
                className="text-[16px] leading-[1.45] font-semibold text-waiting"
              >
                {warning.text}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Einträge">
        <div className="flex flex-col gap-2">
          {ofTheDay.length === 0 && withdrawn.length === 0 ? (
            <SiteText muted>An diesem Tag ist nichts erfasst.</SiteText>
          ) : (
            <ul aria-label="Einträge" className="flex flex-col">
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
              {withdrawn.map((entry) => (
                <li
                  key={String(entry['id'])}
                  className="border-b border-row py-2.5 text-[16px] text-ink-faint"
                >
                  <s>
                    {`Gestrichen: ${clockOf(text(entry, 'startedAt'))} bis ${clockOf(text(entry, 'endedAt'))}, ${timeEntryKindLabel[timeEntryKindOf(entry)]}.`}
                  </s>
                  {` Grund: ${text(entry, 'note')}`}
                </li>
              ))}
            </ul>
          )}
          <Link to={`/zeiten/${on}/nachtragen`} className={clsx(addLook, 'w-full')}>
            <Plus size={20} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
            Zeit nachtragen
          </Link>
        </div>
      </Panel>

      <ConsentCard />
    </SiteScreen>
  )
}
