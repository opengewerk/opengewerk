import type { IsoDate } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import {
  type AppointmentRow,
  myDays,
  type PersonRow,
  placeOnBoard,
  shifted,
  whenOnDay,
} from './appointments.js'

/**
 * The appointments as both entries read them (#290): where they stand on the
 * board and in which lane, what one person's list holds day by day, and that
 * a move keeps the clock time.
 */

const day = (text: string) => text as IsoDate

function appointment(
  id: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<AppointmentRow> = {},
): AppointmentRow {
  return {
    id,
    jobId: `job-${id}`,
    startsAt,
    endsAt,
    note: null,
    rrule: null,
    exdates: [],
    revision: 1,
    version: 1,
    ...extra,
  }
}

function person(
  appointmentId: string,
  userId: string,
  confirmedRevision: number | null = null,
): PersonRow {
  return {
    id: `${appointmentId}-${userId}`,
    appointmentId,
    userId,
    confirmedRevision,
    confirmedAt: null,
  }
}

describe('placeOnBoard', () => {
  const week = { from: day('2026-11-02'), to: day('2026-11-08') }

  it('puts two times of a day one above the other and a later one back in the first lane', () => {
    const appointments = [
      appointment('baustrom', '2026-11-02T06:00:00Z', '2026-11-02T07:00:00Z', {
        rrule: 'FREQ=WEEKLY',
      }),
      appointment('treppe', '2026-11-02T08:00:00Z', '2026-11-02T14:00:00Z'),
      appointment('praxis', '2026-11-03T06:30:00Z', '2026-11-05T15:30:00Z'),
    ]
    const rows = placeOnBoard(
      appointments,
      [person('baustrom', 'lena', 1), person('treppe', 'lena', 1), person('praxis', 'lena')],
      week.from,
      week.to,
      [],
    )
    const lena = rows.get('lena')

    expect(lena?.lanes).toBe(2)
    expect(
      lena?.placed.map((placed) => [placed.appointment.id, placed.first, placed.last, placed.lane]),
    ).toEqual([
      ['baustrom', 0, 0, 0],
      ['treppe', 0, 0, 1],
      ['praxis', 1, 3, 0],
    ])
    expect(lena?.placed.map((placed) => placed.confirmed)).toEqual([true, true, false])
  })

  it('counts a confirmation only for the version the appointment is in', () => {
    const moved = appointment('pv', '2026-11-06T06:00:00Z', '2026-11-06T15:00:00Z', { revision: 2 })
    const rows = placeOnBoard([moved], [person('pv', 'anna', 1)], week.from, week.to, [])

    expect(rows.get('anna')?.placed[0]?.confirmed).toBe(false)
  })

  it('cuts a time at the edges of what is shown and warns of one in an absence', () => {
    const long = appointment('pv', '2026-10-29T06:00:00Z', '2026-11-03T15:00:00Z')
    const rows = placeOnBoard([long], [person('pv', 'max')], week.from, week.to, [
      {
        userId: 'max',
        kind: 'absent',
        firstDay: day('2026-11-03'),
        lastDay: day('2026-11-06'),
        startsAtNoon: false,
        endsAtNoon: false,
      },
    ])
    const placed = rows.get('max')?.placed[0]

    expect([
      placed?.first,
      placed?.last,
      placed?.cutBefore,
      placed?.cutAfter,
      placed?.away,
    ]).toEqual([0, 1, true, false, true])
  })
})

describe('myDays', () => {
  it('lists the own appointments day by day, a time over several days on each, and nobody else’s', () => {
    const appointments = [
      appointment('neubau', '2026-11-09T06:30:00Z', '2026-11-11T15:00:00Z'),
      appointment('wallbox', '2026-11-05T06:20:00Z', '2026-11-05T11:00:00Z'),
      appointment('fremd', '2026-11-05T05:00:00Z', '2026-11-05T06:00:00Z'),
    ]
    const days = myDays(
      appointments,
      [person('neubau', 'anna', 1), person('wallbox', 'anna'), person('fremd', 'jonas')],
      'anna',
      day('2026-11-05'),
      day('2026-11-10'),
    )

    expect(days.map((each) => [each.on, each.appointment.id, each.part])).toEqual([
      ['2026-11-05', 'wallbox', null],
      ['2026-11-09', 'neubau', { day: 1, of: 3 }],
      ['2026-11-10', 'neubau', { day: 2, of: 3 }],
    ])
    expect(days.map(whenOnDay)).toEqual([
      { line: '07:20 bis 12:00', until: null },
      { line: 'Tag 1 von 3, ab 07:30', until: 'Bis Mittwoch, 11.11., 16:00' },
      { line: 'Tag 2 von 3, ganztags', until: 'Bis Mittwoch, 11.11., 16:00' },
    ])
  })
})

describe('shifted', () => {
  it('moves by whole days at the same clock time, also over the change of time', () => {
    // Friday 23.10.2026 at seven in summer time, moved to the Monday after the change.
    expect(
      shifted({ startsAt: '2026-10-23T05:00:00Z', endsAt: '2026-10-23T14:00:00Z' }, 3, 3),
    ).toEqual({
      startsAt: '2026-10-26T06:00:00.000Z',
      endsAt: '2026-10-26T15:00:00.000Z',
    })
    // Lengthened by two days at its end only.
    expect(
      shifted({ startsAt: '2026-11-02T06:00:00Z', endsAt: '2026-11-02T15:00:00Z' }, 0, 2),
    ).toEqual({
      startsAt: '2026-11-02T06:00:00.000Z',
      endsAt: '2026-11-04T15:00:00.000Z',
    })
  })
})
