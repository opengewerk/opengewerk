import { describe, expect, it } from 'vitest'

import { belongsToPvSystemKind, inverterLinkProblem, pvSystemLinkProblem } from './pv-system.js'

describe('what belongs to a PV system', () => {
  it('is a battery, a meter or a wallbox, and nothing else', () => {
    expect(['battery', 'meter', 'wallbox'].map(belongsToPvSystemKind)).toEqual([true, true, true])
    expect(
      ['pv_system', 'meter_cabinet', 'heating', 'other', 'x'].map(belongsToPvSystemKind),
    ).toEqual([false, false, false, false, false])
  })
})

describe('the link of an installation to a PV system', () => {
  it('is for a battery, a meter or a wallbox only', () => {
    expect(pvSystemLinkProblem('battery', 'pv-1')).toBeNull()
    expect(pvSystemLinkProblem('wallbox', 'pv-1')).toBeNull()
    expect(pvSystemLinkProblem('heating', 'pv-1')).toBe(
      'Zu einer PV-Anlage gehören nur Speicher, Zähler und Wallbox.',
    )
    expect(pvSystemLinkProblem('heating', null)).toBeNull()
  })

  it('names an inverter only together with its system', () => {
    expect(inverterLinkProblem('pv-1', 'inverter-1')).toBeNull()
    expect(inverterLinkProblem(null, null)).toBeNull()
    expect(inverterLinkProblem(null, 'inverter-1')).toBe(
      'An einem Wechselrichter hängt nur, was zu seiner PV-Anlage gehört.',
    )
  })
})
