import {
  berlinDay,
  correctionProblem,
  effectiveEntries,
  type IsoDate,
  minutesBetween,
  type RecordState,
  timeEntryKinds,
  type TimeEntryKind,
  timeEntryProblem,
} from '@opengewerk/domain'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo, useSyncExternalStore } from 'react'

import { locationConsent } from '../session/time.js'
import { type EditResult, refusalFor, type SyncClient } from '../sync/client.js'
import { maybeText, text } from '../sync/fields.js'
import { useRecords, useSync } from '../sync/provider.js'
import { accountQuery } from './queries.js'

/** A place in millionths of a degree, as an entry keeps it. */
export interface Place {
  readonly latitudeMicro: number
  readonly longitudeMicro: number
}

/** What a stretch is and where: work at a job, travel to one, a break. */
export interface Activity {
  readonly kind: TimeEntryKind
  readonly jobId: string | null
}

/**
 * The running stopwatch of #76: whose it is, what is being timed, at which
 * job, since when, and where it started if the person consented. Kept on the
 * device and written as an entry only when it stops, so that nothing half
 * finished ever becomes a record that cannot be changed.
 *
 * It names its person because a device can be shared. A tablet in the van
 * that two people sign in to in turn would otherwise hand the second one the
 * first one's running time, and stopping it would record it as theirs.
 */
export interface Stopwatch extends Activity {
  readonly userId: string
  readonly startedAt: string
  readonly place: Place | null
  /**
   * What a break interrupted, so that "weiter" picks up the same work at the
   * same job. Kept on the device only: the break itself belongs to no job.
   */
  readonly resume: Activity | null
}

function isPlace(value: unknown): value is Place {
  const place = value as Place | null

  return (
    typeof place === 'object' &&
    place !== null &&
    Number.isInteger(place.latitudeMicro) &&
    Number.isInteger(place.longitudeMicro)
  )
}

function kindOf(value: unknown): TimeEntryKind | null {
  return typeof value === 'string' && (timeEntryKinds as readonly string[]).includes(value)
    ? (value as TimeEntryKind)
    : null
}

function activityOf(value: unknown): Activity | null {
  const activity = value as { kind?: unknown; jobId?: unknown } | null
  const kind = typeof activity === 'object' && activity !== null ? kindOf(activity.kind) : null

  return kind && activity
    ? { kind, jobId: typeof activity.jobId === 'string' ? activity.jobId : null }
    : null
}

/**
 * The stored stopwatch of this person, read carefully: a value from an older
 * build is no stopwatch, and neither is somebody else's.
 */
export function parseStopwatch(stored: string | null, userId: string | null): Stopwatch | null {
  if (!stored || !userId) {
    return null
  }

  try {
    const value = JSON.parse(stored) as Record<string, unknown>
    const activity = activityOf(value)
    const startedAt = value['startedAt']

    if (
      activity &&
      value['userId'] === userId &&
      typeof startedAt === 'string' &&
      !Number.isNaN(Date.parse(startedAt))
    ) {
      return {
        ...activity,
        userId,
        startedAt,
        place: isPlace(value['place']) ? value['place'] : null,
        resume: activityOf(value['resume']),
      }
    }
  } catch {
    // Not JSON: nothing this build wrote.
  }

  return null
}

/** The signed in person, for "mine". Null while nobody is known. */
export function useMe(): string | null {
  return useQuery(accountQuery).data?.userId ?? null
}

/** The running stopwatch of whoever is signed in, the same on every screen that shows it. */
export function useStopwatch(): Stopwatch | null {
  const client = useSync()
  const me = useMe()
  const stored = useSyncExternalStore(client.subscribe, client.stopwatch, client.stopwatch)

  return useMemo(() => parseStopwatch(stored, me), [stored, me])
}

function everyHalfMinute(changed: () => void): () => void {
  const timer = setInterval(changed, 30_000)

  return () => {
    clearInterval(timer)
  }
}

function thisMinute(): number {
  return Math.floor(Date.now() / 60_000)
}

/**
 * The current minute, for a screen that shows how long something has been
 * running. Read from the clock rather than kept in state, so a screen that
 * comes back from the background shows the right figure at once.
 */
export function useMinute(): number {
  return useSyncExternalStore(everyHalfMinute, thisMinute, thisMinute)
}

/**
 * Where the device is, or null. Asked at start and stop only, never in
 * between (4.4), only when the person has consented, which the callers check,
 * and given up after a few seconds: a cellar without a signal still gets its
 * time recorded, just without a place.
 */
export function placeNow(timeout = 8_000): Promise<Place | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitudeMicro: Math.round(position.coords.latitude * 1_000_000),
          longitudeMicro: Math.round(position.coords.longitude * 1_000_000),
        })
      },
      () => {
        resolve(null)
      },
      { enableHighAccuracy: false, timeout, maximumAge: 60_000 },
    )
  })
}

/** Consent to recording one's place, from the server. Unknown is no. */
export const consentQuery = queryOptions({
  queryKey: ['time-consent'],
  queryFn: locationConsent,
  staleTime: 60_000,
  retry: false,
})

export function useConsent(): boolean {
  return useQuery(consentQuery).data?.given === true
}

/** Everything starting and stopping needs to know about the moment. */
export interface Timing {
  readonly client: SyncClient
  readonly me: string
  readonly consent: boolean
  readonly now?: Date
}

/** Somebody whose stopwatch ran for less than this recorded nothing worth keeping. */
const shortest = 60_000

/**
 * An instant on its whole minute. A record of working time is read to the
 * minute, and one that kept the seconds would show "16:39 bis 16:40" beside a
 * duration of two minutes. Both ends fall to their minute, so what is shown is
 * what is stored; after at least a minute the end still lies after the start.
 */
function onTheMinute(at: Date): string {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString()
}

/**
 * Stops the stopwatch and writes what it timed as an entry, through the
 * outbox. The sentence to show, or null when it is done.
 *
 * A stopwatch that ran for more than a day was forgotten, and an entry of that
 * length would be refused; it is left running, and the screen offers to throw
 * it away and enter the real end as a late entry instead.
 */
export async function stopStopwatch({
  client,
  me,
  consent,
  now = new Date(),
}: Timing): Promise<string | null> {
  const running = parseStopwatch(client.stopwatch(), me)

  if (!running) {
    return null
  }

  if (now.getTime() - Date.parse(running.startedAt) < shortest) {
    await client.setStopwatch(null)

    return null
  }

  const values = {
    kind: running.kind,
    jobId: running.jobId,
    startedAt: onTheMinute(new Date(running.startedAt)),
    endedAt: onTheMinute(now),
  }
  const problem = timeEntryProblem(values)

  if (problem) {
    return problem
  }

  const end = consent ? await placeNow() : null
  const made = await client.create('time_entries', {
    ...values,
    ...(running.place
      ? {
          startLatitudeMicro: running.place.latitudeMicro,
          startLongitudeMicro: running.place.longitudeMicro,
        }
      : {}),
    ...(end ? { endLatitudeMicro: end.latitudeMicro, endLongitudeMicro: end.longitudeMicro } : {}),
  })

  if (made.outcome === 'refused') {
    return refusalFor(made)
  }

  await client.setStopwatch(null)

  return null
}

/**
 * Starts timing: work at a job, travel, a break. A stopwatch that was running
 * stops first and becomes its entry, so switching from travel to work is one
 * press and leaves no gap.
 */
export async function startStopwatch(
  timing: Timing,
  activity: Activity,
  resume: Activity | null = null,
): Promise<string | null> {
  const now = timing.now ?? new Date()
  const stopped = await stopStopwatch({ ...timing, now })

  if (stopped) {
    return stopped
  }

  const place = timing.consent ? await placeNow() : null

  await timing.client.setStopwatch(
    JSON.stringify({
      ...activity,
      userId: timing.me,
      startedAt: now.toISOString(),
      place,
      resume,
    } satisfies Stopwatch),
  )

  return null
}

/**
 * Throws a running stopwatch away without writing anything: the one that was
 * forgotten over night, whose real end goes in as a late entry instead.
 */
export function discardStopwatch(client: SyncClient): Promise<void> {
  return client.setStopwatch(null)
}

/** What an entry typed in by hand says, before it is checked. */
export interface TypedEntry extends Activity {
  readonly startedAt: string
  readonly endedAt: string
  readonly note: string | null
}

/**
 * Records a stretch somebody forgot to time, or the correction of one: the
 * same checks the server makes, asked first, so that nothing goes into the
 * outbox that would hold it up. A correction names the entry it replaces and
 * needs a reason; the old entry stays as it was.
 */
export async function recordEntry(
  client: SyncClient,
  entry: TypedEntry,
  corrects: string | null = null,
): Promise<EditResult | string> {
  const values = { ...entry, correctsEntryId: corrects }
  const problem = timeEntryProblem(values) ?? correctionProblem(values)

  return problem ?? client.create('time_entries', values)
}

/**
 * Takes an entry back that should not have been written: a new entry with the
 * same times that names it and carries `withdrawn`, with the reason.
 */
export async function withdrawEntry(
  client: SyncClient,
  entry: RecordState,
  reason: string,
): Promise<EditResult | string> {
  const values = {
    kind: text(entry, 'kind'),
    jobId: maybeText(entry, 'jobId'),
    startedAt: text(entry, 'startedAt'),
    endedAt: text(entry, 'endedAt'),
    note: reason.trim() === '' ? null : reason.trim(),
    correctsEntryId: String(entry['id']),
    withdrawn: true,
  }

  return correctionProblem(values) ?? client.create('time_entries', values)
}

/** The entries of one person: their own, and the ones this device made and has not sent yet. */
export function entriesOf(entries: readonly RecordState[], userId: string | null): RecordState[] {
  if (userId === null) {
    return []
  }

  return entries.filter((entry) => {
    const owner = maybeText(entry, 'userId')

    return owner === null || owner === userId
  })
}

/** All time entries this device knows, earliest start first. */
export function useTimeEntries(): readonly RecordState[] {
  const entries = useRecords('time_entries')

  return useMemo(
    () =>
      [...entries].sort(
        (left, right) =>
          text(left, 'startedAt').localeCompare(text(right, 'startedAt')) ||
          String(left['id']).localeCompare(String(right['id'])),
      ),
    [entries],
  )
}

/** The entries that start on a day in Germany, of a list. */
export function startingOn(entries: readonly RecordState[], on: IsoDate): RecordState[] {
  return entries.filter((entry) => berlinDay(text(entry, 'startedAt')) === on)
}

/** The entries of a day that count. */
export function countingOn(entries: readonly RecordState[], on: IsoDate): RecordState[] {
  return startingOn(effectiveEntries(entries), on)
}

/** Minutes of one kind, or of working time (work and travel) when none is named. */
export function minutesOf(entries: readonly RecordState[], kind?: TimeEntryKind): number {
  return entries
    .filter((entry) =>
      kind ? entry['kind'] === kind : entry['kind'] === 'work' || entry['kind'] === 'travel',
    )
    .reduce(
      (sum, entry) => sum + minutesBetween(text(entry, 'startedAt'), text(entry, 'endedAt')),
      0,
    )
}

/** An entry as the working time rules read it. */
export function timed(entry: RecordState): {
  readonly kind: string
  readonly startedAt: string
  readonly endedAt: string
} {
  return {
    kind: text(entry, 'kind'),
    startedAt: text(entry, 'startedAt'),
    endedAt: text(entry, 'endedAt'),
  }
}

/**
 * An instant from a day and a clock time as read off a clock in Germany. A
 * phone set to another zone still records the time on the wall of the
 * cellar, which is the time the law asks for.
 */
export function instantOf(day: string, clock: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(clock)) {
    return null
  }

  // Read the wall time as UTC, ask what Berlin shows at that instant, and move
  // by the difference. Twice, because the offset of the answer can differ from
  // the offset of the guess on the two nights the clocks change.
  const wall = Date.parse(`${day}T${clock}:00Z`)

  if (Number.isNaN(wall)) {
    return null
  }

  let at = wall

  for (let round = 0; round < 2; round += 1) {
    at = wall - (berlinWall(at) - at)
  }

  return new Date(at).toISOString()
}

/** The wall time Berlin shows at an instant, as milliseconds read as UTC. */
function berlinWall(at: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '00'

  return Date.parse(
    `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`,
  )
}

/** The clock time of an instant in Germany, "07:30", for a list and a form to start from. */
export function clockOf(instant: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant))
}

/** The day before or after, as ISO. */
export function shiftDay(on: string, days: number): IsoDate {
  const at = new Date(`${on}T12:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)

  return at.toISOString().slice(0, 10) as IsoDate
}

export const timeEntryKindLabel: Readonly<Record<TimeEntryKind, string>> = {
  work: 'Arbeit',
  travel: 'Fahrt',
  break: 'Pause',
}

export function timeEntryKindOf(entry: RecordState): TimeEntryKind {
  return kindOf(entry['kind']) ?? 'work'
}
