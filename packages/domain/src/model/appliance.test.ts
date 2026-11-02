import { ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { FormDefinition, MeasurementField } from '../forms/definition.js'
import { limitIsMinimum, limitVerdict } from '../forms/limits.js'
import { formSubjectProblem } from '../forms/record.js'
import {
  applianceLabel,
  applianceProblems,
  applianceSubject,
  cordLengthText,
  isApplianceFacts,
} from './appliance.js'

describe('an appliance of the register (#303)', () => {
  it('needs a designation, and a lead longer than nothing and at most a kilometre', () => {
    expect(applianceProblems({ designation: 'Kaffeemaschine', cordLengthMilli: 1200 })).toEqual({})
    expect(applianceProblems({ designation: '  ' })).toHaveProperty('designation')
    expect(applianceProblems({ cordLengthMilli: 0 })).toHaveProperty('cordLengthMilli')
    expect(applianceProblems({ cordLengthMilli: 1_000_001 })).toHaveProperty('cordLengthMilli')
    expect(applianceProblems({ cordLengthMilli: 1.5 })).toHaveProperty('cordLengthMilli')
    expect(applianceProblems({ cordLengthMilli: null })).toEqual({})
  })

  it('is named by its inventory number before its designation, where it has one', () => {
    expect(applianceLabel({ inventoryNumber: '005', designation: 'Kaffeemaschine' })).toBe(
      '005 Kaffeemaschine',
    )
    expect(applianceLabel({ inventoryNumber: ' ', designation: 'Kaffeemaschine' })).toBe(
      'Kaffeemaschine',
    )
    expect(cordLengthText({ cordLengthMilli: 1200 })).toBe('1,2 m')
    expect(cordLengthText({ cordLengthMilli: null })).toBeNull()
    expect(
      applianceSubject({
        inventoryNumber: '005',
        designation: 'Kaffeemaschine',
        protectionClass: 'I',
        cordLengthMilli: 1200,
      }),
    ).toBe('005 Kaffeemaschine, Schutzklasse I, Anschlussleitung 1,2 m')
    expect(
      applianceSubject({
        inventoryNumber: null,
        designation: 'Bohrhammer',
        protectionClass: 'II',
        cordLengthMilli: null,
      }),
    ).toBe('Bohrhammer, Schutzklasse II')
  })

  it('is what a limit is worked out from only with a protection class it knows', () => {
    expect(isApplianceFacts({ protectionClass: 'I', cordLengthMilli: null })).toBe(true)
    expect(isApplianceFacts({ protectionClass: 'II', cordLengthMilli: 25_000 })).toBe(true)
    expect(isApplianceFacts({ protectionClass: 'IV', cordLengthMilli: null })).toBe(false)
    expect(isApplianceFacts({ protectionClass: 'I', cordLengthMilli: -1 })).toBe(false)
    // A circuit is not an appliance.
    expect(isApplianceFacts({ tripCharacteristic: 'b', ratedCurrentMilli: 16_000 })).toBe(false)
  })
})

describe('what a filled form hangs on (#303)', () => {
  const form = (attachesTo: FormDefinition['attachesTo']) =>
    ({ key: 'probe', version: 1, title: 'Probe', attachesTo, sections: [] }) as FormDefinition

  it('is an appliance for the test of an appliance and an installation for a protocol of one', () => {
    expect(
      formSubjectProblem(form('appliance'), { installationId: null, applianceId: 'd-1' }),
    ).toBeNull()
    expect(
      formSubjectProblem(form('appliance'), { installationId: 'i-1', applianceId: null }),
    ).toBe('Dieses Formular gehört an ein Gerät.')
    expect(
      formSubjectProblem(form('installation'), { installationId: 'i-1', applianceId: null }),
    ).toBeNull()
    expect(
      formSubjectProblem(form('installation'), { installationId: null, applianceId: 'd-1' }),
    ).toBe('Dieses Formular gehört an eine Anlage.')
    expect(formSubjectProblem(null, { installationId: null, applianceId: null })).toBeNull()
  })
})

describe('the limits worked out of an appliance (#303)', () => {
  const measured = (limit: MeasurementField['limit']): MeasurementField =>
    ({
      kind: 'measurement',
      key: 'probe',
      label: 'Probe',
      unit: 'ohm',
      decimals: 2,
      limit,
    }) as MeasurementField

  it('are a minimum for the insulation and a maximum for the protective conductor', () => {
    expect(limitIsMinimum(measured({ kind: 'appliance_insulation' }))).toBe(true)
    expect(limitIsMinimum(measured({ kind: 'appliance_protective_conductor' }))).toBe(false)
    expect(limitIsMinimum(measured({ kind: 'loop_impedance' }))).toBe(false)
    expect(limitIsMinimum(measured({ kind: 'at_least', rule: 'probe' }))).toBe(true)
    expect(limitIsMinimum(measured({ kind: 'at_most', rule: 'probe' }))).toBe(false)
    expect(limitIsMinimum(measured(undefined))).toBe(false)
  })

  it('say "mindestens" where the engine works out a minimum, so the short sign agrees with it', () => {
    const rules = ruleSet([
      {
        key: 'elektro.appliance.insulation_class_one',
        validFrom: '2021-06-01',
        validUntil: null,
        unit: 'kiloohms',
        value: 1000,
        source: 'Probe',
      },
    ])
    const field = { ...measured({ kind: 'appliance_insulation' }), unit: 'megaohm' as const }
    const verdict = limitVerdict(field, null, {
      rules,
      on: '2026-11-02',
      circuit: null,
      appliance: { protectionClass: 'I', cordLengthMilli: null },
    })

    expect(verdict.text).toContain('mindestens')
  })
})
