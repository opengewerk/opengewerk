import { describe, expect, it } from 'vitest'

import {
  type CalendarEntry,
  calendarOf,
  calendarText,
  folded,
  inCalendarFeed,
} from './calendar-feed.js'

/** The octets of a text in UTF-8, counted the way a URL spells them out. */
function octets(text: string): number {
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, '.').length
}

function entry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    uid: '0190f3a2-7c41-7000-8000-000000000001',
    revision: 1,
    createdAt: new Date('2031-11-01T09:00:00Z'),
    changedAt: new Date('2031-11-02T10:30:00Z'),
    startsAt: new Date('2031-11-07T06:00:00Z'),
    endsAt: new Date('2031-11-07T15:00:00Z'),
    rrule: null,
    exdates: [],
    title: 'Zählerschrank erneuern, Familie Weber',
    place: 'Am Wingertsberg 8, 69214 Eppelheim',
    description: null,
    url: null,
    ...overrides,
  }
}

/** The lines of a calendar with the folds undone, as a calendar reads them. */
function unfolded(calendar: string): string[] {
  return calendar.replace(/\r\n /g, '').split('\r\n')
}

/** The lines of a property in the appointments, leaving out the ones of the zone. */
function valueOf(calendar: string, name: string): string[] {
  const lines = unfolded(calendar)
  const events = lines.slice(lines.indexOf('END:VTIMEZONE') + 1)

  return events.filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`))
}

describe('a calendar of appointments', () => {
  it('gives an appointment its German clock time with the zone, in winter and in summer', () => {
    const winter = calendarOf('Termine bei Elektro Kohm GmbH', [entry()])
    const summer = calendarOf('Termine bei Elektro Kohm GmbH', [
      entry({
        startsAt: new Date('2031-07-07T05:00:00Z'),
        endsAt: new Date('2031-07-07T14:00:00Z'),
      }),
    ])

    expect(valueOf(winter, 'DTSTART')).toEqual(['DTSTART;TZID=Europe/Berlin:20311107T070000'])
    expect(valueOf(winter, 'DTEND')).toEqual(['DTEND;TZID=Europe/Berlin:20311107T160000'])
    expect(valueOf(summer, 'DTSTART')).toEqual(['DTSTART;TZID=Europe/Berlin:20310707T070000'])
    expect(unfolded(winter)).toContain('TZID:Europe/Berlin')
  })

  it('sends a series as its rule with the days taken out at the clock time it begins', () => {
    const calendar = calendarOf('Termine', [
      entry({
        // Monday, 17 March, in winter; the day taken out is in summer.
        startsAt: new Date('2031-03-17T06:00:00Z'),
        endsAt: new Date('2031-03-17T08:00:00Z'),
        rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20310630T215959Z',
        exdates: ['2031-04-07', '2031-04-14'],
      }),
    ])

    expect(valueOf(calendar, 'RRULE')).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20310630T215959Z',
    ])
    expect(valueOf(calendar, 'EXDATE')).toEqual([
      'EXDATE;TZID=Europe/Berlin:20310407T070000,20310414T070000',
    ])
  })

  it('keeps the same uid and counts the sequence from the version, so that a calendar replaces', () => {
    const calendar = calendarOf('Termine', [entry({ revision: 3 })])

    expect(valueOf(calendar, 'UID')).toEqual([
      'UID:0190f3a2-7c41-7000-8000-000000000001@opengewerk',
    ])
    expect(valueOf(calendar, 'SEQUENCE')).toEqual(['SEQUENCE:2'])
    expect(valueOf(calendar, 'DTSTAMP')).toEqual(['DTSTAMP:20311102T103000Z'])
  })

  it('names job, customer and address, and leaves out what is not there', () => {
    const calendar = calendarOf('Termine', [
      entry({
        description: 'Auftrag AU-2031-0212\nGarage ist offen.',
        url: 'https://example.de/m/auftraege/1',
      }),
    ])
    const bare = calendarOf('Termine', [entry({ place: null })])

    expect(valueOf(calendar, 'SUMMARY')).toEqual([
      'SUMMARY:Zählerschrank erneuern\\, Familie Weber',
    ])
    expect(valueOf(calendar, 'LOCATION')).toEqual(['LOCATION:Am Wingertsberg 8\\, 69214 Eppelheim'])
    expect(valueOf(calendar, 'DESCRIPTION')).toEqual([
      'DESCRIPTION:Auftrag AU-2031-0212\\nGarage ist offen.',
    ])
    expect(valueOf(calendar, 'URL')).toEqual(['URL:https://example.de/m/auftraege/1'])
    expect(valueOf(bare, 'LOCATION')).toEqual([])
    expect(valueOf(bare, 'DESCRIPTION')).toEqual([])
  })

  it('is a calendar without appointments when there are none, so that a subscribed one empties', () => {
    const calendar = calendarOf('Termine', [])

    expect(unfolded(calendar)[0]).toBe('BEGIN:VCALENDAR')
    expect(calendar.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(calendar).not.toContain('BEGIN:VEVENT')
  })

  it('ends every line in CR LF and keeps it within 75 octets', () => {
    const calendar = calendarOf('Termine bei Elektro- und Gebäudetechnik Müller & Söhne GmbH', [
      entry({ description: 'Schlüssel bei Frau Özdemir im Erdgeschoss, '.repeat(6) }),
    ])

    expect(calendar.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)

    for (const line of calendar.split('\r\n')) {
      expect(octets(line)).toBeLessThanOrEqual(75)
    }
  })
})

describe('a text in a calendar', () => {
  it('escapes backslash, semicolon, comma and line breaks, and drops control characters', () => {
    expect(calendarText('a\\b; c, d\r\ne\nf\u0007g')).toBe('a\\\\b\\; c\\, d\\ne\\nfg')
  })

  it('is folded after 75 octets without cutting a character in two', () => {
    const line = `DESCRIPTION:${'ä'.repeat(80)}`
    const parts = folded(line).split('\r\n')

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true)
    expect(parts.every((part) => octets(part) <= 75)).toBe(true)
    expect(folded(line).replace(/\r\n /g, '')).toBe(line)
  })
})

describe('what a calendar holds', () => {
  const now = new Date('2031-11-05T12:00:00Z')

  it('holds an appointment that ended within the last 90 days and none before', () => {
    expect(inCalendarFeed(entry({ endsAt: new Date('2031-08-10T12:00:00Z') }), now)).toBe(true)
    expect(inCalendarFeed(entry({ endsAt: new Date('2031-08-05T12:00:00Z') }), now)).toBe(false)
  })

  it('holds a series as long as it has a day within them or later', () => {
    const ended = entry({
      startsAt: new Date('2031-01-06T06:00:00Z'),
      endsAt: new Date('2031-01-06T08:00:00Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20310531T215959Z',
    })
    const running = entry({
      startsAt: new Date('2031-01-06T06:00:00Z'),
      endsAt: new Date('2031-01-06T08:00:00Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    })

    expect(inCalendarFeed(ended, now)).toBe(false)
    expect(inCalendarFeed(running, now)).toBe(true)
  })
})
