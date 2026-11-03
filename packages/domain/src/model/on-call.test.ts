import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import { tenantParameterProblem } from '../rules/parameter.js'
import { workingTimeWarnings } from '../rules/working-time.js'
import {
  emergencyKindAt,
  emergencySurchargeLine,
  onCallShiftProblem,
  shiftCovers,
} from './on-call.js'

/** Wednesday 28.10.2026 at a time of day in Germany (CET, UTC+1). */
const wednesday = (clock: string) => new Date(`2026-10-28T${clock}:00+01:00`)

describe('the kind of an emergency call (#293)', () => {
  it('is the night between its hours, also over midnight', () => {
    expect(emergencyKindAt(wednesday('02:14'), new Set())).toBe('night')
    expect(emergencyKindAt(wednesday('21:30'), new Set())).toBe('night')
    expect(emergencyKindAt(wednesday('10:00'), new Set())).toBeNull()
    expect(emergencyKindAt(wednesday('06:00'), new Set())).toBeNull()
    expect(emergencyKindAt(wednesday('19:59'), new Set())).toBeNull()
  })

  it('follows the night the business sets', () => {
    expect(
      emergencyKindAt(wednesday('19:30'), new Set(), { fromMinute: 19 * 60, untilMinute: 7 * 60 }),
    ).toBe('night')
    expect(
      emergencyKindAt(wednesday('06:30'), new Set(), { fromMinute: 19 * 60, untilMinute: 7 * 60 }),
    ).toBe('night')
  })

  it('is the weekend on Saturday and Sunday, at any hour', () => {
    expect(emergencyKindAt(new Date('2026-10-31T11:00:00+01:00'), new Set())).toBe('weekend')
    expect(emergencyKindAt(new Date('2026-11-01T03:00:00+01:00'), new Set())).toBe('weekend')
  })

  it('is a public holiday of the business before the weekend and the night', () => {
    const holidays = new Set(['2026-10-28', '2026-11-01'])

    expect(emergencyKindAt(wednesday('02:14'), holidays)).toBe('holiday')
    expect(emergencyKindAt(new Date('2026-11-01T03:00:00+01:00'), holidays)).toBe('holiday')
  })

  it('takes the day in Germany, not in UTC', () => {
    // 23:30 UTC on Friday is 00:30 on Saturday in Germany.
    expect(emergencyKindAt(new Date('2026-10-30T23:30:00Z'), new Set())).toBe('weekend')
  })
})

describe('the surcharge line', () => {
  it('is one flat rate at the flat amount', () => {
    expect(emergencySurchargeLine('night', { flatCents: 4500, basisPoints: 0 }, 6800)).toEqual({
      designation: 'Notdienstzuschlag Nacht',
      description: null,
      quantityMilli: 1000,
      unit: 'flat_rate',
      unitPriceCents: 4500,
      netCents: 4500,
    })
  })

  it('comes as a percentage on the working time, rounded to the cent', () => {
    expect(
      emergencySurchargeLine('weekend', { flatCents: 0, basisPoints: 5000 }, 10_201),
    ).toMatchObject({
      designation: 'Notdienstzuschlag Wochenende',
      description: '50 % auf die Arbeitszeit',
      unitPriceCents: 5101,
      netCents: 5101,
    })
  })

  it('is none where the business set nothing for the kind', () => {
    expect(emergencySurchargeLine('holiday', { flatCents: 0, basisPoints: 0 }, 6800)).toBeNull()
  })
})

describe('a time of the on-call plan', () => {
  it('has an end after its beginning, at most four weeks long, and a short note', () => {
    expect(
      onCallShiftProblem('2026-11-02T16:00:00Z', '2026-11-09T06:00:00Z', 'Woche 45'),
    ).toBeNull()
    expect(onCallShiftProblem('2026-11-09T06:00:00Z', '2026-11-02T16:00:00Z', null)).toContain(
      'nach ihrem Beginn',
    )
    expect(onCallShiftProblem('2026-11-01T00:00:00Z', '2026-12-15T00:00:00Z', null)).toContain(
      'höchstens 28 Tage',
    )
    expect(onCallShiftProblem('x', '2026-11-02T16:00:00Z', null)).toContain('Beginn und Ende')
    expect(
      onCallShiftProblem('2026-11-02T16:00:00Z', '2026-11-09T06:00:00Z', 'x'.repeat(201)),
    ).toContain('200')
  })

  it('covers a moment from its beginning up to but not including its end', () => {
    const shift = { startsAt: '2026-11-02T16:00:00Z', endsAt: '2026-11-09T06:00:00Z' }

    expect(shiftCovers(shift, new Date('2026-11-02T16:00:00Z'))).toBe(true)
    expect(shiftCovers(shift, new Date('2026-11-09T06:00:00Z'))).toBe(false)
    expect(shiftCovers(shift, new Date('2026-11-02T15:59:00Z'))).toBe(false)
  })
})

describe('the settings of the surcharges', () => {
  it('are whole numbers, hours of the day and percentages up to 1.000 %', () => {
    expect(tenantParameterProblem('emergency.night_flat_cents', 4500)).toBeNull()
    expect(tenantParameterProblem('emergency.night_flat_cents', -1)).toContain('nicht negativ')
    expect(tenantParameterProblem('emergency.night_from_minute', 1440)).toContain('23:59')
    expect(tenantParameterProblem('emergency.weekend_basis_points', 100_001)).toContain('1.000 %')
  })
})

describe('a call taken on call and the rest period (#293)', () => {
  it('breaks the rest period, and the warning of the next day says so', () => {
    const work = (startedAt: string, endedAt: string) => ({ kind: 'work', startedAt, endedAt })
    const entries = [
      work('2026-10-27T07:00:00+01:00', '2026-10-27T16:00:00+01:00'),
      // The call at night, from 02:14 to 03:30.
      work('2026-10-28T02:14:00+01:00', '2026-10-28T03:30:00+01:00'),
      work('2026-10-28T07:00:00+01:00', '2026-10-28T16:00:00+01:00'),
    ]

    expect(
      workingTimeWarnings(entries, '2026-10-28', shippedRules).map((warning) => warning.kind),
    ).toContain('rest')
  })
})
