import {
  berlinDay,
  effectiveEntries,
  hoursText,
  type IsoDate,
  minutesBetween,
  type RecordState,
  shippedRules,
  workingTimeWarnings,
} from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Cell, Column, SelectField, Table } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import {
  clockOf,
  minutesOf,
  shiftDay,
  startingOn,
  timed,
  timeEntryKindLabel,
  timeEntryKindOf,
  useMe,
  useTimeEntries,
} from '../../app/time.js'
import { timePeople } from '../../session/time.js'
import type { Assignee } from '../../session/tasks.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecords } from '../../sync/provider.js'
import { Nothing, Page, Section } from '../layout.js'

/** The people of the business by name, for whoever reads the time of the others. */
function usePeopleForTime(): readonly Assignee[] {
  const readsTime = useMay('time.read')
  const people = useQuery({
    queryKey: ['time-people'],
    queryFn: timePeople,
    enabled: readsTime,
    staleTime: 5 * 60_000,
    retry: false,
  })

  return Array.isArray(people.data) ? people.data : []
}

/** Whose an entry is, by name. A key is not a name. */
function nameOf(userId: string, people: readonly Assignee[]): string {
  return people.find((person) => person.userId === userId)?.name ?? 'Unbekanntes Konto'
}

/** The Monday of the week a day is in, as ISO. */
function mondayOf(on: string): IsoDate {
  const weekday = new Date(`${on}T12:00:00Z`).getUTCDay()

  return shiftDay(on, -((weekday + 6) % 7))
}

const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

/**
 * The working time of everybody, one person and one week at a time (#76).
 *
 * Behind `time.read`, which the office and the owner have and a technician
 * does not: on a device the others' time never arrives for them, and here the
 * screen is not offered. One person at a time because the Working Hours Act
 * speaks about one person's days; a week because that is how a week's wages
 * and a week's plan are read. The warnings are the same as on the phone of the
 * person, worked out from the same entries by the same rules in `domain`.
 *
 * Nothing here changes an entry. A correction is made by the person whose time
 * it is, because the record is theirs; the office sees the correction and
 * what it replaced.
 */
export function TimeScreen() {
  const readsTime = useMay('time.read')
  const me = useMe()
  const people = usePeopleForTime()
  const entries = useTimeEntries()
  const [chosen, setChosen] = useState<string | null>(null)
  const [monday, setMonday] = useState<IsoDate>(() => mondayOf(today()))
  const owners = useMemo(
    () =>
      [...new Set(entries.map((entry) => maybeText(entry, 'userId')).filter(Boolean))] as string[],
    [entries],
  )
  const options = useMemo(() => {
    const known = new Set([...people.map((person) => person.userId), ...owners])

    return [...known]
      .map((userId) => ({ value: userId, label: nameOf(userId, people) }))
      .sort((left, right) => left.label.localeCompare(right.label, 'de'))
  }, [people, owners])
  const person = chosen ?? owners[0] ?? me ?? ''
  const theirs = useMemo(
    () => entries.filter((entry) => maybeText(entry, 'userId') === person),
    [entries, person],
  )
  const counting = useMemo(() => effectiveEntries(theirs), [theirs])
  const days = useMemo(
    () =>
      weekdays.map((name, index) => {
        const on = shiftDay(monday, index)
        const ofTheDay = startingOn(counting, on)

        return {
          name,
          on,
          work: minutesOf(ofTheDay, 'work'),
          travel: minutesOf(ofTheDay, 'travel'),
          pause: minutesOf(ofTheDay, 'break'),
          warnings: workingTimeWarnings(counting.map(timed), on, shippedRules),
        }
      }),
    [counting, monday],
  )
  const week = useMemo(
    () => theirs.filter((entry) => days.some((day) => startingOn([entry], day.on).length > 0)),
    [theirs, days],
  )

  if (!readsTime) {
    return (
      <Page title="Zeiten">
        <Nothing>Die Zeiten der anderen sieht deine Rolle nicht.</Nothing>
      </Page>
    )
  }

  const total = days.reduce((sum, day) => sum + day.work + day.travel, 0)

  return (
    <Page
      title="Zeiten"
      meta={`Woche vom ${date(monday)} bis ${date(shiftDay(monday, 6))}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setMonday(shiftDay(monday, -7))
            }}
          >
            Vorwoche
          </Button>
          <Button
            onClick={() => {
              setMonday(mondayOf(today()))
            }}
          >
            Diese Woche
          </Button>
          <Button
            onClick={() => {
              setMonday(shiftDay(monday, 7))
            }}
          >
            Folgewoche
          </Button>
        </div>
      }
    >
      <div className="max-w-sm">
        <SelectField
          label="Person"
          value={person}
          options={options.length > 0 ? options : [{ value: '', label: 'Noch niemand' }]}
          onChange={setChosen}
        />
      </div>

      <Section title="Die Woche">
        <Table caption="Arbeitszeit der Woche nach Tagen">
          <thead>
            <tr>
              <Column>Tag</Column>
              <Column numeric>Arbeit</Column>
              <Column numeric>Fahrt</Column>
              <Column numeric>Pause</Column>
              <Column>Nach dem Arbeitszeitgesetz</Column>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.on}>
                <Cell>{`${day.name}, ${date(day.on)}`}</Cell>
                <Cell numeric className="whitespace-nowrap">
                  {hoursText(day.work)}
                </Cell>
                <Cell numeric className="whitespace-nowrap">
                  {hoursText(day.travel)}
                </Cell>
                <Cell numeric className="whitespace-nowrap">
                  {hoursText(day.pause)}
                </Cell>
                <Cell>
                  {day.warnings.length === 0 ? (
                    <span className="text-ink-muted">keine Hinweise</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {day.warnings.map((warning) => (
                        <li key={warning.kind}>{warning.text}</li>
                      ))}
                    </ul>
                  )}
                </Cell>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-body">{`Arbeit und Fahrt in dieser Woche: ${hoursText(total)}`}</p>
      </Section>

      <Section title="Einträge">
        {week.length === 0 ? (
          <Nothing>In dieser Woche ist für diese Person nichts erfasst.</Nothing>
        ) : (
          <EntryTable entries={week} all={theirs} />
        )}
      </Section>
    </Page>
  )
}

/**
 * Every entry of the week as written, the ones replaced and taken back
 * included. What counts is marked; what does not says why, so the office can
 * read the history the law keeps for two years.
 */
function EntryTable({
  entries,
  all,
}: {
  readonly entries: readonly RecordState[]
  /** All entries of the person, because a correction can be written in another week. */
  readonly all: readonly RecordState[]
}) {
  const jobs = useRecords('jobs')
  const counting = useMemo(
    () => new Set(effectiveEntries(all).map((entry) => String(entry['id']))),
    [all],
  )
  const replacedBy = useMemo(() => {
    const by = new Map<string, RecordState>()

    for (const entry of all) {
      const corrects = maybeText(entry, 'correctsEntryId')

      if (corrects) {
        by.set(corrects, entry)
      }
    }

    return by
  }, [all])

  return (
    <Table caption="Einträge der Woche">
      <thead>
        <tr>
          <Column>Tag</Column>
          <Column>Von</Column>
          <Column>Bis</Column>
          <Column>Art</Column>
          <Column>Auftrag</Column>
          <Column numeric>Dauer</Column>
          <Column>Stand</Column>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const id = String(entry['id'])
          const job = jobs.find(
            (candidate) => String(candidate['id']) === maybeText(entry, 'jobId'),
          )
          const start = text(entry, 'startedAt')
          const end = text(entry, 'endedAt')
          const later = replacedBy.get(id)
          const state =
            entry['withdrawn'] === true
              ? `Streicht einen Eintrag. Grund: ${text(entry, 'note')}`
              : later
                ? later['withdrawn'] === true
                  ? 'Gestrichen'
                  : `Korrigiert auf ${date(berlinDay(text(later, 'startedAt')))}, ${clockOf(text(later, 'startedAt'))} bis ${clockOf(text(later, 'endedAt'))}`
                : maybeText(entry, 'correctsEntryId')
                  ? `Korrektur. Grund: ${text(entry, 'note')}`
                  : (maybeText(entry, 'note') ?? 'gilt')

          return (
            <tr key={id} className={counting.has(id) ? undefined : 'text-ink-muted'}>
              <Cell className="whitespace-nowrap">{date(berlinDay(start))}</Cell>
              <Cell className="whitespace-nowrap">{clockOf(start)}</Cell>
              <Cell className="whitespace-nowrap">{clockOf(end)}</Cell>
              <Cell>{timeEntryKindLabel[timeEntryKindOf(entry)]}</Cell>
              <Cell>
                {job ? (
                  <Link
                    to={`/auftraege/${String(job['id'])}`}
                    className="text-copper-text underline underline-offset-2"
                  >
                    {text(job, 'designation')}
                  </Link>
                ) : (
                  <span className="text-ink-faint">keinem</span>
                )}
              </Cell>
              <Cell numeric className="whitespace-nowrap">
                {hoursText(minutesBetween(start, end))}
              </Cell>
              <Cell>{state}</Cell>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

/**
 * What was recorded at one job, on its screen in the office: work and travel
 * by person, for the report and the invoice. Only what counts.
 */
export function JobTimeSection({ jobId }: { readonly jobId: string }) {
  const readsTime = useMay('time.read')
  const people = usePeopleForTime()
  const entries = useTimeEntries()
  const byPerson = useMemo(() => {
    const here = effectiveEntries(entries).filter((entry) => maybeText(entry, 'jobId') === jobId)
    const grouped = new Map<string, RecordState[]>()

    for (const entry of here) {
      const userId = maybeText(entry, 'userId') ?? ''

      grouped.set(userId, [...(grouped.get(userId) ?? []), entry])
    }

    return [...grouped.entries()].map(([userId, list]) => ({
      userId,
      work: minutesOf(list, 'work'),
      travel: minutesOf(list, 'travel'),
    }))
  }, [entries, jobId])

  if (!readsTime) {
    return null
  }

  return (
    <Section title="Zeiten">
      {byPerson.length === 0 ? (
        <Nothing>Für diesen Auftrag ist noch keine Zeit erfasst.</Nothing>
      ) : (
        <Table caption="Erfasste Zeit an diesem Auftrag">
          <thead>
            <tr>
              <Column>Person</Column>
              <Column numeric>Arbeit</Column>
              <Column numeric>Fahrt</Column>
            </tr>
          </thead>
          <tbody>
            {byPerson.map((row) => (
              <tr key={row.userId}>
                <Cell>{nameOf(row.userId, people)}</Cell>
                <Cell numeric className="whitespace-nowrap">
                  {hoursText(row.work)}
                </Cell>
                <Cell numeric className="whitespace-nowrap">
                  {hoursText(row.travel)}
                </Cell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  )
}
