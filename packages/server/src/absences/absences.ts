import {
  type AbsenceId,
  type AbsenceKind,
  absenceKinds,
  absenceProblems,
  type AbsenceState,
  countAbsence,
  entitlementProblems,
  type Holiday,
  holidayCalendar,
  type HolidaySetting,
  holidaysIn,
  isFederalState,
  type IsoDate,
  leaveYear,
  type LeaveYear,
  type LocalHoliday,
  localHolidaysOf,
  overlaps,
  type PersonId,
  shippedRules,
  type TenantId,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm'

import {
  absences,
  holidaySettings,
  leaveEntitlements,
  people,
  workingTimes,
} from '../database/schema/index.js'

/**
 * Leave and sickness (#288, Feature-Gliederung 4.9) and the public holidays
 * they count with (4.4).
 *
 * The office enters leave and sickness, approves or turns down what somebody
 * asked for and keeps the days of a year; a person asks for their own leave
 * and sees their own absences; whoever plans sees who is away and, without
 * the right to keep absences, not why. Every count comes from `domain`, with
 * the working time of the person and the holidays of the business, so that a
 * screen and the server cannot come to two answers.
 */

/** A request the rules turn down, said so that whoever reads it knows what to change. */
export class AbsenceRefused extends Error {}

/** An absence, a person or a file that is not there, or not of this business. */
export class AbsenceNotFound extends Error {}

/** An absence that shares a half day with another of the same kind. */
export class AbsenceOverlaps extends Error {}

type Row = typeof absences.$inferSelect

/** The days of an absence as they are counted. */
interface Span {
  readonly kind: AbsenceKind
  readonly state: AbsenceState
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
}

const spanOf = (row: Row): Span => ({
  kind: row.kind,
  state: row.state,
  firstDay: row.firstDay,
  lastDay: row.lastDay,
  startsAtNoon: row.startsAtNoon,
  endsAtNoon: row.endsAtNoon,
})

function yearOf(year: number) {
  return { from: `${String(year)}-01-01`, to: `${String(year)}-12-31` }
}

/** Where the business is for its holidays, or nothing before somebody set it. */
export async function holidaySettingOf(tx: TenantTransaction): Promise<HolidaySetting | null> {
  const [row] = await tx.select().from(holidaySettings).where(isNull(holidaySettings.deletedAt))

  if (!row || !isFederalState(row.state)) {
    return null
  }

  return { state: row.state, local: row.localHolidays }
}

/** Without a state no day is a holiday, and the screens say so. */
function holidaysOf(setting: HolidaySetting | null): (on: IsoDate) => boolean {
  return setting === null ? () => false : holidayCalendar(shippedRules, setting)
}

async function timesOf(tx: TenantTransaction, personIds: readonly string[]) {
  const rows =
    personIds.length === 0
      ? []
      : await tx
          .select()
          .from(workingTimes)
          .where(
            and(
              inArray(workingTimes.personId, personIds as PersonId[]),
              isNull(workingTimes.deletedAt),
            ),
          )
  const byPerson = new Map<string, (typeof rows)[number][]>()

  for (const row of rows) {
    byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), row])
  }

  return byPerson
}

/** The absences of some people that touch a stretch of days, without those taken out. */
async function absencesBetween(
  tx: TenantTransaction,
  personIds: readonly string[],
  from: IsoDate,
  to: IsoDate,
): Promise<Row[]> {
  if (personIds.length === 0) {
    return []
  }

  return tx
    .select()
    .from(absences)
    .where(
      and(
        inArray(absences.personId, personIds as PersonId[]),
        isNull(absences.deletedAt),
        lte(absences.firstDay, to),
        gte(absences.lastDay, from),
      ),
    )
    .orderBy(asc(absences.firstDay), asc(absences.createdAt))
}

async function entitlementOf(tx: TenantTransaction, personId: string, year: number) {
  const [row] = await tx
    .select()
    .from(leaveEntitlements)
    .where(
      and(
        eq(leaveEntitlements.personId, personId as PersonId),
        eq(leaveEntitlements.year, year),
        isNull(leaveEntitlements.deletedAt),
      ),
    )

  return row ?? null
}

async function personOf(tx: TenantTransaction, id: string) {
  const [person] = await tx
    .select()
    .from(people)
    .where(and(eq(people.id, id as PersonId), isNull(people.deletedAt)))

  if (!person) {
    throw new AbsenceNotFound()
  }

  return person
}

async function ownPersonOf(tx: TenantTransaction, userId: string) {
  const [person] = await tx
    .select()
    .from(people)
    .where(and(eq(people.userId, userId), isNull(people.deletedAt)))

  return person ?? null
}

/** One absence as a screen shows it, with how it counts. */
export interface AbsenceView {
  readonly id: string
  readonly personId: string
  readonly kind: AbsenceKind
  readonly state: AbsenceState
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
  readonly note: string | null
  readonly answer: string | null
  readonly decidedAt: Date | null
  readonly workingHalfDays: number
  readonly leaveHalfDays: number | null
  readonly sickHalfDays: number
  readonly holidays: number
}

function viewOf(
  row: Row,
  context: {
    others: readonly Span[]
    times: Parameters<typeof countAbsence>[1]['times']
    isHoliday: (on: IsoDate) => boolean
  },
  holidays: readonly IsoDate[],
): AbsenceView {
  const count = countAbsence(spanOf(row), context)

  return {
    id: row.id,
    personId: row.personId,
    kind: row.kind,
    state: row.state,
    firstDay: row.firstDay,
    lastDay: row.lastDay,
    startsAtNoon: row.startsAtNoon,
    endsAtNoon: row.endsAtNoon,
    note: row.note,
    answer: row.answer,
    decidedAt: row.decidedAt,
    ...count,
    holidays: holidays.filter((on) => on >= row.firstDay && on <= row.lastDay).length,
  }
}

function holidayDaysAround(setting: HolidaySetting | null, years: readonly number[]): IsoDate[] {
  if (setting === null) {
    return []
  }

  return years.flatMap((year) =>
    holidaysIn(shippedRules, setting, year).map((holiday) => holiday.on),
  )
}

/** The year of one person, and their absences in it with what each counts. */
export interface PersonYear {
  readonly person: {
    readonly id: string
    readonly name: string
    readonly joinedOn: IsoDate | null
    readonly leftOn: IsoDate | null
  }
  readonly year: number
  readonly state: HolidaySetting['state'] | null
  readonly leave: LeaveYear
  /** What was left of the year before, as the suggestion for what to carry over. */
  readonly restBefore: number
  readonly absences: readonly AbsenceView[]
}

async function yearOfPerson(
  tx: TenantTransaction,
  person: { id: string; name: string; joinedOn: IsoDate | null; leftOn: IsoDate | null },
  year: number,
): Promise<PersonYear> {
  const setting = await holidaySettingOf(tx)
  const isHoliday = holidaysOf(setting)
  const times = (await timesOf(tx, [person.id])).get(person.id) ?? []
  const before = yearOf(year - 1)
  const { to } = yearOf(year)
  const rows = await absencesBetween(tx, [person.id], before.from, to)
  const spans = rows.map(spanOf)
  const leave = leaveYear({
    year,
    entitlement: await entitlementOf(tx, person.id, year),
    absences: spans,
    times,
    isHoliday,
  })
  const previous = leaveYear({
    year: year - 1,
    entitlement: await entitlementOf(tx, person.id, year - 1),
    absences: spans,
    times,
    isHoliday,
  })
  const inYear = rows.filter((row) => row.lastDay >= yearOf(year).from)
  const holidays = holidayDaysAround(setting, [year - 1, year, year + 1])

  return {
    person: { id: person.id, name: person.name, joinedOn: person.joinedOn, leftOn: person.leftOn },
    year,
    state: setting?.state ?? null,
    leave,
    restBefore: Math.max(previous.restHalfDays, 0),
    absences: inYear.map((row) => viewOf(row, { others: spans, times, isHoliday }, holidays)),
  }
}

/** The year of a person for the office. */
export async function personYear(
  tx: TenantTransaction,
  personId: string,
  year: number,
): Promise<PersonYear> {
  return yearOfPerson(tx, await personOf(tx, personId), year)
}

/** The year of whoever asks, or nothing where they have no file in this business. */
export async function ownYear(
  tx: TenantTransaction,
  userId: string,
  year: number,
): Promise<PersonYear | null> {
  const person = await ownPersonOf(tx, userId)

  return person === null ? null : yearOfPerson(tx, person, year)
}

/** A request on the list of the office, with what is left after it and who is away at the same time. */
export interface RequestView extends AbsenceView {
  readonly name: string
  readonly restAfterHalfDays: number
  readonly alsoAway: readonly {
    readonly name: string
    readonly firstDay: IsoDate
    readonly lastDay: IsoDate
  }[]
}

/** The business for a year: everybody's leave and sickness, and the requests still open. */
export interface Overview {
  readonly year: number
  readonly state: HolidaySetting['state'] | null
  readonly people: readonly {
    readonly id: string
    readonly name: string
    readonly leave: LeaveYear
    /** Away today, with the kind, until when. */
    readonly awayToday: { readonly kind: AbsenceKind; readonly lastDay: IsoDate } | null
  }[]
  readonly requests: readonly RequestView[]
}

export async function overview(
  tx: TenantTransaction,
  year: number,
  today: IsoDate,
): Promise<Overview> {
  const { from, to } = yearOf(year)
  const setting = await holidaySettingOf(tx)
  const isHoliday = holidaysOf(setting)
  const staff = (await tx.select().from(people).where(isNull(people.deletedAt))).filter(
    (person) =>
      (person.joinedOn === null || person.joinedOn <= to) &&
      (person.leftOn === null || person.leftOn >= from),
  )
  const ids = staff.map((person) => person.id)
  const times = await timesOf(tx, ids)
  const rows = await absencesBetween(tx, ids, from, to)
  // Open requests are listed whatever year they fall in.
  const open =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(absences)
          .where(
            and(
              inArray(absences.personId, ids),
              isNull(absences.deletedAt),
              eq(absences.state, 'requested'),
            ),
          )
          .orderBy(asc(absences.firstDay))
  const entitlements =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(leaveEntitlements)
          .where(
            and(
              inArray(leaveEntitlements.personId, ids),
              eq(leaveEntitlements.year, year),
              isNull(leaveEntitlements.deletedAt),
            ),
          )
  const names = new Map(staff.map((person) => [person.id, person.name]))
  const spansOf = (personId: string) => rows.filter((row) => row.personId === personId).map(spanOf)
  const holidays = holidayDaysAround(setting, [year, year + 1])

  const peopleOfYear = staff
    .map((person) => {
      const own = rows.filter((row) => row.personId === person.id)
      const away = own.find(
        (row) => row.state === 'approved' && row.firstDay <= today && row.lastDay >= today,
      )

      return {
        id: person.id,
        name: person.name,
        leave: leaveYear({
          year,
          entitlement: entitlements.find((row) => row.personId === person.id) ?? null,
          absences: own.map(spanOf),
          times: times.get(person.id) ?? [],
          isHoliday,
        }),
        awayToday: away ? { kind: away.kind, lastDay: away.lastDay } : null,
      }
    })
    .sort((one, other) => one.name.localeCompare(other.name, 'de'))

  const requests: RequestView[] = []

  for (const row of open) {
    const personTimes = times.get(row.personId) ?? []
    const own = (await absencesBetween(tx, [row.personId], row.firstDay, row.lastDay)).map(spanOf)
    const view = viewOf(row, { others: own, times: personTimes, isHoliday }, holidays)
    const requestYear = Number(row.firstDay.slice(0, 4))
    const yearRows =
      requestYear === year
        ? spansOf(row.personId)
        : (
            await absencesBetween(
              tx,
              [row.personId],
              yearOf(requestYear).from,
              yearOf(requestYear).to,
            )
          ).map(spanOf)
    const leave = leaveYear({
      year: requestYear,
      entitlement: await entitlementOf(tx, row.personId, requestYear),
      absences: yearRows,
      times: personTimes,
      isHoliday,
    })
    const alsoAway = (await absencesBetween(tx, ids, row.firstDay, row.lastDay))
      .filter(
        (other) =>
          other.personId !== row.personId &&
          other.state === 'approved' &&
          overlaps(spanOf(other), spanOf(row)),
      )
      .map((other) => ({
        name: names.get(other.personId) ?? '',
        firstDay: other.firstDay,
        lastDay: other.lastDay,
      }))

    requests.push({
      ...view,
      name: names.get(row.personId) ?? '',
      restAfterHalfDays: leave.restHalfDays - (view.leaveHalfDays ?? 0),
      alsoAway,
    })
  }

  return { year, state: setting?.state ?? null, people: peopleOfYear, requests }
}

/** The days of an absence as a form hands them over. */
export interface AbsenceInput {
  readonly kind?: unknown
  readonly firstDay?: unknown
  readonly lastDay?: unknown
  readonly startsAtNoon?: unknown
  readonly endsAtNoon?: unknown
  readonly note?: unknown
}

function checked(input: AbsenceInput, kind: AbsenceKind) {
  const values = {
    kind,
    firstDay: input.firstDay,
    lastDay: input.lastDay,
    startsAtNoon: input.startsAtNoon === true,
    endsAtNoon: input.endsAtNoon === true,
    note: typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim() : null,
  }
  const problem = Object.values(absenceProblems(values))[0]

  if (problem !== undefined) {
    throw new AbsenceRefused(problem)
  }

  return values as typeof values & { firstDay: IsoDate; lastDay: IsoDate }
}

/** Refuses an absence that shares a half day with another of its kind that still counts. */
async function refuseOverlap(tx: TenantTransaction, personId: string, span: Span, except?: string) {
  const near = await tx
    .select()
    .from(absences)
    .where(
      and(
        eq(absences.personId, personId as PersonId),
        eq(absences.kind, span.kind),
        ne(absences.state, 'rejected'),
        isNull(absences.deletedAt),
        lte(absences.firstDay, span.lastDay),
        gte(absences.lastDay, span.firstDay),
      ),
    )

  if (near.some((row) => row.id !== except && overlaps(spanOf(row), span))) {
    throw new AbsenceOverlaps(
      span.kind === 'sickness'
        ? 'An diesen Tagen ist schon eine Krankheit eingetragen.'
        : 'An diesen Tagen ist schon Urlaub eingetragen oder beantragt.',
    )
  }
}

/** Leave or a sickness the office enters for a person: approved from the start. */
export async function enter(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
  input: AbsenceInput & { readonly personId?: unknown },
  now: Date,
): Promise<Row> {
  if (!(absenceKinds as readonly unknown[]).includes(input.kind)) {
    throw new AbsenceRefused('Wählen Sie Urlaub oder Krankheit.')
  }

  const values = checked(input, input.kind as AbsenceKind)
  const person = await personOf(tx, typeof input.personId === 'string' ? input.personId : '')

  await refuseOverlap(tx, person.id, { ...values, state: 'approved' })

  const [created] = await tx
    .insert(absences)
    .values({
      ...values,
      tenantId,
      personId: person.id,
      state: 'approved',
      decidedBy: userId,
      decidedAt: now,
    })
    .returning()

  if (!created) {
    throw new Error('The absence was not written.')
  }

  return created
}

async function absenceOf(tx: TenantTransaction, id: string): Promise<Row> {
  const [row] = await tx
    .select()
    .from(absences)
    .where(and(eq(absences.id, id as AbsenceId), isNull(absences.deletedAt)))

  if (!row) {
    throw new AbsenceNotFound()
  }

  return row
}

/** Other days, halves or note for an absence; its kind stays. */
export async function change(tx: TenantTransaction, id: string, input: AbsenceInput): Promise<Row> {
  const row = await absenceOf(tx, id)
  const values = checked(
    {
      firstDay: input.firstDay ?? row.firstDay,
      lastDay: input.lastDay ?? row.lastDay,
      startsAtNoon: input.startsAtNoon ?? row.startsAtNoon,
      endsAtNoon: input.endsAtNoon ?? row.endsAtNoon,
      note: input.note === undefined ? row.note : input.note,
    },
    row.kind,
  )

  if (row.state !== 'rejected') {
    await refuseOverlap(tx, row.personId, { ...values, state: row.state }, row.id)
  }

  const changes = {
    firstDay: values.firstDay,
    lastDay: values.lastDay,
    startsAtNoon: values.startsAtNoon,
    endsAtNoon: values.endsAtNoon,
    note: values.note,
  }
  const [changed] = await tx
    .update(absences)
    .set(changes)
    .where(eq(absences.id, row.id))
    .returning()

  return changed ?? row
}

/** Takes an absence out, by marking it; the change log keeps it. */
export async function remove(tx: TenantTransaction, id: string, now: Date): Promise<void> {
  const row = await absenceOf(tx, id)

  await tx.update(absences).set({ deletedAt: now }).where(eq(absences.id, row.id))
}

/** The office approves a request or turns it down, with an answer the person reads. */
export async function decide(
  tx: TenantTransaction,
  userId: string,
  id: string,
  decision: 'approve' | 'reject',
  answer: unknown,
  now: Date,
): Promise<Row> {
  const row = await absenceOf(tx, id)

  if (row.state !== 'requested') {
    throw new AbsenceRefused('Über diesen Antrag ist schon entschieden.')
  }

  const text = typeof answer === 'string' && answer.trim() !== '' ? answer.trim() : null

  if (text !== null && text.length > 500) {
    throw new AbsenceRefused('Die Antwort hat höchstens 500 Zeichen.')
  }

  if (decision === 'approve') {
    await refuseOverlap(tx, row.personId, { ...spanOf(row), state: 'approved' }, row.id)
  }

  const [decided] = await tx
    .update(absences)
    .set({
      state: decision === 'approve' ? 'approved' : 'rejected',
      answer: decision === 'approve' ? null : text,
      decidedBy: userId,
      decidedAt: now,
    })
    .where(eq(absences.id, row.id))
    .returning()

  return decided ?? row
}

/** The days of leave of a person for a year and what came over, in half days. */
export async function setEntitlement(
  tx: TenantTransaction,
  tenantId: TenantId,
  personId: string,
  year: number,
  input: { readonly entitledHalfDays?: unknown; readonly carriedHalfDays?: unknown },
) {
  const values = {
    year,
    entitledHalfDays: input.entitledHalfDays,
    carriedHalfDays: input.carriedHalfDays,
  }
  const problem = Object.values(entitlementProblems(values))[0]

  if (problem !== undefined) {
    throw new AbsenceRefused(problem)
  }

  const person = await personOf(tx, personId)
  const current = await entitlementOf(tx, person.id, year)
  const halves = {
    entitledHalfDays: values.entitledHalfDays as number,
    carriedHalfDays: values.carriedHalfDays as number,
  }

  if (current) {
    const [changed] = await tx
      .update(leaveEntitlements)
      .set(halves)
      .where(eq(leaveEntitlements.id, current.id))
      .returning()

    return changed ?? current
  }

  const [created] = await tx
    .insert(leaveEntitlements)
    .values({ tenantId, personId: person.id, year, ...halves })
    .returning()

  return created
}

/** Leave whoever asks wants: requested, for the office to decide. */
export async function requestLeave(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
  input: AbsenceInput,
): Promise<Row> {
  const person = await ownPersonOf(tx, userId)

  if (person === null) {
    throw new AbsenceRefused(
      'Für dich gibt es in diesem Betrieb noch keine Akte. Das Büro legt sie an.',
    )
  }

  const values = checked(input, 'vacation')

  await refuseOverlap(tx, person.id, { ...values, state: 'requested' })

  const [created] = await tx
    .insert(absences)
    .values({ ...values, tenantId, personId: person.id, state: 'requested' })
    .returning()

  if (!created) {
    throw new Error('The request was not written.')
  }

  return created
}

/** Takes back a request of one's own the office has not decided yet. */
export async function withdraw(
  tx: TenantTransaction,
  userId: string,
  id: string,
  now: Date,
): Promise<void> {
  const person = await ownPersonOf(tx, userId)
  const row = await absenceOf(tx, id)

  if (person === null || row.personId !== person.id) {
    throw new AbsenceNotFound()
  }

  if (row.state !== 'requested') {
    throw new AbsenceRefused(
      'Über diesen Antrag ist schon entschieden; zurückziehen kann ihn nur das Büro.',
    )
  }

  await tx.update(absences).set({ deletedAt: now }).where(eq(absences.id, row.id))
}

/** Who is away when, for whoever plans: the kind only for whoever keeps absences. */
export interface PlanningEntry {
  readonly personId: string
  readonly name: string
  readonly kind: AbsenceKind | 'absent'
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
}

/** At most this many days at once, a year and a month. */
export const planningDays = 400

export async function planning(
  tx: TenantTransaction,
  from: IsoDate,
  to: IsoDate,
  seesKinds: boolean,
): Promise<readonly PlanningEntry[]> {
  const staff = await tx
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(isNull(people.deletedAt))
  const names = new Map(staff.map((person) => [person.id, person.name]))
  const rows = await absencesBetween(tx, [...names.keys()], from, to)

  return rows
    .filter((row) => row.state === 'approved')
    .map((row) => ({
      personId: row.personId,
      name: names.get(row.personId) ?? '',
      kind: seesKinds ? row.kind : 'absent',
      firstDay: row.firstDay,
      lastDay: row.lastDay,
      startsAtNoon: row.startsAtNoon,
      endsAtNoon: row.endsAtNoon,
    }))
}

/** The holidays of the business for a year, or of another state to look at before saving. */
export interface HolidayView {
  readonly state: HolidaySetting['state'] | null
  readonly local: readonly string[]
  readonly shown: HolidaySetting['state'] | null
  /** The local holidays of the state shown, each with its day in the year. */
  readonly options: readonly (LocalHoliday & { readonly on: IsoDate | null })[]
  readonly holidays: readonly Holiday[]
}

export async function holidayView(
  tx: TenantTransaction,
  year: number,
  look?: unknown,
): Promise<HolidayView> {
  const setting = await holidaySettingOf(tx)
  const shown = isFederalState(look) ? look : (setting?.state ?? null)

  if (shown === null) {
    return { state: null, local: [], shown: null, options: [], holidays: [] }
  }

  const local = setting !== null && setting.state === shown ? setting.local : []

  return {
    state: setting?.state ?? null,
    local: setting?.local ?? [],
    shown,
    options: localHolidaysOf(shippedRules, shown).map((option) => ({
      ...option,
      on:
        holidaysIn(shippedRules, { state: shown, local: [option.key] }, year).find(
          (holiday) => holiday.key === option.key,
        )?.on ?? null,
    })),
    holidays: holidaysIn(shippedRules, { state: shown, local }, year),
  }
}

/** Where the business is, and which of the local holidays of its state it counts. */
export async function setHolidays(
  tx: TenantTransaction,
  tenantId: TenantId,
  input: { readonly state?: unknown; readonly local?: unknown },
): Promise<HolidaySetting> {
  if (!isFederalState(input.state)) {
    throw new AbsenceRefused('Wählen Sie ein Bundesland.')
  }

  const offered = new Set(localHolidaysOf(shippedRules, input.state).map((holiday) => holiday.key))
  const local = Array.isArray(input.local) ? [...new Set(input.local)] : []

  if (local.some((key) => typeof key !== 'string' || !offered.has(key))) {
    throw new AbsenceRefused('Ein örtlicher Feiertag gehört nicht zu diesem Bundesland.')
  }

  const [current] = await tx.select().from(holidaySettings).where(isNull(holidaySettings.deletedAt))
  const values = { state: input.state, localHolidays: local as string[] }

  if (current) {
    await tx.update(holidaySettings).set(values).where(eq(holidaySettings.id, current.id))
  } else {
    await tx.insert(holidaySettings).values({ tenantId, ...values })
  }

  return { state: input.state, local: values.localHolidays }
}

/** How a span of days would count for a person, before it is saved. */
export interface DayCount {
  readonly workingHalfDays: number
  /** Null for a sickness. */
  readonly leaveHalfDays: number | null
  readonly holidays: number
  /** What is left of the leave of the year of the first day after this and every open request. */
  readonly restAfterHalfDays: number
}

async function countFor(
  tx: TenantTransaction,
  person: { id: string },
  input: AbsenceInput,
  kind: AbsenceKind,
): Promise<DayCount> {
  const values = checked(input, kind)
  const year = Number(values.firstDay.slice(0, 4))
  const { from, to } = yearOf(year)
  const setting = await holidaySettingOf(tx)
  const isHoliday = holidaysOf(setting)
  const times = (await timesOf(tx, [person.id])).get(person.id) ?? []
  const rows = await absencesBetween(
    tx,
    [person.id],
    from < values.firstDay ? from : values.firstDay,
    to > values.lastDay ? to : values.lastDay,
  )
  const spans = rows.map(spanOf)
  const count = countAbsence({ ...values, state: 'requested' }, { others: spans, times, isHoliday })
  const leave = leaveYear({
    year,
    entitlement: await entitlementOf(tx, person.id, year),
    absences: spans,
    times,
    isHoliday,
  })
  const holidays = holidayDaysAround(setting, [year, year + 1]).filter(
    (on) => on >= values.firstDay && on <= values.lastDay,
  ).length

  return {
    workingHalfDays: count.workingHalfDays,
    leaveHalfDays: count.leaveHalfDays,
    holidays,
    restAfterHalfDays: leave.restHalfDays - leave.requestedHalfDays - (count.leaveHalfDays ?? 0),
  }
}

/** The count of a span for a person of the business, for the form of the office. */
export async function countForPerson(
  tx: TenantTransaction,
  personId: string,
  input: AbsenceInput,
): Promise<DayCount> {
  const kind = (absenceKinds as readonly unknown[]).includes(input.kind)
    ? (input.kind as AbsenceKind)
    : 'vacation'

  return countFor(tx, await personOf(tx, personId), input, kind)
}

/** The count of a span of leave for whoever asks, for their request. */
export async function countForMe(
  tx: TenantTransaction,
  userId: string,
  input: AbsenceInput,
): Promise<DayCount> {
  const person = await ownPersonOf(tx, userId)

  if (person === null) {
    throw new AbsenceNotFound()
  }

  return countFor(tx, person, input, 'vacation')
}
