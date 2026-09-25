import { describe, expect, it } from 'vitest'

import {
  cableLengthText,
  cableSizeText,
  cableText,
  characteristicsFor,
  type CircuitFigures,
  circuitProblems,
  inStructureOrder,
  milliText,
  overcurrentDevices,
  overcurrentText,
  rcdText,
  tripCharacteristics,
} from './electrical.js'

const nothingKnown: CircuitFigures = {
  overcurrentDevice: null,
  tripCharacteristic: null,
  ratedCurrentMilli: null,
  rcdType: null,
  ratedResidualCurrentMilli: null,
  cableType: null,
  cableCores: null,
  cableCrossSectionMilli: null,
  cableLengthMilli: null,
  cableInstallationMethod: null,
}

/** A socket circuit in a kitchen, the way it stands in half the boards of the country. */
const kitchen: CircuitFigures = {
  overcurrentDevice: 'circuit_breaker',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  rcdType: 'a',
  ratedResidualCurrentMilli: 30,
  cableType: 'NYM-J',
  cableCores: 3,
  cableCrossSectionMilli: 2_500,
  cableLengthMilli: 18_500,
  cableInstallationMethod: 'c',
}

describe('the figures of a circuit', () => {
  it('may all be missing, a circuit is a designation first', () => {
    expect(circuitProblems(nothingKnown)).toEqual({})
    expect(circuitProblems({})).toEqual({})
  })

  it('pass as a complete kitchen circuit', () => {
    expect(circuitProblems(kitchen)).toEqual({})
  })

  it('refuse a value no list knows, one sentence per field', () => {
    expect(
      circuitProblems({
        overcurrentDevice: 'fuse_x',
        tripCharacteristic: 'q',
        rcdType: 'typ a',
        cableInstallationMethod: 'h',
      }),
    ).toEqual({
      overcurrentDevice: 'Diese Schutzeinrichtung kennt OpenGewerk nicht.',
      tripCharacteristic: 'Diese Charakteristik kennt OpenGewerk nicht.',
      rcdType: 'Diesen RCD-Typ kennt OpenGewerk nicht.',
      cableInstallationMethod: 'Diese Verlegeart kennt OpenGewerk nicht.',
    })
  })

  it('refuse a figure that is zero, negative, a fraction, text or far too large', () => {
    for (const wrong of [0, -16_000, 16_000.5, '16000', 6_300_001]) {
      expect(circuitProblems({ ratedCurrentMilli: wrong })).toEqual({
        ratedCurrentMilli: 'Der Nennstrom ist größer als 0 und höchstens 6300 A.',
      })
    }

    expect(circuitProblems({ ratedCurrentMilli: 6_300_000 })).toEqual({})
    expect(circuitProblems({ ratedResidualCurrentMilli: 30_001 })).toHaveProperty(
      'ratedResidualCurrentMilli',
    )
    expect(circuitProblems({ cableCores: 101 })).toHaveProperty('cableCores')
    expect(circuitProblems({ cableCrossSectionMilli: 1_000_001 })).toHaveProperty(
      'cableCrossSectionMilli',
    )
    expect(circuitProblems({ cableLengthMilli: 0 })).toHaveProperty('cableLengthMilli')
  })

  it('refuse a curve on a fuse and a category on a breaker', () => {
    const sentence =
      'B, C, D, K und Z sind Auslösekennlinien von Schaltern, gG und aM Betriebsklassen von ' +
      'Schmelzsicherungen. Diese passt nicht zur gewählten Schutzeinrichtung.'

    expect(circuitProblems({ overcurrentDevice: 'fuse_d0', tripCharacteristic: 'b' })).toEqual({
      tripCharacteristic: sentence,
    })
    expect(circuitProblems({ overcurrentDevice: 'rcbo', tripCharacteristic: 'gg' })).toEqual({
      tripCharacteristic: sentence,
    })
    expect(circuitProblems({ overcurrentDevice: 'fuse_nh', tripCharacteristic: 'gg' })).toEqual({})
    // A curve alone says nothing wrong yet: the device may come later.
    expect(circuitProblems({ tripCharacteristic: 'c' })).toEqual({})
  })

  it('offer the curves with a breaker and the categories with a fuse', () => {
    expect(characteristicsFor('circuit_breaker')).toEqual(['b', 'c', 'd', 'k', 'z'])
    expect(characteristicsFor('rcbo')).toEqual(['b', 'c', 'd', 'k', 'z'])
    expect(characteristicsFor('fuse_d')).toEqual(['gg', 'am'])
    expect(characteristicsFor(null)).toEqual(tripCharacteristics)

    // Every device has somewhere to go, and every characteristic belongs to one.
    const offered = new Set(overcurrentDevices.flatMap((device) => characteristicsFor(device)))
    expect([...offered].sort()).toEqual([...tripCharacteristics].sort())
  })
})

describe('a circuit on the chart and on the screen', () => {
  it('reads the way it is written on a board', () => {
    expect(overcurrentText(kitchen)).toBe('LS B 16 A')
    expect(rcdText(kitchen)).toBe('Typ A 30 mA')
    expect(cableText(kitchen)).toBe('NYM-J 3 × 2,5 mm²')
    expect(cableSizeText(kitchen)).toBe('3 × 2,5 mm²')
    expect(cableLengthText(kitchen)).toBe('18,5 m')
  })

  it('says nothing rather than a half sentence when nothing is known', () => {
    expect(overcurrentText(nothingKnown)).toBeNull()
    expect(rcdText(nothingKnown)).toBeNull()
    expect(cableText(nothingKnown)).toBeNull()
    expect(cableSizeText(nothingKnown)).toBeNull()
    expect(cableLengthText(nothingKnown)).toBeNull()
  })

  it('leaves out what is missing and keeps the rest in its place', () => {
    expect(
      overcurrentText({ ...nothingKnown, overcurrentDevice: 'fuse_d0', ratedCurrentMilli: 500 }),
    ).toBe('D0 0,5 A')
    expect(rcdText({ ...nothingKnown, ratedResidualCurrentMilli: 300 })).toBe('300 mA')
    // The cores without a cross section would read "3 ×" and say nothing.
    expect(cableText({ ...nothingKnown, cableType: 'NYY-J', cableCores: 5 })).toBe('NYY-J')
    expect(cableText({ ...nothingKnown, cableCrossSectionMilli: 1_500 })).toBe('1,5 mm²')
    expect(cableText({ ...nothingKnown, cableType: '  ' })).toBeNull()
    expect(cableSizeText({ ...nothingKnown, cableCores: 5 })).toBeNull()
    expect(cableSizeText({ ...nothingKnown, cableCrossSectionMilli: 1_500 })).toBe('1,5 mm²')
  })

  it('writes thousandths the way they are read', () => {
    expect(milliText(16_000)).toBe('16')
    expect(milliText(1_500)).toBe('1,5')
    expect(milliText(750)).toBe('0,75')
    expect(milliText(240_000)).toBe('240')
  })
})

describe('the order of a structure', () => {
  const part = (id: string, designation: string, position = 0) => ({ id, designation, position })

  it('counts the way a person does, F2 before F10', () => {
    const circuits = [part('1', 'F10'), part('2', 'F2'), part('3', 'F1'), part('4', 'F11')]

    expect([...circuits].sort(inStructureOrder).map((circuit) => circuit.designation)).toEqual([
      'F1',
      'F2',
      'F10',
      'F11',
    ])
  })

  it('puts the place somebody gave a part before its name', () => {
    const circuits = [part('1', 'F1', 2), part('2', 'F2', 1)]

    expect([...circuits].sort(inStructureOrder).map((circuit) => circuit.designation)).toEqual([
      'F2',
      'F1',
    ])
  })

  it('comes out the same way on every device for two parts with the same place and name', () => {
    const twins = [part('b', 'F1'), part('a', 'F1')]

    expect([...twins].sort(inStructureOrder).map((circuit) => circuit.id)).toEqual(['a', 'b'])
  })
})
