import { describe, expect, it } from 'vitest'

import { ruleSet } from '../rules/rule.js'
import { circuitList, isBlockCircuit, loopImpedance, residualTripCurrent } from './circuits.js'
import type { MeasurementField } from './definition.js'
import { formEngine } from './engine.js'

/**
 * The circuits a form is measured on, as any application binds them: the
 * calculators against rules with the keys they read, and once through an
 * engine whose terms call them by other names.
 */

const rules = ruleSet([
  {
    key: 'elektro.loop.nominal_voltage',
    validFrom: '2017-06-01',
    validUntil: null,
    unit: 'volts',
    value: 230,
    source: 'DIN VDE 0100-410:2018-10, 411.4.4',
  },
  {
    key: 'elektro.loop.factor_b',
    validFrom: '2017-06-01',
    validUntil: null,
    unit: 'factor',
    value: 5,
    source: 'DIN EN 60898-1, Typ B',
  },
  {
    key: 'elektro.rcd.trip_current_maximum',
    validFrom: '2017-06-01',
    validUntil: null,
    unit: 'basis_points',
    value: 10_000,
    source: 'DIN EN 61008-1',
  },
])

const on = '2026-10-19'

const field: MeasurementField = {
  kind: 'measurement',
  key: 'loop',
  label: 'Schleifenimpedanz',
  unit: 'ohm',
  decimals: 2,
  limit: { kind: 'loop_impedance' },
}

/** F3, a breaker B16 behind a 30 mA device. */
const b16 = {
  designation: 'F3',
  consumer: 'Steckdosen Bad',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
} as const

describe('the limit of the loop impedance', () => {
  it('is worked out from the breaker: 230 V over five times 16 A, rounded down', () => {
    expect(loopImpedance(field, { rules, on, item: b16 })).toEqual({
      limitMilli: 2_875,
      atLeast: false,
      source: 'DIN VDE 0100-410:2018-10, 411.4.4; DIN EN 60898-1, Typ B',
    })
    // Behind a B6 it is 7,666... Ω, and the limit is never looser than the rule.
    expect(
      loopImpedance(field, { rules, on, item: { ...b16, ratedCurrentMilli: 6_000 } }),
    ).toMatchObject({ limitMilli: 7_666 })
  })

  it('is none without a factor for the device, without a rated current or before the rules apply', () => {
    const none = {
      none:
        'Der Grenzwert der Schleifenimpedanz lässt sich nur für einen Leitungsschutzschalter ' +
        'B, C oder D mit Nennstrom berechnen.',
    }

    // A fuse has no factor at all, and C has none among these rules.
    expect(loopImpedance(field, { rules, on, item: { ...b16, tripCharacteristic: 'gg' } })).toEqual(
      none,
    )
    expect(loopImpedance(field, { rules, on, item: { ...b16, tripCharacteristic: 'c' } })).toEqual(
      none,
    )
    expect(loopImpedance(field, { rules, on, item: { ...b16, tripCharacteristic: null } })).toEqual(
      none,
    )
    expect(loopImpedance(field, { rules, on, item: { ...b16, ratedCurrentMilli: null } })).toEqual(
      none,
    )
    expect(loopImpedance(field, { rules, on, item: null })).toEqual(none)
    expect(loopImpedance(field, { rules, on: '2016-01-01', item: b16 })).toEqual(none)
  })
})

describe('the limit of the tripping current', () => {
  it('is the share of the rated residual current the rule gives, in thousandths of a milliampere', () => {
    expect(residualTripCurrent(field, { rules, on, item: b16 })).toEqual({
      limitMilli: 30_000,
      atLeast: false,
      source: 'DIN EN 61008-1',
    })

    const half = ruleSet([
      {
        key: 'elektro.rcd.trip_current_maximum',
        validFrom: '2017-06-01',
        validUntil: null,
        unit: 'basis_points',
        value: 5_000,
        source: 'halber Bemessungsdifferenzstrom',
      },
    ])

    expect(residualTripCurrent(field, { rules: half, on, item: b16 })).toMatchObject({
      limitMilli: 15_000,
    })
  })

  it('is none without a rated residual current or without the rule', () => {
    const none = { none: 'Ohne Bemessungsdifferenzstrom am Stromkreis gibt es keinen Grenzwert.' }

    expect(
      residualTripCurrent(field, { rules, on, item: { ...b16, ratedResidualCurrentMilli: null } }),
    ).toEqual(none)
    expect(residualTripCurrent(field, { rules, on, item: null })).toEqual(none)
    expect(residualTripCurrent(field, { rules, on: '2016-01-01', item: b16 })).toEqual(none)
  })
})

describe('a circuit as a block keeps it', () => {
  it('is taken with its designation, consumer, device and ratings, each of them maybe empty', () => {
    expect(isBlockCircuit(b16)).toBe(true)
    expect(
      isBlockCircuit({
        designation: 'F1',
        consumer: null,
        tripCharacteristic: null,
        ratedCurrentMilli: null,
        ratedResidualCurrentMilli: null,
      }),
    ).toBe(true)
    expect(circuitList.itemIsValid(b16)).toBe(true)
  })

  it('is refused for anything that is not one', () => {
    expect(isBlockCircuit(null)).toBe(false)
    expect(isBlockCircuit('F3')).toBe(false)
    expect(isBlockCircuit({ ...b16, designation: undefined })).toBe(false)
    expect(isBlockCircuit({ ...b16, designation: 'F'.repeat(201) })).toBe(false)
    expect(isBlockCircuit({ ...b16, consumer: 3 })).toBe(false)
    expect(isBlockCircuit({ ...b16, consumer: 'x'.repeat(201) })).toBe(false)
    expect(isBlockCircuit({ ...b16, tripCharacteristic: 'q' })).toBe(false)
    expect(isBlockCircuit({ ...b16, ratedCurrentMilli: -1 })).toBe(false)
    expect(isBlockCircuit({ ...b16, ratedCurrentMilli: 1.5 })).toBe(false)
    expect(isBlockCircuit({ ...b16, ratedResidualCurrentMilli: '30' })).toBe(false)
    expect(circuitList.itemIsValid({ ...b16, tripCharacteristic: 'q' })).toBe(false)
  })

  it('is said to be missing or twice in the words of a circuit', () => {
    expect(circuitList.sentences.blockWithoutItem('Messungen')).toBe(
      'Messungen: jeder Block gehört zu einem Stromkreis.',
    )
    expect(circuitList.sentences.itemTwice('Messungen')).toBe(
      'Messungen: ein Stromkreis hat zwei Blöcke.',
    )
  })
})

describe('an application that binds them', () => {
  interface WiringTerms {
    readonly unit: 'ohm' | 'milliampere'
    readonly list: 'wiring'
    readonly limit: 'zs' | 'trip'
    readonly kind: 'measurement'
  }

  const engine = formEngine<WiringTerms>({
    units: { ohm: { sign: 'Ω' }, milliampere: { sign: 'mA' } },
    lists: { wiring: circuitList },
    limits: { zs: loopImpedance, trip: residualTripCurrent },
    kinds: ['measurement'],
  })

  it('names them as its terms do, and judges with them', () => {
    const zs: MeasurementField<WiringTerms> = {
      kind: 'measurement',
      key: 'zs',
      label: 'Zs',
      unit: 'ohm',
      decimals: 2,
      limit: { kind: 'zs' },
    }

    expect(engine.limitVerdict(zs, 2_880, { rules, on, item: b16 })).toMatchObject({
      within: false,
      limitMilli: 2_875,
      text: 'Außerhalb des Grenzwerts, höchstens 2,87 Ω.',
    })
  })
})
