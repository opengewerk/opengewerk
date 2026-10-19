import { describe, expect, it } from 'vitest'

import {
  checkedInstanceMeasures,
  instanceMeasureSections,
  measureField,
  measureLimits,
} from './instance-measures.js'

const place = {
  name: 'Rechenbetrieb Nord GmbH, Hafenweg 1',
  service: 'Server',
  place: 'Deutschland',
}

describe('the sections of part B', () => {
  it('are B.1 to B.9, and no key of a field stands twice', () => {
    expect(instanceMeasureSections.map((section) => section.number)).toEqual([
      'B.1',
      'B.2',
      'B.3',
      'B.4',
      'B.5',
      'B.6',
      'B.7',
      'B.8',
      'B.9',
    ])

    const keys = instanceMeasureSections.flatMap((section) => section.fields.map((f) => f.key))

    expect(new Set(keys).size).toBe(keys.length)
    expect(measureField('encryptionBackups')?.kind).toBe('check')
    expect(measureField('nothing')).toBeUndefined()
  })
})

describe('what a request may keep of part B and annex 2', () => {
  it('keeps a text without the spaces around it and a ticked box, and leaves out what says nothing', () => {
    expect(
      checkedInstanceMeasures({
        measures: {
          serverPlace: '  Deutschland, Nürnberg \r\n',
          serverRoom: '   ',
          accessFirewall: true,
          encryptionDisks: false,
          further: 'Zwei Zeilen\r\nund mehr',
        },
        subprocessors: [
          {
            name: ' Rechenbetrieb Nord GmbH, Hafenweg 1 ',
            service: 'Server',
            place: 'Deutschland',
          },
        ],
      }),
    ).toEqual({
      measures: {
        serverPlace: 'Deutschland, Nürnberg',
        accessFirewall: true,
        further: 'Zwei Zeilen\nund mehr',
      },
      subprocessors: [place],
    })
  })

  it('refuses a field there is none of, a box that is a text and a line that is a box', () => {
    expect(checkedInstanceMeasures({ measures: { password: 'x' }, subprocessors: [] })).toEqual({
      problem: 'Ein Feld „password“ gibt es nicht.',
    })
    expect(
      checkedInstanceMeasures({ measures: { accessFirewall: 'ja' }, subprocessors: [] }),
    ).toEqual({
      problem: '„eine Firewall lässt nur die nötigen Ports durch“ ist angekreuzt oder nicht.',
    })
    expect(checkedInstanceMeasures({ measures: { serverPlace: true }, subprocessors: [] })).toEqual(
      {
        problem: '„Land und Ort des Servers“ ist ein Text.',
      },
    )
  })

  it('refuses a line or a longer text beyond its length, and keeps one just at it', () => {
    expect(
      checkedInstanceMeasures({
        measures: { serverPlace: 'x'.repeat(measureLimits.line + 1) },
        subprocessors: [],
      }),
    ).toEqual({ problem: '„Land und Ort des Servers“: höchstens 500 Zeichen.' })
    expect(
      checkedInstanceMeasures({
        measures: { further: 'x'.repeat(measureLimits.area + 1) },
        subprocessors: [],
      }),
    ).toEqual({ problem: '„Weitere Maßnahmen“: höchstens 4.000 Zeichen.' })
    expect(
      checkedInstanceMeasures({
        measures: {
          serverPlace: 'ä'.repeat(measureLimits.line),
          further: 'x'.repeat(measureLimits.area),
        },
        subprocessors: [],
      }),
    ).not.toHaveProperty('problem')
  })

  it('wants all three fields of a subprocessor, and not more of them than there is room for', () => {
    expect(
      checkedInstanceMeasures({ measures: {}, subprocessors: [place, { ...place, service: ' ' }] }),
    ).toEqual({ problem: 'Beim 2. Unterauftragsverarbeiter fehlt „Leistung“.' })
    expect(
      checkedInstanceMeasures({
        measures: {},
        subprocessors: [{ ...place, place: 'x'.repeat(measureLimits.subprocessorField + 1) }],
      }),
    ).toEqual({
      problem: 'Beim 1. Unterauftragsverarbeiter: „Ort der Verarbeitung“ höchstens 500 Zeichen.',
    })
    expect(
      checkedInstanceMeasures({
        measures: {},
        subprocessors: Array.from({ length: measureLimits.subprocessors + 1 }, () => place),
      }),
    ).toEqual({ problem: 'Höchstens 30 Unterauftragsverarbeiter.' })
  })

  it('wants both parts, the measures as an object and the subprocessors as a list', () => {
    expect(checkedInstanceMeasures({ subprocessors: [] })).toEqual({
      problem: 'Es fehlen die Maßnahmen.',
    })
    expect(checkedInstanceMeasures({ measures: [], subprocessors: [] })).toEqual({
      problem: 'Es fehlen die Maßnahmen.',
    })
    expect(checkedInstanceMeasures({ measures: {} })).toEqual({
      problem: 'Es fehlen die Unterauftragsverarbeiter.',
    })
  })
})
