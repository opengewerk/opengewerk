import {
  coreDeadlineKinds,
  deadlineRegistry,
  definitionProblems,
  fieldsOf,
  type FormDefinition,
  type FormField,
  limitVerdict,
  type MeasurementField,
  nextInspectionField,
} from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import {
  elektroDeadlineKinds,
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
  it('lists in its manifest exactly the forms, rules and kinds of deadline it brings', () => {
    expect(elektroManifest.forms).toEqual([
      'formulare/vde-0100-600.v1.json',
      'formulare/vde-0100-600.v2.json',
      'formulare/vde-0105-100.v1.json',
    ])
    expect(elektroManifest.rules).toEqual(['regeln/vde-0100-600.json', 'regeln/vde-0105-100.json'])
    expect(elektroManifest.deadlines).toEqual(['fristen/vde-0105-100.json'])
    expect(elektroForms).toHaveLength(elektroManifest.forms.length)
    expect(elektroRulePackages).toHaveLength(elektroManifest.rules.length)
    expect(elektroDeadlineKinds).toHaveLength(1)
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

  it('fills a new protocol in the newest version and still reads the first (#256)', () => {
    const first = elektroRegistry.definitionFor('vde-0100-600', 1)
    const second = elektroRegistry.definitionFor('vde-0100-600', 2)
    const remark = (definition: FormDefinition | null) => {
      const circuits = definition
        ? fieldsOf(definition).find((field) => field.key === 'circuits')
        : null

      return circuits?.kind === 'group'
        ? circuits.fields.find((field) => field.key === 'remark')
        : undefined
    }

    expect(
      elektroRegistry.current().map((definition) => [definition.key, definition.version]),
    ).toEqual([
      ['vde-0100-600', 2],
      ['vde-0105-100', 1],
    ])
    expect(remark(first)).toEqual({ kind: 'text', key: 'remark', label: 'Bemerkung' })
    expect(remark(second)).toEqual({
      kind: 'text',
      key: 'remark',
      label: 'Bemerkung',
      multiline: true,
    })
  })

  it('changes nothing in version 2 but the remark, so a template carries over whole', () => {
    const first = JSON.stringify(elektroRegistry.definitionFor('vde-0100-600', 1))
    const line = '{"kind":"text","key":"remark","label":"Bemerkung"}'

    expect(first).toContain(line)
    expect(elektroRegistry.definitionFor('vde-0100-600', 2)).toEqual({
      ...(JSON.parse(
        first.replace(line, '{"kind":"text","key":"remark","label":"Bemerkung","multiline":true}'),
      ) as FormDefinition),
      version: 2,
    })
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

  it('judges the recurring inspection of #301 by the minimum the measurement asks', () => {
    const protocol = elektroRegistry.definitionFor('vde-0105-100', 1)
    const circuits = protocol ? fieldsOf(protocol).find((field) => field.key === 'circuits') : null
    const fields = circuits?.kind === 'group' ? circuits.fields : []
    const field = (key: string) =>
      fields.find(
        (entry): entry is MeasurementField => entry.key === key && entry.kind === 'measurement',
      )
    const without = field('insulation_without_loads')
    const withLoads = field('insulation_with_loads')
    const judged = (entry: MeasurementField | undefined, milli: number, on = '2026-11-02') =>
      entry && limitVerdict(entry, milli, { rules: elektroRules, on, circuit: null })

    // 1000 Ω per volt without loads and 300 Ω per volt with them, at 230 V:
    // 0,230 MΩ and 0,069 MΩ, in thousandths of a megaohm.
    expect(judged(without, 229)).toMatchObject({ within: false, limitMilli: 230 })
    expect(judged(without, 230)?.within).toBe(true)
    expect(judged(withLoads, 68)).toMatchObject({ within: false, limitMilli: 69 })
    expect(judged(withLoads, 69)?.within).toBe(true)
    expect(judged(without, 229)?.source).toContain('DGUV Information 203-072')
    // Before DIN VDE 0105-100/A1:2017-06 the protocol knows no limit rather than an invented one.
    expect(judged(without, 229, '2017-05-31')?.within).toBeNull()
  })

  it('takes over from a first inspection what describes the installation and the test', () => {
    const first = elektroRegistry.definitionFor('vde-0100-600', 2)
    const recurring = elektroRegistry.definitionFor('vde-0105-100', 1)
    const carried = (definition: FormDefinition | null) =>
      definition ? fieldsOf(definition).filter((field) => field.carry === true) : []

    expect(carried(recurring).map((field) => field.key)).toEqual([
      'tester',
      'instrument',
      'earthing_system',
      'nominal_voltage',
      'next_inspection_months',
    ])
    // The same fields, so that the one is the template of the other.
    expect(carried(first)).toEqual(carried(recurring).slice(0, 4))
  })

  it('names the next inspection in months, filled in before signing and taken over from the last', () => {
    const recurring = elektroRegistry.definitionFor('vde-0105-100', 1)
    const field = recurring ? nextInspectionField(recurring) : null

    expect(field).toMatchObject({ required: true, carry: true, unit: 'month', decimals: 0 })
    expect(field?.hint).toContain(
      'Tabelle 1A der Durchführungsanweisungen zu § 5 der DGUV Vorschrift 3',
    )
    expect(
      nextInspectionField(elektroRegistry.definitionFor('vde-0100-600', 2) as FormDefinition),
    ).toBeNull()
  })

  it('brings the recurring inspection as a kind of deadline the registry takes', () => {
    expect(() => deadlineRegistry([...coreDeadlineKinds, ...elektroDeadlineKinds])).not.toThrow()
    expect(elektroDeadlineKinds).toEqual([
      expect.objectContaining({
        key: 'elektro.recurring_inspection',
        trade: 'elektro',
        source: 'inspection',
        intervalDays: null,
        intervalMonths: null,
        leadDays: 60,
        responsible: 'source',
        actions: ['task', 'reminder'],
        taskTitle: 'Wiederholungsprüfung: {quelle}',
      }),
    ])
  })
})
