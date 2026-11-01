import { addDays, type IsoDate } from '@opengewerk/domain'
import { Button, Panel, Status } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { accountQuery } from '@opengewerk/platform-web/session'
import { SiteAnchor, SiteLink, SiteScreen, SiteText } from '@opengewerk/platform-web/site'
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
import { Check, MapPin, Repeat } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'

import {
  appointmentOf,
  clockOf,
  dayMonth,
  longDays,
  type MyDay,
  myDays,
  personOf,
  seriesText,
  weekdayIndex,
  whenOnDay,
} from '../../app/appointments.js'
import { addressLine } from '../../app/format.js'
import { jobKindLabel, jobKindOf } from '../../app/labels.js'
import { confirmAppointment } from '../../session/appointments.js'
import { SiteHeader } from '../header.js'
import { SiteCalendarPanel } from './calendar-feed.js'

/**
 * One's own appointments on site (#290): from today for four weeks, day by
 * day, from the device and so also without a network; a time over several
 * days stands on each of them. A new or changed one is confirmed here, which
 * needs a network. Boards "Meine Termine", "Meine Termine, ohne Netz" and
 * "Offene Aufträge mit Terminen" of the canvas, version 98.
 *
 * The names of the colleagues on an appointment are not here: names do not
 * travel to a device.
 */

/** Four weeks from today, as far as the list looks ahead. */
const ahead = 28

function useMyDays(from: IsoDate, to: IsoDate): readonly MyDay[] {
  const account = useQuery(accountQuery)
  const appointments = useRecords('appointments')
  const people = useRecords('appointment_people')
  const me = account.data?.userId ?? null

  return useMemo(
    () =>
      me === null
        ? []
        : myDays(appointments.map(appointmentOf), people.map(personOf), me, from, to),
    [appointments, people, me, from, to],
  )
}

function dayHeading(on: IsoDate): string {
  const now = today()
  const prefix = on === now ? 'Heute, ' : on === addDays(now, 1) ? 'Morgen, ' : ''

  return `${prefix}${longDays[weekdayIndex(on)]}, ${dayMonth(on)}`
}

/** "Deine Termine" on top of the open jobs: today and tomorrow, and the way to all of them. */
export function AppointmentsCard() {
  const now = today()
  const days = useMyDays(now, addDays(now, 1))
  const jobs = useRecords('jobs')

  if (days.length === 0) {
    return null
  }

  return (
    <Panel title="Deine Termine">
      <div className="flex flex-col gap-2">
        <ul className="m-0 list-none p-0">
          {days.map((day) => {
            const job = jobs.find((each) => text(each, 'id') === day.appointment.jobId)

            return (
              <li
                key={`${day.appointment.id}-${day.on}`}
                className="border-b border-row py-[9px] text-[17px]"
              >
                <b className="tabular-nums">
                  {`${day.on === now ? 'Heute' : 'Morgen'} ${day.part !== null && day.part.day > 1 ? 'ganztags' : clockOf(day.occurrence.startsAt)}`}
                </b>{' '}
                {job ? text(job, 'designation') : 'Auftrag'}
                {day.confirmed ? null : (
                  <span className="block text-[15px] font-semibold text-waiting">
                    Noch nicht bestätigt
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <SiteLink to="/termine">Alle Termine</SiteLink>
      </div>
    </Panel>
  )
}

export function SiteAppointmentsScreen() {
  const status = useSyncStatus()
  const now = today()
  const last = addDays(now, ahead - 1)
  const days = useMyDays(now, last)
  const jobs = useRecords('jobs')
  const sites = useRecords('sites')
  const customers = useRecords('customers')

  return (
    <SiteScreen gap={10}>
      <SiteHeader title="Meine Termine" sub="Aufträge" />
      {days.length === 0 ? (
        <SiteText muted>In den nächsten vier Wochen hast du keine Termine.</SiteText>
      ) : null}
      {days.map((day, index) => {
        const job = jobs.find((each) => text(each, 'id') === day.appointment.jobId)
        const site = job
          ? sites.find((each) => text(each, 'id') === maybeText(job, 'siteId'))
          : undefined
        const customer = job
          ? customers.find((each) => text(each, 'id') === text(job, 'customerId'))
          : undefined

        return (
          <Fragment key={`${day.appointment.id}-${day.on}`}>
            {index === 0 || days[index - 1]?.on !== day.on ? (
              <h2 className="m-0 mt-1 font-condensed text-[15px] font-semibold tracking-[1px] text-ink-faint uppercase">
                {dayHeading(day.on)}
              </h2>
            ) : null}
            <AppointmentCard
              day={day}
              today={day.on === now}
              online={status.online}
              title={job ? text(job, 'designation') : 'Auftrag'}
              facts={
                job
                  ? `${maybeText(job, 'number') ?? 'Nummer folgt'}, ${jobKindLabel[jobKindOf(job)]}`
                  : ''
              }
              customer={customer ? text(customer, 'name') : null}
              address={site ? addressLine(site) : null}
            />
          </Fragment>
        )
      })}
      <SiteText muted size={15}>
        {`Bis ${longDays[weekdayIndex(last)]}, ${date(last)}, vier Wochen ab heute.`}
      </SiteText>
      <SiteCalendarPanel />
    </SiteScreen>
  )
}

function AppointmentCard({
  day,
  today: isToday,
  online,
  title,
  facts,
  customer,
  address,
}: {
  readonly day: MyDay
  readonly today: boolean
  readonly online: boolean
  readonly title: string
  readonly facts: string
  readonly customer: string | null
  readonly address: string | null
}) {
  const client = useSync()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const when = whenOnDay(day)
  const series = seriesText(day.appointment)

  async function confirm() {
    setWorking(true)
    setTrouble(null)

    try {
      await confirmAppointment(day.appointment.id, day.appointment.revision)
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.status === 409
            ? 'Das Büro hat den Termin inzwischen geändert. Sieh ihn dir noch einmal an.'
            : error.message
          : 'Keine Verbindung. Zum Bestätigen braucht es Netz.',
      )
    } finally {
      await client.synchronise()
      setWorking(false)
    }
  }

  return (
    <article
      className={clsx(
        'flex flex-col gap-1.5 rounded-[6px] border border-l-4 border-line bg-surface py-[13px] pr-3.5 pl-4',
        isToday ? 'border-l-copper' : 'border-l-control',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grow text-[19px] font-bold tabular-nums">{when.line}</span>
        {day.confirmed ? (
          <Status tone="done" icon={Check}>
            Bestätigt
          </Status>
        ) : (
          <Status tone="waiting">Neu</Status>
        )}
      </div>
      {when.until !== null ? (
        <div className="text-[16px] font-semibold tabular-nums">{when.until}</div>
      ) : null}
      <div className="text-[19px] leading-[1.25] font-bold">{title}</div>
      {facts !== '' ? <div className="text-[15px] text-ink-faint">{facts}</div> : null}
      {customer !== null ? <div className="text-[16px] text-ink-muted">{customer}</div> : null}
      {address !== null && address !== '' ? (
        <SiteAnchor href={`geo:0,0?q=${encodeURIComponent(address)}`} icon={MapPin}>
          {address}
        </SiteAnchor>
      ) : null}
      {day.appointment.note !== null ? (
        <SiteText muted size={15}>
          {day.appointment.note}
        </SiteText>
      ) : null}
      {series !== null ? (
        <div className="flex items-center gap-1.5 text-[15px] text-ink-faint">
          <Repeat size={15} strokeWidth={2.2} aria-hidden="true" />
          {series}
        </div>
      ) : null}
      {day.confirmed ? null : (
        <div className="flex flex-col gap-1.5">
          <Button
            tone="primary"
            wide
            height={52}
            icon={Check}
            disabled={!online || working}
            onClick={() => void confirm()}
          >
            {working ? 'Einen Moment' : 'Termin bestätigen'}
          </Button>
          {online ? null : (
            <SiteText muted size={15}>
              Zum Bestätigen braucht es Netz.
            </SiteText>
          )}
        </div>
      )}
      {trouble !== null ? (
        <p role="alert" className="m-0 text-[15px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <SiteLink to={`/auftraege/${day.appointment.jobId}`}>Zum Auftrag</SiteLink>
    </article>
  )
}
