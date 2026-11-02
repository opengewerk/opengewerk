import { describe, expect, it } from 'vitest'

import { largestRating, ratingProblem } from './installation.js'

describe('the capacity and the power an installation names (#307)', () => {
  it('lets a battery name both and a wallbox its power', () => {
    expect(ratingProblem('usableCapacityWh', 'battery', 7680)).toBeNull()
    expect(ratingProblem('ratedPowerW', 'battery', 5000)).toBeNull()
    expect(ratingProblem('ratedPowerW', 'wallbox', 11_000)).toBeNull()
    expect(ratingProblem('ratedPowerW', 'wallbox', largestRating)).toBeNull()
  })

  it('lets every kind leave them empty', () => {
    expect(ratingProblem('usableCapacityWh', 'meter', null)).toBeNull()
    expect(ratingProblem('ratedPowerW', 'heating', undefined)).toBeNull()
  })

  it('refuses them at a kind that has none', () => {
    expect(ratingProblem('usableCapacityWh', 'wallbox', 7680)).toBe(
      'Eine nutzbare Kapazität nennt nur ein Speicher.',
    )
    expect(ratingProblem('ratedPowerW', 'pv_system', 10_000)).toBe(
      'Eine Bemessungsleistung nennen nur ein Speicher und eine Wallbox.',
    )
  })

  it('refuses what is no whole number above none, and more than the largest', () => {
    const power = 'Die Bemessungsleistung ist größer als null und höchstens 100.000 kW.'

    expect(ratingProblem('ratedPowerW', 'wallbox', 0)).toBe(power)
    expect(ratingProblem('ratedPowerW', 'wallbox', 11.5)).toBe(power)
    expect(ratingProblem('ratedPowerW', 'wallbox', '11000')).toBe(power)
    expect(ratingProblem('ratedPowerW', 'wallbox', largestRating + 1)).toBe(power)
    expect(ratingProblem('usableCapacityWh', 'battery', -1)).toBe(
      'Die nutzbare Kapazität ist größer als null und höchstens 100.000 kWh.',
    )
  })
})
