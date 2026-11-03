import { addDays, occurrencesBetween } from '@opengewerk/domain'
import { Panel, Status } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { useRecords } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import {
  appointmentOf,
  clockOf,
  personOf,
  shortDays,
  weekdayIndex,
} from '../../app/appointments.js'
import { usePeople } from '../../app/tasks.js'

/**
 * The appointments of a job in the office (#292): when the next time of each
 * is, who goes and whether they confirmed it. What a call taken on the phone
 * became, under its instructions; moved and changed on the planning board.
 */
export function JobAppointmentsPanel({ jobId }: { readonly jobId: string }) {
  const appointmentRecords = useRecords('appointments')
  const personRecords = useRecords('appointment_people')
  const { people } = usePeople()
  const names = useMemo(
    () => new Map(people.map((person) => [person.userId, person.name])),
    [people],
  )
  const from = today()

  const shown = useMemo(() => {
    const persons = personRecords.filter((record) => !record['deletedAt']).map(personOf)

    return appointmentRecords
      .filter((record) => !record['deletedAt'] && record['jobId'] === jobId)
      .map(appointmentOf)
      .flatMap((appointment) => {
        const next = occurrencesBetween(appointment, from, addDays(from, 365))[0]

        if (!next) {
          return []
        }

        const on = persons.filter((person) => person.appointmentId === appointment.id)

        return [
          {
            id: appointment.id,
            when: `${shortDays[weekdayIndex(next.firstDay)]} ${date(next.firstDay)}, ${clockOf(next.startsAt)} bis ${clockOf(next.endsAt)}`,
            startsAt: next.startsAt.getTime(),
            who: on.map((person) => names.get(person.userId) ?? 'Unbekannt').join(', '),
            confirmed:
              on.length > 0 &&
              on.every((person) => person.confirmedRevision === appointment.revision),
          },
        ]
      })
      .sort((left, right) => left.startsAt - right.startsAt)
  }, [appointmentRecords, personRecords, jobId, from, names])

  if (shown.length === 0) {
    return null
  }

  return (
    <Panel
      title="Termine"
      action={
        <Link to="/plantafel" className="text-[13px] text-copper-text underline underline-offset-2">
          Auf der Plantafel
        </Link>
      }
    >
      <ul className="flex flex-col">
        {shown.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-row py-1.5 last:border-b-0"
          >
            <b className="numeric text-[14px] font-semibold">{item.when}</b>
            <span className="text-[14px]">{item.who}</span>
            <span className="ml-auto">
              {item.confirmed ? (
                <Status tone="done">Bestätigt</Status>
              ) : (
                <Status tone="waiting">Noch nicht bestätigt</Status>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
