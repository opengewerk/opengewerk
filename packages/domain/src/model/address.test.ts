import { describe, expect, it } from 'vitest'

import { countryChoices, countryProblem } from './address.js'

describe('the country of an address', () => {
  it('is a code of two capital letters', () => {
    expect(countryProblem('DE')).toBeNull()
    expect(countryProblem('AT')).toBeNull()
  })

  it('is refused in any other shape, with the reason', () => {
    for (const wrong of ['de', 'DEU', 'D', '', null, 49]) {
      expect(countryProblem(wrong)).toBe(
        'Das Land steht als Ländercode aus zwei Großbuchstaben da, etwa DE.',
      )
    }
  })

  it('is chosen from a list that starts with Germany and holds each country once', () => {
    expect(countryChoices[0]).toBe('DE')
    expect(new Set(countryChoices).size).toBe(countryChoices.length)
    expect(countryChoices.every((code) => countryProblem(code) === null)).toBe(true)
  })
})
