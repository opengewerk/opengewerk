import { describe, expect, it } from 'vitest'

import { pvOrientations } from './market-register.js'

describe('the orientations of a solar unit', () => {
  it('puts the strings facing the same way together, the most power first', () => {
    expect(
      pvOrientations([
        { azimuthDeg: 270, tiltDeg: 30, modules: 12, ratedPowerW: 4800 },
        { azimuthDeg: 180, tiltDeg: 30, modules: 8, ratedPowerW: 3200 },
        { azimuthDeg: 180, tiltDeg: 30, modules: 8, ratedPowerW: 3200 },
      ]),
    ).toEqual([
      { azimuthDeg: 180, tiltDeg: 30, modules: 16, ratedPowerW: 6400 },
      { azimuthDeg: 270, tiltDeg: 30, modules: 12, ratedPowerW: 4800 },
    ])
  })

  it('tells two tilts on one side apart', () => {
    expect(
      pvOrientations([
        { azimuthDeg: 180, tiltDeg: 30, modules: 10, ratedPowerW: 4000 },
        { azimuthDeg: 180, tiltDeg: 15, modules: 12, ratedPowerW: 4800 },
      ]).map((orientation) => orientation.tiltDeg),
    ).toEqual([15, 30])
  })

  it('counts modules where a string names no power, rather than a sum short of it', () => {
    expect(
      pvOrientations([
        { azimuthDeg: 90, tiltDeg: 20, modules: 6, ratedPowerW: 2400 },
        { azimuthDeg: 270, tiltDeg: 20, modules: 10, ratedPowerW: null },
      ]).map((orientation) => [orientation.azimuthDeg, orientation.ratedPowerW]),
    ).toEqual([
      [270, null],
      [90, 2400],
    ])
  })

  it('leaves out a string that faces nowhere it names', () => {
    expect(
      pvOrientations([{ azimuthDeg: null, tiltDeg: 30, modules: 12, ratedPowerW: 4800 }]),
    ).toEqual([])
  })
})
