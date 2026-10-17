import { describe, expect, it } from 'vitest'

import { staffStateOf, staffStateWords } from './staff-words.js'

/**
 * The column "Zustand" of "Zugänge" with the last day of an access (for
 * opengewerk-haustechnik#339): an access with an end says until when, and
 * after its last day it has run out, the day itself still counting.
 */

const person = {
  roles: ['member'],
  blockedAt: null,
  lastSignInAt: null,
  twoFactorEnabled: false,
  hasPasskey: false,
}
const roles = [{ key: 'member', secondFactor: false }]
const moment = (value: Date | string) => String(value)
const today = '2026-10-17'

describe('the state of an access', () => {
  it('names the last day of an access with an end, and has run out after it', () => {
    expect(staffStateWords(person, roles, moment, today)).toBe('Aktiv')
    expect(staffStateWords({ ...person, lastDay: '2026-11-30' }, roles, moment, today)).toBe(
      'Aktiv bis 30.11.2026',
    )
    expect(
      staffStateWords(
        { ...person, lastDay: '2026-11-30', twoFactorEnabled: true },
        roles,
        moment,
        today,
      ),
    ).toBe('Aktiv, zweiter Faktor eingerichtet, bis 30.11.2026')
    expect(staffStateWords({ ...person, lastDay: today }, roles, moment, today)).toBe(
      'Aktiv bis 17.10.2026',
    )
    expect(staffStateOf({ ...person, lastDay: '2026-10-16' }, roles, today)).toBe('ended')
    expect(staffStateWords({ ...person, lastDay: '2026-10-16' }, roles, moment, today)).toBe(
      'Abgelaufen, letzter Tag 16.10.2026',
    )
  })
})
