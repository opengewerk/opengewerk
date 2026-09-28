import { describe, expect, it } from 'vitest'

import {
  azimuthName,
  azimuthText,
  belongsToPvSystemKind,
  inModuleOrder,
  inverterLinkProblem,
  inverterPowerText,
  inverterProblems,
  modulePowerText,
  peakPower,
  peakPowerText,
  pvLimits,
  pvModuleProblems,
  pvStringProblems,
  pvSystemLinkProblem,
} from './photovoltaic.js'

describe('the figures of an inverter', () => {
  it('take a rated power in watts and the MPP inputs, or nothing', () => {
    expect(inverterProblems({ ratedPowerW: 10_000, mppInputs: 2 })).toEqual({})
    expect(inverterProblems({ ratedPowerW: null, mppInputs: undefined })).toEqual({})
  })

  it('refuse what no inverter has, in words for the field', () => {
    const problems = inverterProblems({ ratedPowerW: 0, mppInputs: 25 })

    expect(Object.keys(problems)).toEqual(['ratedPowerW', 'mppInputs'])
    expect(inverterProblems({ ratedPowerW: pvLimits.inverterRatedPowerW + 1 })).toHaveProperty(
      'ratedPowerW',
    )
    expect(inverterProblems({ mppInputs: 1.5 })).toHaveProperty('mppInputs')
  })

  it('take a number and not the text a device might send', () => {
    expect(inverterProblems({ ratedPowerW: '10000' })).toHaveProperty('ratedPowerW')
  })
})

describe('the figures of a string', () => {
  it('take an input, where it faces and how steep it is', () => {
    expect(pvStringProblems({ mppInput: 2, azimuthDeg: 270, tiltDeg: 30 })).toEqual({})
    expect(pvStringProblems({ azimuthDeg: 0, tiltDeg: 0 })).toEqual({})
    expect(pvStringProblems({ azimuthDeg: 359, tiltDeg: 90 })).toEqual({})
  })

  it('refuse a direction past the circle and a tilt past upright', () => {
    expect(Object.keys(pvStringProblems({ mppInput: 0, azimuthDeg: 360, tiltDeg: 91 }))).toEqual([
      'mppInput',
      'azimuthDeg',
      'tiltDeg',
    ])
    expect(pvStringProblems({ azimuthDeg: -1 })).toHaveProperty('azimuthDeg')
  })
})

describe('the figures of a module', () => {
  it('take its peak power in watts', () => {
    expect(pvModuleProblems({ ratedPowerW: 400 })).toEqual({})
    expect(pvModuleProblems({ ratedPowerW: pvLimits.moduleRatedPowerW + 1 })).toHaveProperty(
      'ratedPowerW',
    )
  })
})

describe('what a person reads', () => {
  it('writes the power of an inverter and of modules as the plates do', () => {
    expect(inverterPowerText(10_000)).toBe('10,0 kW')
    expect(inverterPowerText(4_600)).toBe('4,6 kW')
    expect(peakPowerText(4_800)).toBe('4,80 kWp')
    expect(peakPowerText(9_600)).toBe('9,60 kWp')
    expect(modulePowerText(400)).toBe('400 Wp')
  })

  it('names the direction a string faces, to the nearest of eight', () => {
    expect(azimuthText(180)).toBe('Süd, 180°')
    expect(azimuthText(270)).toBe('West, 270°')
    expect(azimuthText(0)).toBe('Nord, 0°')
    expect(azimuthName(200)).toBe('Süd')
    expect(azimuthName(225)).toBe('Südwest')
    expect(azimuthName(350)).toBe('Nord')
    expect(azimuthName(100)).toBe('Ost')
  })
})

describe('the peak power of modules together', () => {
  it('adds up what is known and counts what is not', () => {
    expect(peakPower([{ ratedPowerW: 400 }, { ratedPowerW: 400 }, { ratedPowerW: null }])).toEqual({
      watts: 800,
      unknown: 1,
    })
    expect(peakPower([])).toEqual({ watts: 0, unknown: 0 })
  })
})

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

describe('the order of modules on a string', () => {
  it('is where somebody put them, and the id after that', () => {
    const modules = [
      { id: 'c', position: 1 },
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
    ]

    expect([...modules].sort(inModuleOrder).map((module) => module.id)).toEqual(['b', 'a', 'c'])
  })
})
