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
  pvStringItem,
  testsPart,
  valuesProblem,
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
      'formulare/vde-0100-600.v3.json',
      'formulare/vde-0105-100.v1.json',
      'formulare/dguv-v3.v1.json',
      'formulare/vde-ar-n-4105.v1.json',
      'formulare/iec-62446-1.v1.json',
      'formulare/vde-0100-722.v1.json',
      'formulare/battery-commissioning.v1.json',
    ])
    expect(elektroManifest.rules).toEqual([
      'regeln/vde-0100-600.json',
      'regeln/vde-0105-100.json',
      'regeln/dguv-v3.json',
      'regeln/vde-ar-n-4105.json',
      'regeln/iec-62446-1.json',
      'regeln/mastr.json',
      'regeln/vde-0100-722.json',
    ])
    expect(elektroManifest.deadlines).toEqual([
      'fristen/vde-0105-100.json',
      'fristen/dguv-v3.json',
      'fristen/netzbetreiber.json',
    ])
    expect(elektroForms).toHaveLength(elektroManifest.forms.length)
    expect(elektroRulePackages).toHaveLength(elektroManifest.rules.length)
    expect(elektroDeadlineKinds).toHaveLength(3)
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
      ['vde-0100-600', 3],
      ['vde-0105-100', 1],
      ['dguv-v3', 1],
      ['vde-ar-n-4105', 1],
      ['iec-62446-1', 1],
      ['vde-0100-722', 1],
      ['battery-commissioning', 1],
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

  it('adds in version 3 the interval to the first recurring inspection and changes nothing else (#814)', () => {
    const second = elektroRegistry.definitionFor('vde-0100-600', 2) as FormDefinition
    const third = elektroRegistry.definitionFor('vde-0100-600', 3) as FormDefinition
    const interval = nextInspectionField(third)
    const result = (definition: FormDefinition) =>
      definition.sections.find((section) => section.key === 'result')?.fields ?? []

    expect(interval).toMatchObject({
      key: 'next_inspection_months',
      label: 'Prüffrist bis zur ersten Wiederholungsprüfung',
      unit: 'month',
      decimals: 0,
    })
    // Needed after a new installation only, which the application asks
    // (`nextInspectionMissing`), and nothing a test of a part could carry on.
    expect(interval?.required).toBeUndefined()
    expect(interval?.carry).toBeUndefined()
    expect(interval?.hint).toContain('Pflicht bei einer Neuanlage.')
    expect(interval?.hint).toContain(
      'Tabelle 1A der Durchführungsanweisungen zu § 5 der DGUV Vorschrift 3',
    )
    expect(result(third).map((field) => field.key)).toEqual([
      'verdict',
      'defects',
      'next_inspection_months',
      'photo',
      'tester_signature',
    ])
    expect({
      ...third,
      version: 2,
      sections: third.sections.map((section) =>
        section.key === 'result'
          ? {
              ...section,
              fields: section.fields.filter((field) => field.key !== 'next_inspection_months'),
            }
          : section,
      ),
    }).toEqual(second)
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
    const first = elektroRegistry.definitionFor('vde-0100-600', 3)
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

  it('judges the test of an appliance after DGUV Vorschrift 3 by its protection class and lead (#303)', () => {
    const protocol = elektroRegistry.definitionFor('dguv-v3', 1)
    const field = (key: string) =>
      (protocol ? fieldsOf(protocol) : []).find(
        (entry): entry is MeasurementField => entry.key === key && entry.kind === 'measurement',
      )
    const judged = (
      key: string,
      milli: number,
      appliance: { protectionClass: 'I' | 'II' | 'III'; cordLengthMilli: number | null },
      on = '2026-11-02',
    ) => {
      const entry = field(key)

      return (
        entry && limitVerdict(entry, milli, { rules: elektroRules, on, circuit: null, appliance })
      )
    }
    const classOne = (cordLengthMilli: number | null) => ({
      protectionClass: 'I' as const,
      cordLengthMilli,
    })

    expect(protocol?.attachesTo).toBe('appliance')

    // The insulation by protection class: 1, 2 and 0,25 MΩ, in thousandths of a megaohm.
    expect(judged('insulation', 999, classOne(null))).toMatchObject({
      within: false,
      limitMilli: 1000,
    })
    expect(judged('insulation', 1000, classOne(null))?.within).toBe(true)
    expect(
      judged('insulation', 1999, { protectionClass: 'II', cordLengthMilli: null }),
    ).toMatchObject({ within: false, limitMilli: 2000 })
    expect(
      judged('insulation', 250, { protectionClass: 'III', cordLengthMilli: null })?.within,
    ).toBe(true)

    // 0,3 Ω up to 5 m, 0,1 Ω more for every 7,5 m begun beyond, at most 1 Ω.
    const resistanceLimit = (length: number | null) =>
      judged('protective_conductor', 0, classOne(length))?.limitMilli
    expect(resistanceLimit(null)).toBe(300)
    expect(resistanceLimit(5000)).toBe(300)
    expect(resistanceLimit(5001)).toBe(400)
    expect(resistanceLimit(12_500)).toBe(400)
    expect(resistanceLimit(12_501)).toBe(500)
    expect(resistanceLimit(25_000)).toBe(600)
    expect(resistanceLimit(100_000)).toBe(1000)
    expect(judged('protective_conductor', 301, classOne(null))?.within).toBe(false)
    // An appliance of class II has no protective conductor to judge.
    expect(
      judged('protective_conductor', 50, { protectionClass: 'II', cordLengthMilli: null })?.within,
    ).toBeNull()

    // The currents, in thousandths of a milliampere: 3,5 mA and 0,5 mA.
    expect(judged('protective_conductor_current', 3501, classOne(null))).toMatchObject({
      within: false,
      limitMilli: 3500,
    })
    expect(judged('touch_current', 500, classOne(null))?.within).toBe(true)
    expect(judged('touch_current', 501, classOne(null))?.source).toContain(
      'DGUV Information 203-070',
    )
    // Before DIN EN 50699 (VDE 0702):2021-06 no limit rather than an invented one.
    expect(judged('insulation', 999, classOne(null), '2021-05-31')?.within).toBeNull()
  })

  it('brings the commissioning protocol after VDE-AR-N 4105 for a PV system and a battery (#304)', () => {
    const protocol = elektroRegistry.definitionFor('vde-ar-n-4105', 1)
    const field = (key: string) =>
      (protocol ? fieldsOf(protocol) : []).find((entry) => entry.key === key)

    expect(protocol).toMatchObject({
      attachesTo: 'installation',
      installationKinds: ['pv_system', 'battery'],
      purpose: 'commissioning',
    })
    // What the structure fills: the operator, the parts, the power of the system.
    expect(protocol?.fromStructure).toEqual({
      operator: 'operator',
      inverters: 'inverters',
      batteries: 'batteries',
      meter: 'meters',
      apparent_power: 'inverter_power',
      active_power: 'inverter_power',
      module_power: 'module_power',
    })
    // A commissioning protocol is no test: nothing in it starts a deadline.
    expect(protocol ? nextInspectionField(protocol) : undefined).toBeNull()
    // It is the one that goes to the grid operator behind the completion (#306, #307).
    expect(protocol?.toGridOperator).toBe(true)
    expect(field('grid_parallel_on')).toMatchObject({ kind: 'date' })
    // Both sign on the device, the business last, and only then is it fixed.
    expect(field('operator_signature')).toMatchObject({ kind: 'signature', required: true })
    expect(field('installer_signature')).toMatchObject({ kind: 'signature', seals: true })
    expect(
      (protocol ? fieldsOf(protocol) : [])
        .filter((entry) => entry.kind === 'signature')
        .map((entry) => entry.key),
    ).toEqual(['operator_signature', 'installer_signature'])
  })

  it('judges the limit of the feed-in by the law of the day of commissioning (#304)', () => {
    const protocol = elektroRegistry.definitionFor('vde-ar-n-4105', 1)
    const limit = (protocol ? fieldsOf(protocol) : []).find(
      (entry): entry is MeasurementField =>
        entry.key === 'feed_in_limit' && entry.kind === 'measurement',
    )
    // Percent in thousandths: 60 % is 60 000.
    const judged = (milli: number, on: string) =>
      limit && limitVerdict(limit, milli, { rules: elektroRules, on, circuit: null })

    expect(judged(60_000, '2025-02-25')).toMatchObject({ within: true, limitMilli: 60_000 })
    expect(judged(61_000, '2026-11-02')).toMatchObject({ within: false, limitMilli: 60_000 })
    expect(judged(61_000, '2026-11-02')?.source).toContain(
      '§ 9 Abs. 2 Satz 1 Nr. 2 Buchst. b und Nr. 3 EEG',
    )
    // A system commissioned before the Solarspitzengesetz has no such limit.
    expect(judged(100_000, '2025-02-24')?.within).toBeNull()
  })

  it('brings the test of the DC side of a PV system, string by string out of its structure (#305)', () => {
    const protocol = elektroRegistry.definitionFor('iec-62446-1', 1)
    const strings = (protocol ? fieldsOf(protocol) : []).find((entry) => entry.key === 'strings')

    expect(protocol).toMatchObject({
      attachesTo: 'installation',
      installationKinds: ['pv_system'],
      partOfInstallation: true,
    })
    expect(strings).toMatchObject({ kind: 'group', repeat: 'pv_strings' })
    expect(strings?.kind === 'group' ? strings.fields.map((field) => field.key) : []).toEqual([
      'polarity',
      'open_circuit_voltage',
      'short_circuit_current',
      'insulation_resistance',
      'remark',
    ])
    // A test of a part: no deadline of its own, and not the last test of the whole.
    expect(protocol ? nextInspectionField(protocol) : undefined).toBeNull()
    expect(protocol ? testsPart(protocol, {}) : false).toBe(true)
  })

  it('keeps a string in its block, and refuses one that carries a protective device (#305)', () => {
    const protocol = elektroRegistry.definitionFor('iec-62446-1', 1) as FormDefinition
    const string = pvStringItem({
      designation: 'String 1',
      mppInput: 1,
      inverter: 'WR 1',
      modules: 12,
      ratedPowerW: 4800,
    })

    expect(string).toEqual({
      designation: 'String 1',
      consumer: 'WR 1, Eingang 1, 12 Module, 4,80 kWp',
      tripCharacteristic: null,
      ratedCurrentMilli: null,
      ratedResidualCurrentMilli: null,
    })
    expect(
      valuesProblem(protocol, { strings: [{ circuitId: 's-1', circuit: string, values: {} }] }),
    ).toBeNull()
    // Each part of a protective device on its own makes the block no string's.
    for (const device of [
      { tripCharacteristic: 'b' },
      { ratedCurrentMilli: 16_000 },
      { ratedResidualCurrentMilli: 30 },
    ]) {
      expect(
        valuesProblem(protocol, {
          strings: [{ circuitId: 's-1', circuit: { ...string, ...device }, values: {} }],
        }),
      ).toBe('Strings: jeder Block gehört zu einem String.')
    }
  })

  it('judges the insulation of a string by the minimum of DIN EN IEC 62446-1 (#305)', () => {
    const protocol = elektroRegistry.definitionFor('iec-62446-1', 1)
    const strings = (protocol ? fieldsOf(protocol) : []).find((entry) => entry.key === 'strings')
    const insulation =
      strings?.kind === 'group'
        ? strings.fields.find(
            (entry): entry is MeasurementField =>
              entry.key === 'insulation_resistance' && entry.kind === 'measurement',
          )
        : undefined
    // In thousandths of a megaohm: 1 MΩ is 1000.
    const judged = (milli: number, on = '2026-11-02') =>
      insulation && limitVerdict(insulation, milli, { rules: elektroRules, on, circuit: null })

    expect(judged(999)).toMatchObject({ within: false, limitMilli: 1000 })
    expect(judged(1000)?.within).toBe(true)
    expect(judged(999)?.source).toContain('DIN EN IEC 62446-1 (VDE 0126-23-1):2019-04, Tabelle 2')
    // Before the edition of 2019 the protocol knows no limit rather than an invented one.
    expect(judged(999, '2019-03-31')?.within).toBeNull()
  })

  it('takes over from the last test of an appliance what describes the test and its interval', () => {
    const protocol = elektroRegistry.definitionFor('dguv-v3', 1)
    const field = protocol ? nextInspectionField(protocol) : null

    expect(
      (protocol ? fieldsOf(protocol) : [])
        .filter((entry) => entry.carry === true)
        .map((entry) => entry.key),
    ).toEqual(['tester', 'instrument', 'test_kind', 'current_method', 'next_inspection_months'])
    expect(field).toMatchObject({ required: true, carry: true, unit: 'month', decimals: 0 })
    expect(field?.hint).toContain('Tabelle 1B der Durchführungsanweisungen zu § 5')
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
      // The test of an appliance (#303): one task for the appliances of a site due the same day.
      expect.objectContaining({
        key: 'elektro.appliance_inspection',
        trade: 'elektro',
        source: 'appliance_inspection',
        intervalDays: null,
        intervalMonths: null,
        leadDays: 30,
        responsible: 'source',
        actions: ['task'],
        taskTitle: 'Geräte nach DGUV Vorschrift 3 prüfen am Objekt {objekt}',
      }),
      // The entry in the installer directory of a grid operator (#306), the owner's.
      expect.objectContaining({
        key: 'elektro.installer_registration',
        trade: 'elektro',
        source: 'installer_registration',
        intervalDays: null,
        intervalMonths: null,
        leadDays: 90,
        responsible: 'lead',
        actions: ['task', 'reminder'],
        taskTitle: 'Eintragung im Installateurverzeichnis verlängern: {quelle}',
      }),
    ])
  })

  it('names the month an operator has to register a unit in, from the MaStRV on', () => {
    expect(elektroRules.valueAt('elektro.mastr.registration_months', 'months', '2026-11-02')).toBe(
      1,
    )
    expect(elektroRules.at('elektro.mastr.registration_months', '2017-06-30')).toBeNull()
  })

  it('puts a wallbox into operation with its first inspection after DIN VDE 0100-722 (#307)', () => {
    const protocol = elektroRegistry.definitionFor('vde-0100-722', 1)
    const fields = protocol ? fieldsOf(protocol) : []
    const field = (key: string) => fields.find((entry) => entry.key === key)

    expect(protocol).toMatchObject({
      attachesTo: 'installation',
      installationKinds: ['wallbox'],
      purpose: 'commissioning',
    })
    expect(protocol?.toGridOperator).toBeUndefined()
    expect(protocol?.fromStructure).toEqual({
      operator: 'operator',
      charging_station: 'installation',
      rated_power: 'rated_power',
    })
    // Like the first inspection of a new installation it names the interval, required.
    expect(protocol ? nextInspectionField(protocol) : null).toMatchObject({
      unit: 'month',
      required: true,
    })
    expect(field('dc_protection')).toMatchObject({ kind: 'choice', required: true })
    expect(field('tester_signature')).toMatchObject({ kind: 'signature', seals: true })
  })

  it('judges the RCD of a charging point by 30 mA and its DC fault monitor by 6 mA (#307)', () => {
    const protocol = elektroRegistry.definitionFor('vde-0100-722', 1)
    const measured = (key: string) =>
      (protocol ? fieldsOf(protocol) : []).find(
        (entry): entry is MeasurementField => entry.key === key && entry.kind === 'measurement',
      )
    const judged = (key: string, milli: number) => {
      const field = measured(key)

      return (
        field &&
        limitVerdict(field, milli, { rules: elektroRules, on: '2026-11-02', circuit: null })
      )
    }

    // Milliamperes in thousandths: 30 mA is 30 000.
    expect(judged('rcd_trip_current', 30_000)).toMatchObject({ within: true, limitMilli: 30_000 })
    expect(judged('rcd_trip_current', 30_100)).toMatchObject({ within: false })
    expect(judged('rcd_trip_current', 30_100)?.source).toContain('722.411.3.3')
    expect(judged('dc_trip_current', 6000)).toMatchObject({ within: true, limitMilli: 6000 })
    expect(judged('dc_trip_current', 6100)).toMatchObject({ within: false })
    expect(judged('dc_trip_current', 6100)?.source).toContain('722.531.3.101')
    // The rules of the first inspection for the trip time and the insulation.
    expect(judged('rcd_trip_time', 301_000)).toMatchObject({ within: false, limitMilli: 300_000 })
    expect(judged('insulation_resistance', 999)).toMatchObject({ within: false, limitMilli: 1000 })
  })

  it('puts a battery into operation as its manufacturer asks, beside VDE-AR-N 4105 (#307)', () => {
    const protocol = elektroRegistry.definitionFor('battery-commissioning', 1)
    const fields = protocol ? fieldsOf(protocol) : []

    expect(protocol).toMatchObject({
      attachesTo: 'installation',
      installationKinds: ['battery'],
      purpose: 'commissioning',
    })
    expect(protocol?.fromStructure).toEqual({
      operator: 'operator',
      storage: 'installation',
      usable_capacity: 'usable_capacity',
      rated_power: 'rated_power',
    })
    // No test of the installation, no deadline, and not for the grid operator.
    expect(protocol ? nextInspectionField(protocol) : undefined).toBeNull()
    expect(protocol?.toGridOperator).toBeUndefined()
    expect(fields.filter((entry) => entry.kind === 'signature').map((entry) => entry.key)).toEqual([
      'operator_signature',
      'installer_signature',
    ])
  })
})
