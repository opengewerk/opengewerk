import type { IsoDate } from '@opengewerk/platform-domain'

import { berlinWall, nextOccurrence } from './appointment.js'

/**
 * The own appointments in the own calendar (#291, Feature-Gliederung 4.3): a
 * calendar in the format iCalendar after RFC 5545, which every common calendar
 * subscribes to, Google, Apple, Outlook, Thunderbird, Nextcloud, and on
 * Android ICSx⁵.
 *
 * Read only. The planning board stays the source, and the calendar fetches the
 * whole file again on its own schedule; what changed reaches a person at once
 * by push (#290). A series goes out as the rule the board stored, with the
 * days taken out of it, so that the calendar works out its days itself, and in
 * German time with the zone written out, so that seven in winter stays seven
 * in summer there too. A CalDAV server, read only, would send the same events
 * (#810).
 */

/** One appointment as the calendar shows it. */
export interface CalendarEntry {
  /** Stays the same across every change, so that a calendar replaces instead of adding. */
  readonly uid: string
  /** The version of the appointment, from 1; a calendar takes the higher one. */
  readonly revision: number
  readonly createdAt: Date
  readonly changedAt: Date
  readonly startsAt: Date
  readonly endsAt: Date
  /** The rule of a series as the board stored it, or null. */
  readonly rrule: string | null
  readonly exdates: readonly IsoDate[]
  readonly title: string
  readonly place: string | null
  readonly description: string | null
  readonly url: string | null
}

/** How far back the calendar holds appointments; everything later is in it. */
export const calendarFeedDaysBack = 90

/** How often the calendar is asked to fetch again. A wish: Google, for one, decides alone. */
const refreshEvery = 'PT15M'

const zone = 'Europe/Berlin'

/**
 * The zone, written out once, as RFC 5545 asks of every TZID it names: the
 * last Sunday of March at two to summer time, the last Sunday of October at
 * three back. A calendar that knows the zone by its name uses its own.
 */
const berlinZone = [
  'BEGIN:VTIMEZONE',
  `TZID:${zone}`,
  `X-LIC-LOCATION:${zone}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/**
 * Whether an appointment still belongs in the calendar at a moment: one that
 * ended within the last days the calendar holds, and every one after.
 */
export function inCalendarFeed(
  appointment: Pick<CalendarEntry, 'startsAt' | 'endsAt' | 'rrule' | 'exdates'>,
  now: Date,
): boolean {
  const from = new Date(now.getTime() - calendarFeedDaysBack * 86_400_000)

  if (appointment.rrule === null) {
    return appointment.endsAt.getTime() > from.getTime()
  }

  return nextOccurrence(appointment, from) !== null
}

/**
 * The calendar of one person: its name, and the appointments in it.
 *
 * Lines end in CR LF and are folded after 75 octets, as RFC 5545 asks; an
 * empty list is a calendar without appointments, which a subscribed calendar
 * takes as "there are none" and empties itself.
 */
export function calendarOf(name: string, entries: readonly CalendarEntry[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenGewerk//Plantafel//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${calendarText(name)}`,
    `X-WR-CALNAME:${calendarText(name)}`,
    `X-WR-TIMEZONE:${zone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refreshEvery}`,
    `X-PUBLISHED-TTL:${refreshEvery}`,
    ...berlinZone,
    ...entries.flatMap(eventOf),
    'END:VCALENDAR',
  ]

  return lines.map(folded).join('\r\n') + '\r\n'
}

function eventOf(entry: CalendarEntry): string[] {
  const start = berlinWall(entry.startsAt)
  const lines = [
    'BEGIN:VEVENT',
    `UID:${entry.uid}@opengewerk`,
    `SEQUENCE:${Math.max(0, entry.revision - 1)}`,
    `DTSTAMP:${utcStamp(entry.changedAt)}`,
    `CREATED:${utcStamp(entry.createdAt)}`,
    `LAST-MODIFIED:${utcStamp(entry.changedAt)}`,
    `DTSTART;TZID=${zone}:${berlinStamp(entry.startsAt)}`,
    `DTEND;TZID=${zone}:${berlinStamp(entry.endsAt)}`,
  ]

  if (entry.rrule !== null) {
    lines.push(`RRULE:${entry.rrule}`)

    if (entry.exdates.length > 0) {
      // The day taken out, at the clock time the series begins: that is the
      // moment the calendar would have put it, in summer as in winter.
      const at = wallStamp(start.minute)
      lines.push(
        `EXDATE;TZID=${zone}:${entry.exdates.map((on) => `${on.replaceAll('-', '')}T${at}`).join(',')}`,
      )
    }
  }

  lines.push(`SUMMARY:${calendarText(entry.title)}`)

  if (entry.place !== null) {
    lines.push(`LOCATION:${calendarText(entry.place)}`)
  }

  if (entry.description !== null) {
    lines.push(`DESCRIPTION:${calendarText(entry.description)}`)
  }

  if (entry.url !== null) {
    lines.push(`URL:${entry.url.replace(/[\r\n]/g, '')}`)
  }

  lines.push('END:VEVENT')

  return lines
}

/**
 * A text the way RFC 5545 carries it: backslash, semicolon and comma escaped,
 * a line break as `\n`, and no other control character, which no calendar
 * accepts in a value.
 */
export function calendarText(value: string): string {
  return withoutControls(value.replace(/\r\n?/g, '\n'))
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/** A text without control characters, except the tab and the line break. */
function withoutControls(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0)

      return code === 9 || code === 10 || (code >= 32 && code !== 127)
    })
    .join('')
}

/** How many octets a character takes in UTF-8. */
function octetsOf(character: string): number {
  const point = character.codePointAt(0) ?? 0

  return point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
}

/**
 * A line folded after 75 octets, each further part after a space: RFC 5545
 * counts octets, not characters, and a fold may not cut a character of UTF-8
 * in two.
 */
export function folded(line: string): string {
  const parts: string[] = []
  let part = ''
  let octets = 0
  // The first line has 75 octets, every further one 74 after the space it begins with.
  let room = 75

  for (const character of line) {
    const size = octetsOf(character)

    if (octets + size > room) {
      parts.push(part)
      part = ''
      octets = 0
      room = 74
    }

    part += character
    octets += size
  }

  parts.push(part)

  return parts.join('\r\n ')
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function wallStamp(minute: number): string {
  return `${two(Math.floor(minute / 60))}${two(minute % 60)}00`
}

/** A moment as the clock in Germany shows it, for a value with TZID. */
function berlinStamp(at: Date): string {
  const { day, minute } = berlinWall(at)

  return `${day.replaceAll('-', '')}T${wallStamp(minute)}`
}

/** A moment in UTC, for the stamps that carry no zone. */
function utcStamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`
}
