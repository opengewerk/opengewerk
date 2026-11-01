import {
  addDays,
  appointmentProblem,
  berlinInstant,
  berlinWall,
  daysBetween,
  type IsoDate,
  nextOccurrence,
  parseRule,
  type RepeatFrequency,
  type RecordState,
  ruleOf,
  weekdayOf,
} from '@opengewerk/domain'
import {
  Button,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  Strip,
  TextArea,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { PageHead, Screen } from '@opengewerk/platform-web/office'
import {
  maybeText,
  RequestRefused,
  text,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Check,
  ChevronLeft,
  Clock,
  GripVertical,
  Plus,
  Repeat,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  type AppointmentRow,
  appointmentOf,
  clockOf,
  dayMonth,
  longDays,
  mondayOf,
  type Placed,
  type PersonRow,
  personOf,
  placeOnBoard,
  shifted,
  shortDays,
  weekdayIndex,
} from '../../app/appointments.js'
import { useMay } from '../../app/queries.js'
import { usePeople } from '../../app/tasks.js'
import {
  type AppointmentBody,
  type BoardAbsence,
  boardFacts,
  boardKey,
  changeAppointment,
  createAppointment,
  removeAppointment,
} from '../../session/appointments.js'

/**
 * The planning board (#290, Feature-Gliederung 4.3): a row for everybody who
 * can be sent somewhere, a week or four next to each other, and at the edge
 * the open jobs without an appointment from today on. Boards "Plantafel",
 * "Plantafel, vier Wochen", "Plantafel, Tablet", "Termin anlegen",
 * "Serientermin bearbeiten" and "inzwischen geändert" of the canvas,
 * version 98.
 *
 * The appointments come from the device, which holds all of them in the
 * office; who is away and the public holidays from the server. Moving,
 * lengthening and handing to somebody else is done with mouse or finger, and
 * all of it as well in the form an appointment opens with a click or the
 * keyboard (WCAG 2.2, 2.5.7). A series is not dragged: its form changes it as
 * a whole or takes out the day it was opened from. Every change goes to the
 * route with the version the board read; changed in the meantime, the board
 * says so and shows the new state.
 */

type View = 'week' | 'four'

const moved = 'Den Termin hat inzwischen jemand anders geändert.'
const offline = 'Keine Verbindung. Termine ändern sich nur mit Verbindung.'

function problemOf(error: unknown): string {
  if (error instanceof RequestRefused) {
    return error.message
  }

  return error instanceof TypeError ? offline : 'Das hat nicht geklappt.'
}

function bodyOf(appointment: AppointmentRow, userIds: readonly string[]): AppointmentBody {
  return {
    jobId: appointment.jobId,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    note: appointment.note,
    rrule: appointment.rrule,
    exdates: appointment.exdates,
    userIds,
  }
}

/** "AU-2026-0212, Wallbox Garage, Familie Weber", as the form offers a job. */
function jobLabel(job: RecordState, customers: ReadonlyMap<string, string>): string {
  const number = maybeText(job, 'number') ?? 'Nummer folgt'
  const customer = customers.get(text(job, 'customerId'))

  return [number, text(job, 'designation'), customer].filter(Boolean).join(', ')
}

function columnsOf(start: IsoDate, days: number): string {
  if (days === 7) {
    return '140px repeat(5, minmax(0, 1fr)) repeat(2, minmax(0, 0.6fr))'
  }

  return `120px ${Array.from({ length: days }, (_, n) =>
    weekdayIndex(addDays(start, n)) >= 5 ? 'minmax(0, 0.5fr)' : 'minmax(0, 1fr)',
  ).join(' ')}`
}

interface Asking {
  readonly appointment: AppointmentRow | null
  /** The day of a series the form was opened from. */
  readonly openedOn: IsoDate | null
  readonly jobId?: string
  readonly userId?: string
  readonly day?: IsoDate
}

interface Dragging {
  readonly kind: 'move' | 'extend' | 'job'
  readonly placed: Placed | null
  readonly jobId: string | null
  readonly x: number
  readonly y: number
  moved: boolean
}

export function PlanningScreen() {
  const client = useSync()
  const status = useSyncStatus()
  const mayWrite = useMay('job.write')
  const [view, setView] = useState<View>('week')
  const [start, setStart] = useState<IsoDate>(() => mondayOf(today()))
  const days = view === 'week' ? 7 : 28
  const to = addDays(start, days - 1)
  const compact = view === 'four'
  const appointmentRecords = useRecords('appointments')
  const personRecords = useRecords('appointment_people')
  const jobRecords = useRecords('jobs')
  const customerRecords = useRecords('customers')
  const { people: staff } = usePeople()
  const facts = useQuery({
    queryKey: [...boardKey, start, to],
    queryFn: () => boardFacts(start, to),
    retry: false,
  })
  const [asking, setAsking] = useState<Asking | null>(null)
  const [trouble, setTrouble] = useState<{ title: string; detail: string | null } | null>(null)
  const [target, setTarget] = useState<{ userId: string; day: IsoDate } | null>(null)
  const dragging = useRef<Dragging | null>(null)
  const dragged = useRef(false)

  const appointments = useMemo(() => appointmentRecords.map(appointmentOf), [appointmentRecords])
  const people = useMemo(() => personRecords.map(personOf), [personRecords])
  const absences = useMemo(() => facts.data?.absences ?? [], [facts.data])
  const holidays = useMemo(
    () => new Map((facts.data?.holidays ?? []).map((holiday) => [holiday.on, holiday.name])),
    [facts.data],
  )
  const rows = useMemo(
    () => placeOnBoard(appointments, people, start, to, absences),
    [appointments, people, start, to, absences],
  )
  const customers = useMemo(
    () =>
      new Map(customerRecords.map((customer) => [text(customer, 'id'), text(customer, 'name')])),
    [customerRecords],
  )
  const jobFacts = useMemo(
    () =>
      new Map(
        jobRecords.map((job) => [
          text(job, 'id'),
          {
            number: maybeText(job, 'number') ?? 'Nummer folgt',
            title: text(job, 'designation'),
            customer: customers.get(text(job, 'customerId')) ?? '',
          },
        ]),
      ),
    [jobRecords, customers],
  )
  const openJobs = useMemo(
    () => jobRecords.filter((job) => ['draft', 'active'].includes(text(job, 'status'))),
    [jobRecords],
  )
  const waiting = useMemo(() => {
    const now = new Date()
    const planned = new Set(
      appointments
        .filter((appointment) => nextOccurrence(appointment, now) !== null)
        .map((appointment) => appointment.jobId),
    )

    return openJobs.filter((job) => !planned.has(text(job, 'id')))
  }, [appointments, openJobs])
  // Everybody who can still be sent somewhere, and whoever has an appointment shown.
  const shownPeople = staff.filter((person) => person.active || rows.has(person.userId))
  const canChange = mayWrite && status.online

  async function save(work: () => Promise<unknown>) {
    setTrouble(null)

    try {
      await work()
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused && error.status === 409
          ? {
              title: moved,
              detail:
                'Die Tafel zeigt jetzt den neuen Stand. Verschieb ihn noch einmal, wenn es dabei bleiben soll.',
            }
          : { title: problemOf(error), detail: null },
      )
    } finally {
      await client.synchronise()
    }
  }

  function drop(drag: Dragging, at: { userId: string; day: IsoDate }) {
    if (drag.kind === 'job' && drag.jobId !== null) {
      setAsking({
        appointment: null,
        openedOn: null,
        jobId: drag.jobId,
        userId: at.userId,
        day: at.day,
      })

      return
    }

    const placed = drag.placed

    if (placed === null) {
      return
    }

    const { appointment, occurrence, person } = placed

    if (drag.kind === 'extend') {
      const longer = daysBetween(occurrence.lastDay, at.day)

      if (at.day < occurrence.firstDay || longer === 0) {
        return
      }

      void save(() =>
        changeAppointment(
          appointment.id,
          {
            ...bodyOf(
              appointment,
              people
                .filter((each) => each.appointmentId === appointment.id)
                .map((each) => each.userId),
            ),
            ...shifted(appointment, 0, longer),
          },
          appointment.version,
        ),
      )

      return
    }

    const by = daysBetween(occurrence.firstDay, at.day)
    const others = people
      .filter((each) => each.appointmentId === appointment.id && each.userId !== person.userId)
      .map((each) => each.userId)
    const userIds = [...new Set([...others, at.userId])]

    if (by === 0 && at.userId === person.userId) {
      return
    }

    void save(() =>
      changeAppointment(
        appointment.id,
        { ...bodyOf(appointment, userIds), ...shifted(appointment, by, by) },
        appointment.version,
      ),
    )
  }

  function begin(event: ReactPointerEvent<HTMLElement>, drag: Omit<Dragging, 'x' | 'y' | 'moved'>) {
    if (!canChange || event.button !== 0) {
      return
    }

    dragging.current = { ...drag, x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function follow(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragging.current

    if (drag === null) {
      return
    }

    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) {
      return
    }

    drag.moved = true

    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-day]')
    const day = cell?.getAttribute('data-day')
    const userId = cell?.getAttribute('data-user')

    setTarget(day && userId ? { userId, day } : null)
  }

  function end() {
    const drag = dragging.current

    dragging.current = null

    if (drag?.moved) {
      dragged.current = true

      if (target !== null) {
        drop(drag, target)
      }
    }

    setTarget(null)
  }

  const dragProps = { onPointerMove: follow, onPointerUp: end, onPointerCancel: end }

  const open = (asked: Asking) => {
    if (dragged.current) {
      dragged.current = false

      return
    }

    setTrouble(null)
    setAsking(asked)
  }

  const week = `${date(start)} bis ${date(to)}`

  return (
    <Screen>
      {trouble !== null ? (
        <Strip tone="conflict" detail={trouble.detail}>
          {trouble.title}
        </Strip>
      ) : null}
      <PageHead
        title="Plantafel"
        sub={view === 'week' ? `Woche vom ${week}` : `Vier Wochen vom ${week}`}
        actions={
          <>
            <Button
              icon={ChevronLeft}
              onClick={() => {
                setStart(addDays(start, view === 'week' ? -7 : -28))
              }}
            >
              Zurück
            </Button>
            <Button
              onClick={() => {
                setStart(mondayOf(today()))
              }}
            >
              Heute
            </Button>
            <Button
              onClick={() => {
                setStart(addDays(start, view === 'week' ? 7 : 28))
              }}
            >
              Weiter
            </Button>
            <div className="flex gap-1.5">
              {(
                [
                  ['week', 'Woche'],
                  ['four', 'Vier Wochen'],
                ] as const
              ).map(([which, label]) => (
                <Button
                  key={which}
                  size="small"
                  tone={view === which ? 'dark' : 'secondary'}
                  aria-pressed={view === which}
                  onClick={() => {
                    setView(which)
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            {mayWrite ? (
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  open({ appointment: null, openedOn: null })
                }}
              >
                Termin anlegen
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col items-start gap-[14px] min-[1180px]:flex-row">
        <div className="flex w-full min-w-0 flex-col gap-2.5">
          <section
            aria-label="Plantafel"
            className="overflow-hidden rounded-[6px] border border-line bg-surface"
          >
            <HeadRow start={start} days={days} compact={compact} holidays={holidays} />
            {shownPeople.map((person) => (
              <PersonRow
                key={person.userId}
                name={person.name}
                userId={person.userId}
                start={start}
                days={days}
                compact={compact}
                holidays={holidays}
                absences={absences.filter((absence) => absence.userId === person.userId)}
                row={rows.get(person.userId)}
                jobs={jobFacts}
                target={target}
                canChange={canChange}
                onOpen={(placed) => {
                  open({
                    appointment: placed.appointment,
                    openedOn: placed.appointment.rrule === null ? null : placed.occurrence.firstDay,
                  })
                }}
                onBegin={begin}
                dragProps={dragProps}
              />
            ))}
          </section>
          <Legend compact={compact} />
          {compact ? (
            <p className="m-0 text-[13px] text-ink-faint">
              Vier Wochen zeigen die letzten vier Ziffern des Auftrags. Was ein Termin ist, sagt
              sein Formular; Aufträge ohne Termin stehen in der Ansicht „Woche“.
            </p>
          ) : null}
        </div>
        {compact ? null : (
          <div className="w-full shrink-0 min-[1180px]:w-[210px]">
            <Panel title={`Ohne Termin (${String(waiting.length)})`}>
              <div className="flex flex-col gap-2.5">
                <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[600px]:grid-cols-3 min-[1180px]:grid-cols-1">
                  {waiting.map((job) => (
                    <li key={text(job, 'id')}>
                      <button
                        type="button"
                        className={clsx(
                          'flex w-full gap-1.5 rounded-[4px] border border-line bg-surface p-2 text-left',
                          canChange ? 'cursor-grab touch-none' : 'cursor-pointer',
                        )}
                        onPointerDown={(event) => {
                          begin(event, { kind: 'job', placed: null, jobId: text(job, 'id') })
                        }}
                        {...dragProps}
                        onClick={() => {
                          open({ appointment: null, openedOn: null, jobId: text(job, 'id') })
                        }}
                      >
                        <GripVertical
                          size={15}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="mt-px shrink-0 text-ink-faint"
                        />
                        <span className="min-w-0">
                          <span className="flex gap-1.5 text-[12px] text-ink-muted">
                            <b className="font-semibold text-ink tabular-nums">
                              {maybeText(job, 'number') ?? 'Nummer folgt'}
                            </b>
                            {text(job, 'status') === 'draft' ? 'Entwurf' : 'Aktiv'}
                          </span>
                          <span className="mt-px block text-[13px] font-semibold">
                            {text(job, 'designation')}
                          </span>
                          <span className="block text-[12px] text-ink-muted">
                            {customers.get(text(job, 'customerId')) ?? ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="m-0 text-[12px] leading-[1.45] text-ink-faint">
                  Zieh einen Auftrag auf eine Person und einen Tag. Ohne Ziehen: „Termin anlegen“.
                </p>
              </div>
            </Panel>
          </div>
        )}
      </div>
      {asking !== null ? (
        <AppointmentDialog
          asking={asking}
          people={people}
          staff={staff}
          jobs={openJobs}
          allJobs={jobRecords}
          customers={customers}
          onClose={() => {
            setAsking(null)
          }}
          onSaved={async () => {
            setAsking(null)
            await client.synchronise()
          }}
        />
      ) : null}
    </Screen>
  )
}

function HeadRow({
  start,
  days,
  compact,
  holidays,
}: {
  readonly start: IsoDate
  readonly days: number
  readonly compact: boolean
  readonly holidays: ReadonlyMap<string, string>
}) {
  const now = today()

  return (
    <div
      className="grid border-b border-line bg-surface"
      style={{ gridTemplateColumns: columnsOf(start, days) }}
    >
      <div className="self-end px-2 py-1.5 text-[13px] font-semibold text-ink-muted">Person</div>
      {Array.from({ length: days }, (_, n) => {
        const on = addDays(start, n)
        const weekday = weekdayIndex(on)
        const holiday = holidays.get(on)
        const isToday = on === now

        return (
          <div
            key={on}
            title={holiday}
            className={clsx(
              'min-w-0 border-b-2 py-1.5',
              compact ? 'px-0.5 text-center' : 'px-2',
              isToday ? 'border-copper' : 'border-transparent',
            )}
          >
            {compact ? (
              <>
                <div
                  className={clsx(
                    'text-[11px]',
                    isToday
                      ? 'text-copper-text'
                      : weekday >= 5
                        ? 'text-ink-faint'
                        : 'text-ink-muted',
                  )}
                >
                  {shortDays[weekday]}
                </div>
                <div className="text-[12px] font-semibold tabular-nums">{Number(on.slice(8))}</div>
              </>
            ) : (
              <>
                <div
                  className={clsx(
                    'font-condensed text-[13px] tracking-[0.6px] uppercase',
                    isToday
                      ? 'text-copper-text'
                      : weekday >= 5
                        ? 'text-ink-faint'
                        : 'text-ink-muted',
                  )}
                >
                  {shortDays[weekday]}
                  {isToday ? ' · heute' : ''}
                </div>
                <div className="text-[14px] font-semibold tabular-nums">{dayMonth(on)}</div>
                {holiday ? (
                  <div className="truncate text-[11px] text-ink-muted">{holiday}</div>
                ) : null}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PersonRow({
  name,
  userId,
  start,
  days,
  compact,
  holidays,
  absences,
  row,
  jobs,
  target,
  canChange,
  onOpen,
  onBegin,
  dragProps,
}: {
  readonly name: string
  readonly userId: string
  readonly start: IsoDate
  readonly days: number
  readonly compact: boolean
  readonly holidays: ReadonlyMap<string, string>
  readonly absences: readonly BoardAbsence[]
  readonly row: { readonly placed: readonly Placed[]; readonly lanes: number } | undefined
  readonly jobs: ReadonlyMap<string, JobFacts>
  readonly target: { readonly userId: string; readonly day: IsoDate } | null
  readonly canChange: boolean
  readonly onOpen: (placed: Placed) => void
  readonly onBegin: (
    event: ReactPointerEvent<HTMLElement>,
    drag: Omit<Dragging, 'x' | 'y' | 'moved'>,
  ) => void
  readonly dragProps: Record<string, (event: ReactPointerEvent<HTMLElement>) => void>
}) {
  const lanes = row?.lanes ?? 1
  const last = addDays(start, days - 1)

  return (
    <div
      className="grid border-b border-line last:border-b-0"
      style={{
        gridTemplateColumns: columnsOf(start, days),
        gridTemplateRows: `repeat(${String(lanes)}, minmax(${compact ? '36px' : '50px'}, auto))`,
      }}
    >
      <div
        className={clsx(
          'border-r border-line bg-surface p-2 font-semibold',
          compact ? 'text-[12px]' : 'text-[14px]',
        )}
        style={{ gridColumn: 1, gridRow: `1 / span ${String(lanes)}` }}
      >
        {name}
      </div>
      {Array.from({ length: days }, (_, n) => {
        const on = addDays(start, n)
        const shaded = weekdayIndex(on) >= 5 || holidays.has(on)
        const aimed = target?.userId === userId && target.day === on

        return (
          <div
            key={on}
            data-day={on}
            data-user={userId}
            aria-hidden="true"
            className={clsx(
              'border-l border-row',
              shaded ? 'bg-surface-sunken' : '',
              aimed ? 'outline-2 -outline-offset-2 outline-copper outline-dashed' : '',
            )}
            style={{ gridColumn: n + 2, gridRow: `1 / span ${String(lanes)}` }}
          />
        )
      })}
      {absences.map((absence) => {
        const first = absence.firstDay < start ? start : absence.firstDay
        const until = absence.lastDay > last ? last : absence.lastDay
        const label =
          absence.kind === 'vacation'
            ? 'Urlaub'
            : absence.kind === 'sickness'
              ? 'Krank'
              : 'abwesend'

        return (
          <div
            key={`${absence.firstDay}-${absence.lastDay}`}
            title={label}
            className="pointer-events-none border-t-2 border-waiting-edge px-1.5 py-0.5 text-[11px] font-semibold text-waiting"
            style={{
              gridColumn: `${String(daysBetween(start, first) + 2)} / span ${String(daysBetween(first, until) + 1)}`,
              gridRow: `1 / span ${String(lanes)}`,
              background:
                'repeating-linear-gradient(135deg, var(--color-waiting-fill) 0 7px, transparent 7px 14px)',
            }}
          >
            {compact ? null : `${label} bis ${dayMonth(absence.lastDay)}`}
          </div>
        )
      })}
      {(row?.placed ?? []).map((placed) => (
        <Bar
          key={`${placed.appointment.id}-${placed.occurrence.firstDay}`}
          placed={placed}
          job={jobs.get(placed.appointment.jobId)}
          compact={compact}
          canChange={canChange}
          onOpen={onOpen}
          onBegin={onBegin}
          dragProps={dragProps}
        />
      ))}
    </div>
  )
}

function StateIcon({
  confirmed,
  size = 13,
}: {
  readonly confirmed: boolean
  readonly size?: number
}) {
  return confirmed ? (
    <Check size={size} strokeWidth={2.6} aria-hidden="true" className="shrink-0 text-done" />
  ) : (
    <Clock size={size} strokeWidth={2.4} aria-hidden="true" className="shrink-0 text-waiting" />
  )
}

/** What a bar says of its job. */
interface JobFacts {
  readonly number: string
  readonly title: string
  readonly customer: string
}

function Bar({
  placed,
  job,
  compact,
  canChange,
  onOpen,
  onBegin,
  dragProps,
}: {
  readonly placed: Placed
  readonly job: JobFacts | undefined
  readonly compact: boolean
  readonly canChange: boolean
  readonly onOpen: (placed: Placed) => void
  readonly onBegin: (
    event: ReactPointerEvent<HTMLElement>,
    drag: Omit<Dragging, 'x' | 'y' | 'moved'>,
  ) => void
  readonly dragProps: Record<string, (event: ReactPointerEvent<HTMLElement>) => void>
}) {
  const { appointment, occurrence, confirmed, away } = placed
  const series = appointment.rrule !== null
  const span = placed.last - placed.first + 1
  const firstDay = occurrence.firstDay
  const lastDay = occurrence.lastDay
  const single = firstDay === lastDay
  const title = job?.title ?? 'Auftrag'
  const number = job?.number ?? ''
  const when = single
    ? `${longDays[weekdayIndex(firstDay)]}, ${dayMonth(firstDay)}, ${clockOf(occurrence.startsAt)} bis ${clockOf(occurrence.endsAt)}`
    : `${longDays[weekdayIndex(firstDay)]}, ${dayMonth(firstDay)}, ${clockOf(occurrence.startsAt)} bis ${longDays[weekdayIndex(lastDay)]}, ${dayMonth(lastDay)}, ${clockOf(occurrence.endsAt)}`
  const label = [
    title,
    number,
    when,
    confirmed ? 'bestätigt' : 'noch nicht bestätigt',
    ...(series ? ['Serie'] : []),
    ...(away ? ['in einer Abwesenheit'] : []),
  ].join(', ')
  const draggable = canChange && !series
  const icons = (
    <>
      {series ? (
        <Repeat
          size={12}
          strokeWidth={2.4}
          aria-hidden="true"
          className="shrink-0 text-ink-muted"
        />
      ) : null}
      {away ? (
        <TriangleAlert
          size={13}
          strokeWidth={2.4}
          aria-hidden="true"
          className="shrink-0 text-conflict"
        />
      ) : null}
      <StateIcon confirmed={confirmed} size={compact ? 11 : 13} />
    </>
  )

  return (
    <button
      type="button"
      aria-label={label}
      className={clsx(
        'relative z-[1] min-w-0 rounded-[4px] border border-l-[3px] border-line bg-surface text-left text-ink',
        away ? 'border-l-conflict' : 'border-l-line-strong',
        compact ? 'mx-px my-0.5 p-0.5' : 'm-[3px] py-1 pr-2.5 pl-1.5',
        draggable ? 'cursor-grab touch-none' : 'cursor-pointer',
      )}
      style={{
        gridColumn: `${String(placed.first + 2)} / span ${String(span)}`,
        gridRow: placed.lane + 1,
      }}
      onPointerDown={(event) => {
        if (draggable) {
          onBegin(event, { kind: 'move', placed, jobId: null })
        }
      }}
      {...dragProps}
      onClick={() => {
        onOpen(placed)
      }}
    >
      {compact ? (
        <span
          className={clsx(
            'flex gap-0.5 text-[11px] leading-[1.1] font-semibold tabular-nums',
            span > 1 ? 'flex-row items-center' : 'flex-col items-start',
          )}
        >
          <span className="overflow-hidden whitespace-nowrap">{number.slice(-4)}</span>
          <span className="inline-flex gap-0.5">
            {span > 1 ? icons : <StateIcon confirmed={confirmed} size={11} />}
          </span>
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1 text-[12px] font-semibold tabular-nums">
            <span className="grow truncate">
              {single
                ? clockOf(occurrence.startsAt)
                : `${shortDays[weekdayIndex(firstDay)]} ${clockOf(occurrence.startsAt)} bis ${shortDays[weekdayIndex(lastDay)]} ${clockOf(occurrence.endsAt)}`}
            </span>
            {icons}
          </span>
          <span className="block truncate text-[12px]">
            {single ? title : [title, job?.customer].filter(Boolean).join(' · ')}
          </span>
        </>
      )}
      {draggable && !compact ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-0 bottom-1 w-[7px] cursor-ew-resize"
          style={{ borderLeft: '1px dotted var(--color-control)' }}
          onPointerDown={(event) => {
            event.stopPropagation()
            onBegin(event, { kind: 'extend', placed, jobId: null })
          }}
        />
      ) : null}
    </button>
  )
}

function Legend({ compact }: { readonly compact: boolean }) {
  const item = (icon: ReactNode, words: string) => (
    <span className="inline-flex items-center gap-[5px]">
      {icon}
      {words}
    </span>
  )

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink-muted">
      {item(<StateIcon confirmed />, 'bestätigt')}
      {item(<StateIcon confirmed={false} />, 'wartet auf Bestätigung')}
      {item(
        <Repeat size={13} strokeWidth={2.4} aria-hidden="true" />,
        'Serie, im Formular zu ändern',
      )}
      {item(
        <TriangleAlert size={13} strokeWidth={2.4} aria-hidden="true" className="text-conflict" />,
        'in einer Abwesenheit',
      )}
      {item(
        <span
          aria-hidden="true"
          className="h-2.5 w-3.5 border-t-2 border-waiting-edge"
          style={{
            background:
              'repeating-linear-gradient(135deg, var(--color-waiting-fill) 0 3px, transparent 3px 6px)',
          }}
        />,
        'abwesend',
      )}
      {compact
        ? item(
            <span
              aria-hidden="true"
              className="h-2.5 w-3.5 border border-line bg-surface-sunken"
            />,
            'Wochenende und Feiertag',
          )
        : null}
    </div>
  )
}

// --- The form -------------------------------------------------------------------------------

const frequencies: readonly { readonly value: 'none' | RepeatFrequency; readonly label: string }[] =
  [
    { value: 'none', label: 'Nicht wiederholen' },
    { value: 'daily', label: 'Täglich' },
    { value: 'weekly', label: 'Wöchentlich' },
    { value: 'monthly', label: 'Monatlich' },
    { value: 'yearly', label: 'Jährlich' },
  ]

const units: Readonly<Record<RepeatFrequency, string>> = {
  daily: 'Tage',
  weekly: 'Wochen',
  monthly: 'Monate',
  yearly: 'Jahre',
}

function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number)

  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function clockText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function AppointmentDialog({
  asking,
  people,
  staff,
  jobs,
  allJobs,
  customers,
  onClose,
  onSaved,
}: {
  readonly asking: Asking
  readonly people: readonly PersonRow[]
  readonly staff: readonly {
    readonly userId: string
    readonly name: string
    readonly active: boolean
  }[]
  readonly jobs: readonly RecordState[]
  readonly allJobs: readonly RecordState[]
  readonly customers: ReadonlyMap<string, string>
  readonly onClose: () => void
  readonly onSaved: () => Promise<void>
}) {
  const { appointment, openedOn } = asking
  const on = useMemo(
    () =>
      appointment === null ? [] : people.filter((each) => each.appointmentId === appointment.id),
    [appointment, people],
  )
  const rule = appointment?.rrule ? parseRule(appointment.rrule) : null
  const begins = appointment ? berlinWall(appointment.startsAt) : null
  const ends = appointment ? berlinWall(appointment.endsAt) : null
  const firstDay = asking.day ?? today()
  const [jobId, setJobId] = useState(appointment?.jobId ?? asking.jobId ?? text(jobs[0], 'id'))
  const [userIds, setUserIds] = useState<ReadonlySet<string>>(
    new Set(appointment ? on.map((each) => each.userId) : asking.userId ? [asking.userId] : []),
  )
  const [startDay, setStartDay] = useState<IsoDate>(begins?.day ?? firstDay)
  const [startTime, setStartTime] = useState(begins ? clockText(begins.minute) : '08:00')
  const [endDay, setEndDay] = useState<IsoDate>(ends?.day ?? firstDay)
  const [endTime, setEndTime] = useState(ends ? clockText(ends.minute) : '16:00')
  const [frequency, setFrequency] = useState<'none' | RepeatFrequency>(rule?.frequency ?? 'none')
  const [interval, setInterval] = useState(String(rule?.interval ?? 1))
  const [weekdays, setWeekdays] = useState<ReadonlySet<number>>(
    new Set(rule?.weekdays.length ? rule.weekdays : [weekdayOf(begins?.day ?? firstDay)]),
  )
  const [ending, setEnding] = useState<'never' | 'on' | 'after'>(
    rule?.until ? 'on' : rule?.count ? 'after' : 'never',
  )
  const [until, setUntil] = useState<IsoDate>(rule?.until ?? addDays(firstDay, 56))
  const [times, setTimes] = useState(String(rule?.count ?? 10))
  const [note, setNote] = useState(appointment?.note ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const away = useQuery({
    queryKey: [...boardKey, 'form', startDay, endDay],
    queryFn: () => boardFacts(startDay, endDay),
    enabled: startDay !== '' && endDay >= startDay && daysBetween(startDay, endDay) < 62,
    retry: false,
  })
  const nameOf = (userId: string) =>
    staff.find((person) => person.userId === userId)?.name ?? 'jemand, dessen Name fehlt'
  const choices = staff.filter((person) => person.active || userIds.has(person.userId))
  const jobChoices = appointment
    ? allJobs.filter((job) => text(job, 'id') === appointment.jobId)
    : jobs
  const warnings = [...userIds]
    .map((userId) => {
      const hit = (away.data?.absences ?? []).find(
        (absence) =>
          absence.userId === userId && absence.firstDay <= endDay && absence.lastDay >= startDay,
      )

      return hit === undefined
        ? null
        : `${nameOf(userId)} ist am ${date(hit.firstDay > startDay ? hit.firstDay : startDay)} abwesend.`
    })
    .filter((warning): warning is string => warning !== null)

  function body(): AppointmentBody {
    const rrule =
      frequency === 'none'
        ? null
        : ruleOf({
            frequency,
            interval: Number(interval) || 1,
            weekdays: frequency === 'weekly' ? [...weekdays].sort((a, b) => a - b) : [],
            until: ending === 'on' ? until : null,
            count: ending === 'after' ? Number(times) || 1 : null,
          })

    return {
      jobId,
      startsAt: berlinInstant(startDay, minutesOf(startTime)).toISOString(),
      endsAt: berlinInstant(endDay, minutesOf(endTime)).toISOString(),
      note: note.trim() === '' ? null : note.trim(),
      rrule,
      exdates: rrule === null ? [] : (appointment?.exdates ?? []),
      userIds: [...userIds].sort(),
    }
  }

  async function run(work: () => Promise<unknown>) {
    setProblem(null)

    try {
      await work()
      await onSaved()
    } catch (error) {
      setProblem(error instanceof RequestRefused && error.status === 409 ? moved : problemOf(error))
    }
  }

  function save(event: FormEvent) {
    event.preventDefault()

    const sent = body()
    const local = appointmentProblem({
      ...sent,
      startsAt: new Date(sent.startsAt),
      endsAt: new Date(sent.endsAt),
    })

    if (local !== null) {
      setProblem(local)

      return
    }

    void run(() =>
      appointment === null
        ? createAppointment(sent)
        : changeAppointment(appointment.id, sent, appointment.version),
    )
  }

  const confirmed = on.filter((each) => each.confirmedRevision === appointment?.revision)
  const unconfirmed = on.filter((each) => each.confirmedRevision !== appointment?.revision)
  const series = appointment?.rrule != null

  return (
    <Dialog
      title={
        appointment === null
          ? 'Termin anlegen'
          : series
            ? 'Serientermin bearbeiten'
            : 'Termin bearbeiten'
      }
      onClose={onClose}
      width={600}
    >
      <form className="flex flex-col gap-3" onSubmit={save}>
        <SelectField
          label="Auftrag"
          starred
          required
          disabled={appointment !== null}
          value={jobId}
          options={jobChoices.map((job) => ({
            value: text(job, 'id'),
            label: jobLabel(job, customers),
          }))}
          onChange={setJobId}
        />
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[13px] font-medium">Personen</legend>
          <div className="grid grid-cols-1 gap-x-3 gap-y-1 min-[480px]:grid-cols-3">
            {choices.map((person) => (
              <label
                key={person.userId}
                className="flex min-h-[28px] items-center gap-2 text-[14px]"
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={userIds.has(person.userId)}
                  onChange={(event) => {
                    const next = new Set(userIds)

                    if (event.target.checked) {
                      next.add(person.userId)
                    } else {
                      next.delete(person.userId)
                    }

                    setUserIds(next)
                  }}
                />
                {person.name}
              </label>
            ))}
          </div>
        </fieldset>
        {warnings.map((warning) => (
          <p
            key={warning}
            className="m-0 flex items-center gap-2 rounded-[4px] border border-waiting-edge bg-waiting-fill px-3 py-[9px] text-[14px] text-waiting"
          >
            <TriangleAlert size={16} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
            {warning}
          </p>
        ))}
        <div className="flex flex-wrap gap-2.5">
          <div className="w-[150px]">
            <Field
              label="Beginn am"
              type="date"
              required
              value={startDay}
              onChange={(event) => {
                setStartDay(event.target.value)

                if (endDay < event.target.value) {
                  setEndDay(event.target.value)
                }
              }}
            />
          </div>
          <div className="w-[96px]">
            <Field
              label="um"
              type="time"
              required
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value)
              }}
            />
          </div>
          <div className="w-[150px]">
            <Field
              label="Ende am"
              type="date"
              required
              value={endDay}
              onChange={(event) => {
                setEndDay(event.target.value)
              }}
            />
          </div>
          <div className="w-[96px]">
            <Field
              label="um"
              type="time"
              required
              value={endTime}
              onChange={(event) => {
                setEndTime(event.target.value)
              }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="w-[200px]">
            <SelectField
              label="Wiederholen"
              value={frequency}
              options={frequencies}
              onChange={(value) => {
                setFrequency(value as 'none' | RepeatFrequency)
              }}
            />
          </div>
          {frequency !== 'none' ? (
            <div className="w-[150px]">
              <Field
                label="Alle"
                inputMode="numeric"
                numeric
                unit={units[frequency]}
                value={interval}
                onChange={(event) => {
                  setInterval(event.target.value)
                }}
              />
            </div>
          ) : null}
        </div>
        {frequency === 'weekly' ? (
          <div>
            <div className="mb-1 text-[13px] font-medium" id="weekdays">
              An
            </div>
            <div className="flex gap-1" role="group" aria-labelledby="weekdays">
              {shortDays.map((day, index) => (
                <Button
                  key={day}
                  size="small"
                  tone={weekdays.has(index) ? 'dark' : 'secondary'}
                  aria-pressed={weekdays.has(index)}
                  aria-label={longDays[index]}
                  onClick={() => {
                    const next = new Set(weekdays)

                    if (next.has(index)) {
                      next.delete(index)
                    } else {
                      next.add(index)
                    }

                    setWeekdays(next)
                  }}
                >
                  {day}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {frequency !== 'none' ? (
          <div className="flex flex-wrap items-start gap-2.5">
            <div className="w-[120px]">
              <SelectField
                label="Endet"
                value={ending}
                options={[
                  { value: 'never', label: 'Nie' },
                  { value: 'on', label: 'Am' },
                  { value: 'after', label: 'Nach' },
                ]}
                onChange={(value) => {
                  setEnding(value as 'never' | 'on' | 'after')
                }}
              />
            </div>
            {ending === 'on' ? (
              <div className="w-[150px]">
                <Field
                  label="Tag"
                  type="date"
                  value={until}
                  onChange={(event) => {
                    setUntil(event.target.value)
                  }}
                />
              </div>
            ) : null}
            {ending === 'after' ? (
              <div className="w-[150px]">
                <Field
                  label="Anzahl"
                  inputMode="numeric"
                  numeric
                  unit="Terminen"
                  value={times}
                  onChange={(event) => {
                    setTimes(event.target.value)
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <TextArea
          label="Notiz"
          rows={2}
          placeholder="Was vor Ort wichtig ist, kurz"
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
        {appointment === null ? (
          <p className="m-0 text-[13px] leading-[1.45] text-ink-faint">
            Wer einen Termin bekommt, wird dem Auftrag zugeordnet und bekommt eine Nachricht aufs
            Telefon.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-10 gap-y-2 text-[13px]">
            <div>
              <div className="mb-1 font-medium">Bestätigt</div>
              {confirmed.length === 0 ? (
                <div className="text-ink-muted">noch von niemandem</div>
              ) : (
                confirmed.map((each) => (
                  <div key={each.id} className="flex items-center gap-1.5">
                    <StateIcon confirmed />
                    {each.confirmedAt
                      ? `${nameOf(each.userId)}, am ${date(berlinWall(each.confirmedAt).day)}`
                      : nameOf(each.userId)}
                  </div>
                ))
              )}
            </div>
            {unconfirmed.length > 0 ? (
              <div>
                <div className="mb-1 font-medium">Wartet auf Bestätigung</div>
                {unconfirmed.map((each) => (
                  <div key={each.id} className="flex items-center gap-1.5">
                    <StateIcon confirmed={false} />
                    {nameOf(each.userId)}
                  </div>
                ))}
              </div>
            ) : null}
            {series && appointment.exdates.length > 0 ? (
              <div>
                <div className="mb-1 font-medium">Ausgenommen</div>
                <div className="text-ink-muted">
                  {appointment.exdates.map((day) => date(day)).join(', ')}
                </div>
              </div>
            ) : null}
          </div>
        )}
        {appointment !== null ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-row pt-2.5">
            <span className="grow text-[13px]">
              {openedOn !== null ? (
                <>
                  Geöffnet am <b>{`${longDays[weekdayIndex(openedOn)]}, ${date(openedOn)}`}</b>
                </>
              ) : null}
            </span>
            {series && openedOn !== null ? (
              <Button
                size="small"
                onClick={() => {
                  void run(() =>
                    changeAppointment(
                      appointment.id,
                      {
                        ...bodyOf(
                          appointment,
                          on.map((each) => each.userId),
                        ),
                        exdates: [...appointment.exdates, openedOn].sort(),
                      },
                      appointment.version,
                    ),
                  )
                }}
              >
                Diesen Tag ausnehmen
              </Button>
            ) : null}
            <Button
              size="small"
              tone="danger"
              icon={Trash2}
              onClick={() => {
                setRemoving(true)
              }}
            >
              {series ? 'Serie löschen' : 'Termin löschen'}
            </Button>
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className="m-0 text-body font-semibold text-conflict">
            {problem}
          </p>
        ) : null}
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={Check} disabled={jobId === ''}>
            {appointment === null ? 'Anlegen' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
      {appointment !== null ? (
        <Confirm
          open={removing}
          tone="danger"
          title={series ? 'Serie löschen?' : 'Termin löschen?'}
          confirm={series ? 'Serie löschen' : 'Termin löschen'}
          onCancel={() => {
            setRemoving(false)
          }}
          onConfirm={() => {
            setRemoving(false)
            void run(() => removeAppointment(appointment.id, appointment.version))
          }}
        >
          {`Wer hingehen sollte, bekommt eine Nachricht, dass der Termin entfällt: ${on.map((each) => nameOf(each.userId)).join(', ')}.`}
        </Confirm>
      ) : null}
    </Dialog>
  )
}
