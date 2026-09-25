import { describe, expect, it } from 'vitest'

import { ruleSet } from '../rules/rule.js'
import type { FormDefinition, MeasurementField } from './definition.js'
import { definitionProblems, formRegistry } from './definition.js'
import { formatMeasured, limitVerdict, measuredNumber } from './limits.js'
import { formRecordProblem } from './record.js'
import {
  circuitBlocks,
  formValuesText,
  type FormValues,
  longestFormValues,
  readFormValues,
  sealProblems,
  templateValues,
  valuesProblem,
} from './values.js'

/** A small protocol with one field of every kind, the way a trade package writes one. */
const protocol: FormDefinition = {
  key: 'probe',
  version: 1,
  title: 'Probeprotokoll',
  attachesTo: 'installation',
  sections: [
    {
      key: 'general',
      title: 'Allgemein',
      fields: [
        { kind: 'text', key: 'tester', label: 'Prüfer', required: true, carry: true },
        {
          kind: 'number',
          key: 'voltage',
          label: 'Nennspannung',
          unit: 'volt',
          decimals: 0,
          carry: true,
        },
        {
          kind: 'choice',
          key: 'earthing',
          label: 'Netzform',
          carry: true,
          options: [
            { value: 'tn_s', label: 'TN-S' },
            { value: 'tt', label: 'TT' },
          ],
        },
        { kind: 'yes_no', key: 'documented', label: 'Unterlagen vorhanden' },
        { kind: 'photo', key: 'panel', label: 'Foto des Verteilers' },
      ],
    },
    {
      key: 'measurements',
      title: 'Messungen',
      fields: [
        {
          kind: 'group',
          key: 'circuits',
          label: 'Stromkreise',
          repeat: 'circuits',
          fields: [
            {
              kind: 'measurement',
              key: 'insulation',
              label: 'Isolationswiderstand',
              unit: 'megaohm',
              decimals: 2,
              limit: { kind: 'at_least', rule: 'elektro.insulation.minimum_up_to_500v' },
              required: true,
            },
            { kind: 'text', key: 'remark', label: 'Bemerkung' },
          ],
        },
      ],
    },
    {
      key: 'result',
      title: 'Ergebnis',
      fields: [{ kind: 'signature', key: 'signature', label: 'Unterschrift', seals: true }],
    },
  ],
}

const rules = ruleSet([
  {
    key: 'elektro.insulation.minimum_up_to_500v',
    validFrom: '2017-06-01',
    validUntil: null,
    unit: 'kiloohms',
    value: 1000,
    source: 'DIN VDE 0100-600:2017-06, Tabelle 6.1',
  },
  {
    key: 'elektro.rcd.trip_time_maximum',
    validFrom: '2017-06-01',
    validUntil: null,
    unit: 'milliseconds',
    value: 300,
    source: 'DIN EN 61008-1',
  },
  {
    key: 'elektro.rcd.trip_current_maximum',
    validFrom: '2017-06-01',
    validUntil: null,
    unit: 'basis_points',
    value: 10_000,
    source: 'DIN EN 61008-1',
  },
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
    source: 'DIN EN 60898-1',
  },
])

const signature = { name: 'Paul Prüfer', path: 'M10,10L20,20', signedAt: '2026-09-24T10:00:00Z' }

/** A circuit as a block keeps it: F3, a breaker B16 behind a 30 mA device. */
const bath = {
  designation: 'F3',
  consumer: 'Steckdosen Bad',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
} as const

describe('a form definition', () => {
  it('passes when every field is well formed', () => {
    expect(definitionProblems(protocol)).toEqual([])
  })

  it('names a key used twice, a choice with one option and a group inside a group', () => {
    const broken: FormDefinition = {
      ...protocol,
      sections: [
        {
          key: 'broken',
          title: 'Kaputt',
          fields: [
            { kind: 'text', key: 'tester', label: 'Prüfer' },
            { kind: 'text', key: 'tester', label: 'Noch einmal' },
            { kind: 'choice', key: 'one', label: 'Eine', options: [{ value: 'a', label: 'A' }] },
            {
              kind: 'group',
              key: 'outer',
              label: 'Außen',
              repeat: 'free',
              fields: [
                // A group inside a group, which the type does not allow and a
                // JSON file can still say.
                {
                  kind: 'group',
                  key: 'inner',
                  label: 'Innen',
                  repeat: 'free',
                  fields: [],
                } as never,
              ],
            },
          ],
        },
      ],
    }

    expect(definitionProblems(broken)).toEqual([
      'probe: das Feld tester steht zweimal im Formular.',
      'probe: die Auswahl one hat weniger als zwei Möglichkeiten.',
      'probe: die Gruppe inner steht in einer Gruppe.',
    ])
  })

  it('names a signature or a measured value that would carry into the next test', () => {
    const carried: FormDefinition = {
      ...protocol,
      sections: [
        {
          key: 'result',
          title: 'Ergebnis',
          fields: [{ kind: 'signature', key: 'seal', label: 'Unterschrift', carry: true }],
        },
      ],
    }

    expect(definitionProblems(carried)).toEqual([
      'probe: seal wird nicht übernommen, ein Messwert und eine Unterschrift gehören zu der Prüfung, in der sie entstanden sind.',
    ])
  })

  it('is found by key and version, and the newest is the one a new form is filled in', () => {
    const second = { ...protocol, version: 2, title: 'Probeprotokoll, zweite Fassung' }
    const registry = formRegistry([protocol, second])

    expect(registry.definitionFor('probe', 1)?.title).toBe('Probeprotokoll')
    expect(registry.definitionFor('probe', 3)).toBeNull()
    expect(registry.current().map((entry) => entry.version)).toEqual([2])
  })
})

describe('the values of a filled form', () => {
  const filled: FormValues = {
    tester: 'Paul Prüfer',
    voltage: 230_000,
    earthing: 'tn_s',
    documented: true,
    panel: 'attachment-1',
    circuits: [{ circuitId: 'c-1', circuit: bath, values: { insulation: 550_000, remark: 'Bad' } }],
    signature,
  }

  it('are accepted when each fits its field', () => {
    expect(valuesProblem(protocol, filled)).toBeNull()
  })

  it('are refused for a key the definition does not know, or a value of the wrong kind', () => {
    expect(valuesProblem(protocol, { unknown: 'x' })).toBe(
      'Das Feld unknown gibt es in Probeprotokoll nicht.',
    )
    expect(valuesProblem(protocol, { voltage: 230.5 })).toBe('Nennspannung: eine Zahl.')
    expect(valuesProblem(protocol, { earthing: 'it' })).toBe(
      'Netzform: eine der angebotenen Möglichkeiten.',
    )
    expect(valuesProblem(protocol, { signature: { ...signature, path: '<script>' } })).toBe(
      'Unterschrift: die Unterschrift ist kein Pfad.',
    )
    expect(
      valuesProblem(protocol, {
        circuits: [
          { circuitId: 'c-1', circuit: bath, values: {} },
          { circuitId: 'c-1', circuit: bath, values: {} },
        ],
      }),
    ).toBe('Stromkreise: ein Stromkreis hat zwei Blöcke.')
  })

  it('refuse a block of a group per circuit that does not say which circuit it is', () => {
    expect(
      valuesProblem(protocol, { circuits: [{ circuitId: 'c-1', circuit: null, values: {} }] }),
    ).toBe('Stromkreise: jeder Block gehört zu einem Stromkreis.')
  })

  it('say what is missing before the form can be signed', () => {
    expect(
      sealProblems(protocol, { circuits: [{ circuitId: 'c-1', circuit: bath, values: {} }] }),
    ).toEqual([
      'Prüfer fehlt.',
      'Stromkreise, Block 1: Isolationswiderstand fehlt.',
      'Unterschrift fehlt.',
    ])
    expect(sealProblems(protocol, filled)).toEqual([])
    // Before the signature is offered: everything but the signature itself.
    expect(
      sealProblems(protocol, { ...filled, signature: undefined } as never, { seal: false }),
    ).toEqual([])
  })

  it('keep a block for every circuit, in the order of the chart, and one of a circuit that is gone', () => {
    const blocks = circuitBlocks(
      [
        {
          circuitId: 'c-2',
          circuit: { ...bath, designation: 'F2 alt' },
          values: { insulation: 900_000 },
        },
        { circuitId: 'c-gone', circuit: bath, values: { insulation: 1_200_000 } },
      ],
      [
        { ...bath, id: 'c-1', designation: 'F1' },
        { ...bath, id: 'c-2', designation: 'F2' },
      ],
    )

    expect(
      blocks.map((block) => [
        block.circuitId,
        block.circuit?.designation,
        block.values['insulation'] ?? null,
      ]),
    ).toEqual([
      ['c-1', 'F1', null],
      ['c-2', 'F2', 900_000],
      ['c-gone', 'F3', 1_200_000],
    ])
  })

  it('make a template of what carries, without what the last test found, measured and signed', () => {
    expect(templateValues(protocol, filled)).toEqual({
      tester: 'Paul Prüfer',
      voltage: 230_000,
      earthing: 'tn_s',
      circuits: [{ circuitId: 'c-1', circuit: bath, values: {} }],
    })
  })

  it('stay readable with the version they were filled in when the definition changes', () => {
    // The second version drops the photo and renames nothing else. A form of
    // the first still reads with the first, and only with it.
    const second: FormDefinition = {
      ...protocol,
      version: 2,
      sections: protocol.sections.map((section) => ({
        ...section,
        fields: section.fields.filter((field) => field.key !== 'panel'),
      })),
    }
    const registry = formRegistry([protocol, second])
    const old = registry.definitionFor('probe', 1)

    expect(old && valuesProblem(old, filled)).toBeNull()
    expect(valuesProblem(second, filled)).toBe('Das Feld panel gibt es in Probeprotokoll nicht.')
  })
})

describe('a filled form as a record (#78)', () => {
  const registry = formRegistry([protocol])
  const complete: FormValues = {
    tester: 'Paul Prüfer',
    circuits: [{ circuitId: 'c-1', circuit: bath, values: { insulation: 550_000 } }],
    signature,
  }
  const record = (values: unknown, status = 'draft') => ({
    definitionKey: 'probe',
    definitionVersion: 1,
    status,
    values,
  })

  it('carries its values as JSON text and reads them back as they were', () => {
    const text = formValuesText(complete)

    expect(readFormValues(text)).toEqual(complete)
    expect(formRecordProblem(registry, record(text))).toBeNull()
    expect(formRecordProblem(registry, record(text, 'signed'))).toBeNull()
  })

  it('is refused for values that are not the text of an object', () => {
    for (const values of ['[]', 'null', '"Paul"', '{"tester":', complete]) {
      expect(formRecordProblem(registry, record(values))).toBe(
        'Die Werte eines Formulars kommen als JSON-Text eines Objekts.',
      )
    }
  })

  it('is refused for values longer than a transmission is meant to carry', () => {
    const long = formValuesText({ tester: 'x'.repeat(longestFormValues) })

    expect(formRecordProblem(registry, record(long))).toBe(
      `Die Werte eines Formulars sind höchstens ${String(longestFormValues)} Zeichen lang.`,
    )
  })

  it('is refused for a definition this version does not know, and for a value that does not fit', () => {
    expect(formRecordProblem(registry, { ...record('{}'), definitionVersion: 2 })).toBe(
      'Dieses Formular kennt diese Fassung von OpenGewerk nicht.',
    )
    expect(formRecordProblem(registry, record(formValuesText({ voltage: 230.5 })))).toBe(
      'Nennspannung: eine Zahl.',
    )
  })

  it('is signed only when nothing is missing, and names the first thing that is', () => {
    expect(
      formRecordProblem(registry, record(formValuesText({ tester: 'Paul Prüfer' }), 'signed')),
    ).toBe('Unterschrieben wird ein vollständiges Protokoll: Unterschrift fehlt.')
  })
})

describe('a measured value against its limit (#79)', () => {
  const insulation = protocol.sections[1]?.fields[0]
  const field = (insulation?.kind === 'group' ? insulation.fields[0] : null) as MeasurementField
  const on = '2026-09-24'

  it('is within at the limit and outside below it, and says where the limit comes from', () => {
    // Thousandths of a megaohm: 1,00 MΩ is 1000.
    const at = limitVerdict(field, 1000, { rules, on, circuit: null })
    const below = limitVerdict(field, 850, { rules, on, circuit: null })

    expect(at).toMatchObject({ within: true, limitMilli: 1000 })
    expect(below).toEqual({
      within: false,
      limitMilli: 1000,
      text: 'Außerhalb des Grenzwerts, mindestens 1,00 MΩ.',
      source: 'DIN VDE 0100-600:2017-06, Tabelle 6.1',
    })
  })

  it('names the limit before anything is measured, and none before the rule applies', () => {
    expect(limitVerdict(field, null, { rules, on, circuit: null }).text).toBe(
      'Grenzwert: mindestens 1,00 MΩ.',
    )
    expect(limitVerdict(field, 850, { rules, on: '2016-01-01', circuit: null }).within).toBeNull()
  })

  it('works out the loop impedance from the breaker of the circuit', () => {
    const loop: MeasurementField = {
      kind: 'measurement',
      key: 'loop',
      label: 'Schleifenimpedanz',
      unit: 'ohm',
      decimals: 2,
      limit: { kind: 'loop_impedance' },
    }
    const b16 = {
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      ratedResidualCurrentMilli: null,
    } as const

    // 230 V over five times 16 A: 2,875 Ω, and written as 2,87 Ω, not 2,88:
    // a measured 2,88 Ω is outside, and the limit it is told must say so.
    expect(limitVerdict(loop, 2_880, { rules, on, circuit: b16 })).toMatchObject({
      within: false,
      limitMilli: 2_875,
      text: 'Außerhalb des Grenzwerts, höchstens 2,87 Ω.',
    })
    expect(limitVerdict(loop, 850, { rules, on, circuit: b16 }).within).toBe(true)
    // Behind a fuse there is no factor, and no limit to show.
    expect(
      limitVerdict(loop, 850, {
        rules,
        on,
        circuit: {
          tripCharacteristic: 'gg',
          ratedCurrentMilli: 16_000,
          ratedResidualCurrentMilli: null,
        },
      }).within,
    ).toBeNull()
  })

  it('takes the tripping current against the rated residual current of the circuit', () => {
    const trip: MeasurementField = {
      kind: 'measurement',
      key: 'trip',
      label: 'Auslösestrom',
      unit: 'milliampere',
      decimals: 1,
      limit: { kind: 'rcd_trip_current' },
    }
    const rcd30 = {
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      ratedResidualCurrentMilli: 30,
    } as const

    expect(limitVerdict(trip, 24_000, { rules, on, circuit: rcd30 })).toMatchObject({
      within: true,
      limitMilli: 30_000,
    })
    expect(limitVerdict(trip, 31_000, { rules, on, circuit: rcd30 }).within).toBe(false)
  })

  it('writes a value the way it is read', () => {
    expect(formatMeasured(850, 'ohm', 2)).toBe('0,85 Ω')
    expect(formatMeasured(23_000, 'millisecond', 0)).toBe('23 ms')
    // Without the unit, for a column that names it in its head.
    expect(measuredNumber(3_410, 2)).toBe('3,41')
    expect(measuredNumber(480_000, 2)).toBe('480,00')
  })
})
