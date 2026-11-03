import { addDays, berlinInstant, type IsoDate } from '@opengewerk/domain'
import { Button, Field, Panel, SelectField } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { berlinMoment, clockOf, shortDays, weekdayIndex } from '../../app/appointments.js'
import { useMay } from '../../app/queries.js'
import { usePeople } from '../../app/tasks.js'
import {
  changeOnCallShift,
  createOnCallShift,
  type OnCallShift,
  onCallKey,
  onCallShifts,
  removeOnCallShift,
  swapOnCallShifts,
} from '../../session/on-call.js'

/**
 * The on-call plan (#293, Feature-Gliederung 4.1, 4.3): who is on call from
 * when until when, from today for eight weeks, with entering, changing,
 * swapping and taking back a time. Board "Rufbereitschaft" of the canvas,
 * version 125. Kept at the routes of the server with "Aufträge bearbeiten";
 * whoever lacks it sees the plan and changes nothing.
 */

const ahead = 56

function problemOf(error: unknown, otherwise: string): string {
  return error instanceof RequestRefused ? error.message : otherwise
}

/** The minute of the day a clock names, "17:00" as 1020. */
function minuteOf(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number)

  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** The day of a moment in Germany, as a date field shows it. */
function dayOf(at: string): IsoDate {
  return new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) as IsoDate
}

/** "Mo 02.11.2026, 17:00", in German time like every appointment. */
function whenOf(at: string): string {
  const day = dayOf(at)

  return `${shortDays[weekdayIndex(day)] ?? ''} ${berlinMoment(at)}`
}

interface Draft {
  userId: string
  fromDay: string
  fromClock: string
  untilDay: string
  untilClock: string
  note: string
}

function ShiftForm({
  shift,
  onDone,
}: {
  readonly shift: OnCallShift | null
  readonly onDone: () => void
}) {
  const queries = useQueryClient()
  const { people } = usePeople()
  const now = today() as IsoDate
  const [draft, setDraft] = useState<Draft>(
    shift
      ? {
          userId: shift.userId,
          fromDay: dayOf(shift.startsAt),
          fromClock: clockOf(shift.startsAt),
          untilDay: dayOf(shift.endsAt),
          untilClock: clockOf(shift.endsAt),
          note: shift.note ?? '',
        }
      : {
          userId: '',
          fromDay: now,
          fromClock: '17:00',
          untilDay: addDays(now, 7),
          untilClock: '07:00',
          note: '',
        },
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()

    if (draft.userId === '') {
      setTrouble('Eine Bereitschaft braucht die Person, die sie hat.')

      return
    }

    setWorking(true)
    setTrouble(null)

    const values = {
      userId: draft.userId,
      startsAt: berlinInstant(draft.fromDay as IsoDate, minuteOf(draft.fromClock)).toISOString(),
      endsAt: berlinInstant(draft.untilDay as IsoDate, minuteOf(draft.untilClock)).toISOString(),
      note: draft.note.trim() === '' ? null : draft.note.trim(),
    }

    try {
      await (shift ? changeOnCallShift(shift.id, values) : createOnCallShift(values))
      await queries.invalidateQueries({ queryKey: onCallKey })
      onDone()
    } catch (error) {
      setTrouble(problemOf(error, 'Die Bereitschaft ließ sich nicht speichern.'))
    } finally {
      setWorking(false)
    }
  }

  const set = (field: keyof Draft) => (value: string) => {
    setDraft({ ...draft, [field]: value })
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label="Person"
          starred
          value={draft.userId}
          options={[
            { value: '', label: 'Bitte wählen' },
            ...people
              .filter((person) => person.active)
              .map((person) => ({ value: person.userId, label: person.name })),
          ]}
          onChange={set('userId')}
        />
        <Field
          label="Notiz"
          value={draft.note}
          onChange={(event) => {
            set('note')(event.target.value)
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2.5">
        <div className="w-[150px]">
          <Field
            label="Beginn am"
            type="date"
            value={draft.fromDay}
            onChange={(event) => set('fromDay')(event.target.value)}
          />
        </div>
        <div className="w-[110px]">
          <Field
            label="um"
            type="time"
            value={draft.fromClock}
            onChange={(event) => set('fromClock')(event.target.value)}
          />
        </div>
        <div className="w-[150px]">
          <Field
            label="Ende am"
            type="date"
            value={draft.untilDay}
            onChange={(event) => set('untilDay')(event.target.value)}
          />
        </div>
        <div className="w-[110px]">
          <Field
            label="um"
            type="time"
            value={draft.untilClock}
            onChange={(event) => set('untilClock')(event.target.value)}
          />
        </div>
      </div>
      <p className="text-[13px] leading-[1.45] text-ink-muted">
        Nächte, Wochenenden und Feiertage gehören zu der Zeit, die sie umfasst. Wer Bereitschaft
        hat, legt in dieser Zeit auf seinem Telefon Serviceeinsätze an, auch ohne Netz.
      </p>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Abbrechen</Button>
        <Button type="submit" tone="primary" icon={Check} disabled={working}>
          {shift ? 'Speichern' : 'Bereitschaft eintragen'}
        </Button>
      </div>
    </form>
  )
}

function SwapForm({
  shift,
  others,
  names,
  onDone,
}: {
  readonly shift: OnCallShift
  readonly others: readonly OnCallShift[]
  readonly names: ReadonlyMap<string, string>
  readonly onDone: () => void
}) {
  const queries = useQueryClient()
  const candidates = others.filter(
    (other) => other.id !== shift.id && other.userId !== shift.userId,
  )
  const [other, setOther] = useState(candidates[0]?.id ?? '')
  const [trouble, setTrouble] = useState<string | null>(null)

  async function swap() {
    try {
      await swapOnCallShifts(shift.id, other)
      await queries.invalidateQueries({ queryKey: onCallKey })
      onDone()
    } catch (error) {
      setTrouble(problemOf(error, 'Das Tauschen ging nicht.'))
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[6px] border border-line bg-surface-sunken p-3">
      <p className="text-[14px] font-semibold">{`Bereitschaft von ${names.get(shift.userId) ?? 'Unbekannt'} tauschen`}</p>
      {candidates.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          Es gibt keine andere Bereitschaft einer anderen Person zum Tauschen.
        </p>
      ) : (
        <SelectField
          label="Tauschen mit"
          value={other}
          options={candidates.map((candidate) => ({
            value: candidate.id,
            label: `${names.get(candidate.userId) ?? 'Unbekannt'}, ${whenOf(candidate.startsAt)} bis ${whenOf(candidate.endsAt)}`,
          }))}
          onChange={setOther}
        />
      )}
      <p className="text-[13px] text-ink-muted">
        Die beiden tauschen die Personen, die Zeiten bleiben. Das Änderungsprotokoll hält fest, wer
        getauscht hat.
      </p>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Abbrechen</Button>
        <Button tone="primary" icon={Check} disabled={other === ''} onClick={() => void swap()}>
          Tauschen
        </Button>
      </div>
    </div>
  )
}

export function OnCallScreen() {
  const writes = useMay('job.write')
  const queries = useQueryClient()
  const { people } = usePeople()
  const names = new Map(people.map((person) => [person.userId, person.name]))
  // From the moment the screen opened, for eight weeks.
  const [{ from, to }] = useState(() => {
    const opened = Date.now()

    return {
      from: new Date(opened).toISOString(),
      to: new Date(opened + ahead * 86_400_000).toISOString(),
    }
  })
  const plan = useQuery({
    queryKey: [...onCallKey, from.slice(0, 13)],
    queryFn: () => onCallShifts(from, to),
    retry: false,
  })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [swapping, setSwapping] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const shifts = plan.data ?? []

  async function remove(shift: OnCallShift) {
    try {
      await removeOnCallShift(shift.id)
      await queries.invalidateQueries({ queryKey: onCallKey })
    } catch (error) {
      setTrouble(problemOf(error, 'Die Bereitschaft ließ sich nicht entfernen.'))
    }
  }

  return (
    <Screen>
      <PageHead
        crumbs={[{ to: '/plantafel', label: 'Plantafel' }]}
        phoneBack={{ to: '/plantafel', label: 'Plantafel' }}
        title="Rufbereitschaft"
        sub="Wer wann Bereitschaft hat, für Notdiensteinsätze bei Nacht, am Wochenende und an Feiertagen."
        actions={
          writes ? (
            <Button
              tone="primary"
              icon={Plus}
              disabled={adding}
              onClick={() => {
                setAdding(true)
                setEditing(null)
              }}
            >
              Bereitschaft eintragen
            </Button>
          ) : null
        }
      />

      <Panel
        title="Ab heute"
        action={
          shifts.length > 0 ? (
            <span className="text-[13px] text-ink-muted">
              {shifts.length === 1 ? '1 Zeit' : `${String(shifts.length)} Zeiten`}
            </span>
          ) : null
        }
      >
        {plan.isPending ? (
          <p className="text-[13px] text-ink-muted">Wird geladen.</p>
        ) : plan.isError ? (
          <NoteBox tone="waiting">{problemOf(plan.error, 'Der Plan kam nicht an.')}</NoteBox>
        ) : shifts.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            In den nächsten acht Wochen hat niemand Bereitschaft.
          </p>
        ) : (
          <ul className="flex flex-col">
            <li
              aria-hidden="true"
              className="hidden pb-1.5 text-[12px] font-semibold text-ink-muted sm:grid sm:grid-cols-[180px_190px_190px_minmax(0,1fr)] sm:gap-x-2"
            >
              <span>Person</span>
              <span>Beginn</span>
              <span>Ende</span>
              <span>Notiz</span>
            </li>
            {shifts.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-col gap-2 border-b border-row py-2.5 last:border-b-0"
              >
                {editing === shift.id ? (
                  <ShiftForm
                    shift={shift}
                    onDone={() => {
                      setEditing(null)
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:grid sm:grid-cols-[180px_190px_190px_minmax(0,1fr)_auto]">
                    <b className="w-full text-[14px] font-semibold sm:w-auto">
                      {names.get(shift.userId) ?? 'Unbekannt'}
                    </b>
                    <span className="numeric text-[14px]">{whenOf(shift.startsAt)}</span>
                    <span className="numeric text-[14px]">
                      <span className="sm:hidden">bis </span>
                      {whenOf(shift.endsAt)}
                    </span>
                    <span className="w-full text-[14px] text-ink-muted sm:w-auto">
                      {shift.note ?? ''}
                    </span>
                    {writes ? (
                      <span className="flex flex-wrap gap-1.5 sm:flex-nowrap sm:justify-end">
                        <Button
                          icon={Pencil}
                          onClick={() => {
                            setEditing(shift.id)
                            setSwapping(null)
                          }}
                        >
                          Bearbeiten
                        </Button>
                        <Button
                          icon={Repeat}
                          disabled={swapping === shift.id}
                          onClick={() => {
                            setSwapping(shift.id)
                            setEditing(null)
                          }}
                        >
                          Tauschen
                        </Button>
                        <Button icon={Trash2} onClick={() => void remove(shift)}>
                          Entfernen
                        </Button>
                      </span>
                    ) : null}
                  </div>
                )}
                {swapping === shift.id ? (
                  <SwapForm
                    shift={shift}
                    others={shifts}
                    names={names}
                    onDone={() => {
                      setSwapping(null)
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {trouble ? (
          <p role="alert" className="mt-2 text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </Panel>

      {adding ? (
        <Panel title="Neue Bereitschaft">
          <ShiftForm
            shift={null}
            onDone={() => {
              setAdding(false)
            }}
          />
        </Panel>
      ) : null}
    </Screen>
  )
}
