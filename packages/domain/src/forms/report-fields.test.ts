import { describe, expect, it } from 'vitest'

import { signedContentFingerprint } from '../model/document-signature.js'
import {
  fieldText,
  mostReportFields,
  nextReportFieldKey,
  readFormDefinition,
  reportDefinition,
  type ReportField,
  reportFieldLines,
  reportFieldsProblems,
} from './report-fields.js'
import { formValuesText, valuesProblem } from './values.js'

/**
 * The fields a business gives its reports (#78): written in the settings,
 * versioned like a form of a trade package, filled in on site and signed
 * with the report.
 */

const weather: ReportField = {
  kind: 'choice',
  key: 'field_1',
  label: 'Wetter',
  options: [
    { value: 'dry', label: 'trocken' },
    { value: 'rain', label: 'Regen' },
  ],
}

const distance: ReportField = {
  kind: 'number',
  key: 'field_2',
  label: 'Anfahrt',
  unit: 'kilometre',
  decimals: 0,
}

const parking: ReportField = { kind: 'yes_no', key: 'field_3', label: 'Parkplatz vorhanden' }

const remark: ReportField = { kind: 'text', key: 'field_4', label: 'Besonderheiten' }

const fields = [weather, distance, parking, remark]

describe('the fields a business gives its reports', () => {
  it('are accepted in the four kinds, and refused in any other', () => {
    expect(reportFieldsProblems(fields)).toEqual([])
    expect(reportFieldsProblems([{ kind: 'photo', key: 'field_1', label: 'Foto' }])).toEqual([
      'Ein Feld ist Text, Zahl mit Einheit, Auswahl oder Ja/Nein.',
    ])
    expect(
      reportFieldsProblems([
        { kind: 'measurement', key: 'field_1', label: 'Riso', unit: 'megaohm', decimals: 2 },
      ]),
    ).toEqual(['Ein Feld ist Text, Zahl mit Einheit, Auswahl oder Ja/Nein.'])
  })

  it('are refused as too many, without a label, or with one label twice', () => {
    const many = Array.from({ length: mostReportFields + 1 }, (_, index) => ({
      ...remark,
      key: `field_${String(index + 1)}`,
      label: `Feld ${String(index + 1)}`,
    }))

    expect(reportFieldsProblems(many)).toEqual([
      `Ein Regiebericht hat höchstens ${String(mostReportFields)} eigene Felder.`,
    ])
    expect(reportFieldsProblems([{ ...remark, label: '  ' }])).toEqual([
      'Jedes Feld braucht eine Beschriftung.',
    ])
    expect(reportFieldsProblems([remark, { ...remark, key: 'field_5' }])).toEqual([
      'Das Feld Besonderheiten steht zweimal da.',
    ])
  })

  it('are refused with the label the owner typed, never with the key behind it (#221)', () => {
    expect(
      reportFieldsProblems([{ ...weather, options: [{ value: 'dry', label: 'trocken' }] }]),
    ).toEqual([`Die Auswahl „${weather.label}“ braucht mindestens zwei Möglichkeiten.`])
    expect(
      reportFieldsProblems([
        {
          ...weather,
          options: [
            { value: 'dry', label: 'trocken' },
            { value: 'dry', label: 'Regen' },
          ],
        },
      ]),
    ).toEqual([
      `Jede Möglichkeit der Auswahl „${weather.label}“ braucht einen eigenen Wert und eine Beschriftung.`,
    ])
    expect(reportFieldsProblems([{ ...distance, unit: 'furlong' as never }])).toEqual([
      `Das Feld „${distance.label}“ nennt eine Einheit, die es nicht gibt.`,
    ])
    expect(reportFieldsProblems([{ ...distance, decimals: 4 }])).toEqual([
      `Das Feld „${distance.label}“ zeigt null bis drei Nachkommastellen.`,
    ])
  })

  it('give a new field a key no earlier field had', () => {
    expect(nextReportFieldKey([])).toBe('field_1')
    expect(nextReportFieldKey(['field_1', 'field_3'])).toBe('field_4')
    expect(nextReportFieldKey(['weather', 'field_2'])).toBe('field_3')
  })

  it('read as the report shows them and the paper prints them, empty ones left out', () => {
    const definition = reportDefinition(2, fields)
    const values = { field_1: 'rain', field_2: 25_000, field_3: false, field_4: '   ' }

    expect(valuesProblem(definition, values)).toBeNull()
    expect(fieldText(distance, 25_000)).toBe('25 km')
    expect(reportFieldLines(definition, values)).toEqual([
      { label: 'Wetter', text: 'Regen' },
      { label: 'Anfahrt', text: '25 km' },
      { label: 'Parkplatz vorhanden', text: 'nein' },
    ])
    expect(reportFieldLines(null, values)).toEqual([])
  })

  it('come back out of the text they are kept as', () => {
    const definition = reportDefinition(3, fields)

    expect(readFormDefinition(JSON.stringify(definition))).toEqual(definition)
    expect(readFormDefinition('{"key":"report"}')).toBeNull()
    expect(readFormDefinition('nicht lesbar')).toBeNull()
  })
})

describe('a report signed with its fields', () => {
  const content = {
    introText: 'Zwei Leitungsschutzschalter getauscht.',
    lines: [
      {
        id: 'l-1',
        position: 1,
        kind: 'item' as const,
        designation: 'Arbeitszeit',
        description: null,
        quantityMilli: 2_500,
        unit: 'hour' as const,
      },
    ],
  }

  it('keeps the fingerprint it had before there were fields, when it has none', () => {
    const before = signedContentFingerprint(content)

    expect(signedContentFingerprint({ ...content, fields: null })).toBe(before)
    expect(signedContentFingerprint({ ...content, fields: '{}' })).toBe(before)
  })

  it('changes its fingerprint with every value the customer saw', () => {
    const rainy = signedContentFingerprint({
      ...content,
      fields: formValuesText({ field_1: 'rain' }),
    })
    const dry = signedContentFingerprint({ ...content, fields: formValuesText({ field_1: 'dry' }) })

    expect(rainy).not.toBe(signedContentFingerprint(content))
    expect(rainy).not.toBe(dry)
  })
})
