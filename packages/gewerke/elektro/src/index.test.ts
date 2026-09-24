import {
  definitionProblems,
  fieldsOf,
  type FormField,
  limitVerdict,
  type MeasurementField,
} from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import {
  elektroForms,
  elektroManifest,
  elektroRegistry,
  elektroRulePackages,
  elektroRules,
} from './index.js'

/**
 * What a contributor of a form can break without writing code, caught here
 * rather than on a site without a network: a definition that does not hold
 * together, a limit that names a rule the package does not have or has in the
 * wrong unit, a manifest that lists files that are not there.
 */

function measurementsOf(fields: readonly FormField[]): MeasurementField[] {
  return fields.flatMap((field) =>
    field.kind === 'measurement'
      ? [field]
      : field.kind === 'group'
        ? field.fields.filter((nested) => nested.kind === 'measurement')
        : [],
  )
}

describe('the package Elektro und PV', () => {
  it('lists in its manifest exactly the forms and rules it brings', () => {
    expect(elektroManifest.forms).toEqual(['formulare/vde-0100-600.v1.json'])
    expect(elektroManifest.rules).toEqual(['regeln/vde-0100-600.json'])
    expect(elektroForms).toHaveLength(elektroManifest.forms.length)
    expect(elektroRulePackages).toHaveLength(elektroManifest.rules.length)
  })

  it('has definitions that hold together', () => {
    for (const definition of elektroForms) {
      expect(definitionProblems(definition), definition.key).toEqual([])
    }
  })

  it('names for every limit a rule it has, in a unit that fits the measured value', () => {
    for (const definition of elektroForms) {
      for (const field of measurementsOf(fieldsOf(definition))) {
        if (field.limit?.kind === 'at_least' || field.limit?.kind === 'at_most') {
          expect(elektroRules.at(field.limit.rule, '2026-09-24'), field.key).not.toBeNull()
        }

        // Throws for a unit that does not fit, which is the point of asking.
        expect(() =>
          limitVerdict(field, 1000, {
            rules: elektroRules,
            on: '2026-09-24',
            circuit: {
              tripCharacteristic: 'b',
              ratedCurrentMilli: 16_000,
              ratedResidualCurrentMilli: 30,
            },
          }),
        ).not.toThrow()
      }
    }
  })

  it('gives every limit its source', () => {
    for (const record of elektroRules.all()) {
      expect(record.source.trim(), record.key).not.toBe('')
    }
  })

  it('judges the protocol of #79 as the standard does', () => {
    const protocol = elektroRegistry.definitionFor('vde-0100-600', 1)
    const circuits = protocol ? fieldsOf(protocol).find((field) => field.key === 'circuits') : null
    const fields = circuits?.kind === 'group' ? circuits.fields : []
    const field = (key: string) =>
      fields.find(
        (entry): entry is MeasurementField => entry.key === key && entry.kind === 'measurement',
      )
    const insulation = field('insulation_resistance')
    const loop = field('loop_impedance')
    const b16 = {
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      ratedResidualCurrentMilli: 30,
    } as const
    const on = '2026-09-24'

    expect(
      insulation && limitVerdict(insulation, 900, { rules: elektroRules, on, circuit: b16 }).within,
    ).toBe(false)
    expect(
      loop && limitVerdict(loop, 850, { rules: elektroRules, on, circuit: b16 }),
    ).toMatchObject({
      within: true,
      limitMilli: 2875,
    })
  })
})
