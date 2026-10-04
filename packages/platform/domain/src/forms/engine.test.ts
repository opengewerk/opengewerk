import { describe, expect, it } from 'vitest'

import { ruleSet } from '../rules/rule.js'
import {
  type BlockField,
  type BlockFieldKind,
  blockFieldKinds,
  type FormDefinition,
  formRegistry,
  type MeasurementField,
} from './definition.js'
import { formEngine, type RepeatList } from './engine.js'
import { formValuesText, type FormValues, type GroupBlock } from './values.js'

/**
 * The form engine for an application that belongs to nobody (ADR 0010): the
 * probe application inspects its shelves. It counts in kilograms and degrees,
 * repeats a group over its shelves, and works out the load limit of a shelf
 * from what the block keeps of it. Nothing here hangs on anything: what a
 * filled form belongs to is the application's, and this one says nothing.
 */

interface ProbeTerms {
  readonly unit: 'kilogram' | 'degree_celsius' | 'cubic_metre'
  readonly list: 'shelves'
  readonly limit: 'shelf_load'
  readonly kind: BlockFieldKind
}

/** A shelf as a block keeps it: its label and the load it carries. */
interface Shelf {
  readonly label: string
  readonly loadKilograms: number
}

const shelfList: RepeatList = {
  itemIsValid: (item) =>
    typeof item === 'object' &&
    item !== null &&
    typeof (item as Shelf).label === 'string' &&
    Number.isInteger((item as Shelf).loadKilograms),
  sentences: {
    blockWithoutItem: (label) => `${label}: jeder Block gehört zu einem Regal.`,
    itemTwice: (label) => `${label}: ein Regal hat zwei Blöcke.`,
  },
}

const engine = formEngine<ProbeTerms>({
  units: {
    kilogram: { sign: 'kg' },
    // A rule in tenths of a degree, a field in degrees: one tenth is a
    // hundred thousandths.
    degree_celsius: { sign: '°C', fromRule: { decidegrees_celsius: 100 } },
    cubic_metre: { sign: 'm³' },
  },
  lists: { shelves: shelfList },
  limits: {
    shelf_load: (_field, { item }) => {
      const shelf = item as Shelf | null

      return shelf
        ? { limitMilli: shelf.loadKilograms * 1000, atLeast: false, source: 'Schild am Regal' }
        : { none: 'Ohne Regal gibt es keine Traglast.' }
    },
  },
  kinds: blockFieldKinds,
  records: ['store_room', 'meter'],
})

const inspection: FormDefinition<ProbeTerms> = {
  key: 'shelf-inspection',
  version: 1,
  title: 'Regalprüfung',
  sections: [
    {
      key: 'general',
      title: 'Allgemein',
      fields: [
        { kind: 'text', key: 'inspector', label: 'Prüfer', required: true, carry: true },
        {
          kind: 'measurement',
          key: 'temperature',
          label: 'Raumtemperatur',
          unit: 'degree_celsius',
          decimals: 1,
          limit: { kind: 'at_most', rule: 'probe.storage.temperature_maximum' },
        },
        {
          kind: 'choice',
          key: 'condition',
          label: 'Zustand',
          carry: true,
          options: [
            { value: 'good', label: 'Gut' },
            { value: 'worn', label: 'Abgenutzt' },
          ],
        },
        { kind: 'yes_no', key: 'labelled', label: 'Beschriftet' },
        { kind: 'photo', key: 'overview', label: 'Übersicht' },
      ],
    },
    {
      key: 'shelves',
      title: 'Regale',
      fields: [
        {
          kind: 'group',
          key: 'loads',
          label: 'Regale',
          repeat: 'shelves',
          fields: [
            {
              kind: 'measurement',
              key: 'load',
              label: 'Last',
              unit: 'kilogram',
              decimals: 0,
              limit: { kind: 'shelf_load' },
              required: true,
            },
            { kind: 'text', key: 'remark', label: 'Bemerkung', carry: true },
          ],
        },
        {
          kind: 'group',
          key: 'findings',
          label: 'Weitere Befunde',
          repeat: 'free',
          fields: [{ kind: 'text', key: 'finding', label: 'Befund' }],
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
    key: 'probe.storage.temperature_maximum',
    validFrom: '2026-01-01',
    validUntil: null,
    unit: 'decidegrees_celsius',
    value: 250,
    source: 'Lagerordnung des Probewerks',
  },
  {
    key: 'probe.storage.minutes',
    validFrom: '2026-01-01',
    validUntil: null,
    unit: 'minutes',
    value: 15,
    source: 'Lagerordnung des Probewerks',
  },
])

const keller: Shelf = { label: 'Keller', loadKilograms: 120 }
const boden: Shelf = { label: 'Dachboden', loadKilograms: 80 }
const signature = { name: 'Petra Probe', path: 'M10,10L20,20', signedAt: '2026-10-04T10:00:00Z' }

const filled: FormValues = {
  inspector: 'Petra Probe',
  temperature: 21_500,
  condition: 'good',
  loads: [
    { itemId: 'shelf-1', item: keller, values: { load: 95_000, remark: 'Linke Seite voll' } },
    { itemId: 'shelf-2', item: boden, values: { load: 81_000 } },
  ] as unknown as readonly GroupBlock[],
  findings: [{ values: { finding: 'Lampe flackert' } }],
  signature,
}

describe('a definition', () => {
  it('passes when every field is well formed, whatever the form hangs on', () => {
    expect(engine.definitionProblems(inspection)).toEqual([])
  })

  it('names a kind, a list, a limit and a unit nobody told the engine about', () => {
    const broken = {
      ...inspection,
      sections: [
        {
          key: 'broken',
          title: 'Kaputt',
          fields: [
            { kind: 'slider', key: 'level', label: 'Stand' },
            {
              kind: 'group',
              key: 'boxes',
              label: 'Kisten',
              repeat: 'boxes',
              fields: [],
            },
            {
              kind: 'measurement',
              key: 'height',
              label: 'Höhe',
              unit: 'metre',
              decimals: 2,
              limit: { kind: 'shelf_height' },
            },
          ],
        },
      ],
    } as unknown as FormDefinition<ProbeTerms>

    expect(engine.definitionProblems(broken)).toEqual([
      'shelf-inspection: das Feld level hat die Art slider, die es nicht gibt.',
      'shelf-inspection: die Gruppe boxes wiederholt über eine Liste, die es nicht gibt.',
      'shelf-inspection: height nennt eine Einheit, die es nicht gibt.',
      'shelf-inspection: der Grenzwert von height ist von einer Art, die es nicht gibt.',
    ])
  })

  it('names what is not of its shape in a definition out of a file, instead of falling over it', () => {
    const broken = {
      ...inspection,
      sections: [
        null,
        {
          key: 'main',
          title: 'Haupt',
          fields: [
            null,
            { kind: 'choice', key: 'colour', label: 'Farbe' },
            {
              kind: 'choice',
              key: 'size',
              label: 'Größe',
              options: [null, { value: 's', label: 'S' }],
            },
            { kind: 'group', key: 'boxes', label: 'Kisten', repeat: 'free', fields: 'none' },
            {
              kind: 'measurement',
              key: 'heat',
              label: 'Wärme',
              unit: 'degree_celsius',
              decimals: 1,
              limit: null,
            },
          ],
        },
      ],
    } as unknown as FormDefinition<ProbeTerms>

    expect(engine.definitionProblems(broken)).toEqual([
      'shelf-inspection: unter den Abschnitten steht etwas, das kein Abschnitt ist.',
      'shelf-inspection: unter den Feldern steht etwas, das kein Feld ist.',
      'shelf-inspection: die Auswahl colour hat keine Liste von Möglichkeiten.',
      'shelf-inspection: jede Möglichkeit der Auswahl size braucht einen eigenen Wert und eine Beschriftung.',
      'shelf-inspection: die Gruppe boxes hat keine Liste von Feldern.',
      'shelf-inspection: der Grenzwert von heat ist von einer Art, die es nicht gibt.',
    ])
  })

  it('takes a key written with hyphens or with underscores, and no other', () => {
    expect(engine.definitionProblems({ ...inspection, key: 'shelf_inspection' })).toEqual([])
    expect(engine.definitionProblems({ ...inspection, key: 'probe.shelf_inspection' })).toEqual([
      'Der Schlüssel probe.shelf_inspection hat die falsche Form.',
    ])
  })

  it('names a section twice, a section key of the wrong shape and a form without a title', () => {
    const broken = {
      ...inspection,
      title: ' ',
      sections: [
        { key: 'general', title: 'Allgemein', fields: [] },
        { key: 'general', title: 'Noch einmal', fields: [] },
        { key: 'Ergebnis', title: 'Ergebnis', fields: [] },
      ],
    } as unknown as FormDefinition<ProbeTerms>

    expect(engine.definitionProblems(broken)).toEqual([
      'shelf-inspection: das Formular hat keinen Titel.',
      'shelf-inspection: der Abschnitt general steht zweimal im Formular.',
      'shelf-inspection: der Abschnitt Ergebnis hat einen Schlüssel der falschen Form.',
    ])
  })

  it('keeps a version: a form filled in the first is read with the first, and the newest is the one to fill', () => {
    const second: FormDefinition<ProbeTerms> = {
      ...inspection,
      version: 2,
      sections: inspection.sections.map((section) =>
        section.key === 'general'
          ? { ...section, fields: section.fields.filter((field) => field.key !== 'labelled') }
          : section,
      ),
    }
    const registry = formRegistry([inspection, second])
    const record = (version: number) => ({
      definitionKey: 'shelf-inspection',
      definitionVersion: version,
      status: 'draft',
      values: formValuesText({ ...filled, labelled: true }),
    })

    expect(registry.current().map((entry) => entry.version)).toEqual([2])
    expect(engine.formRecordProblem(registry, record(1))).toBeNull()
    expect(engine.formRecordProblem(registry, record(2))).toBe(
      'Das Feld labelled gibt es in Regalprüfung nicht.',
    )
    expect(engine.formRecordProblem(registry, record(3))).toBe(
      'Diese Fassung des Formulars ist hier nicht bekannt.',
    )
  })
})

describe('the values of a filled form', () => {
  it('fit when every block of a list names its item, and a free block names none', () => {
    expect(engine.valuesProblem(inspection, filled)).toBeNull()
  })

  it('are refused for a block without its item, an item twice and a free block with one, in the words of the list', () => {
    const withLoads = (loads: unknown) => ({ ...filled, loads })

    expect(engine.valuesProblem(inspection, withLoads([{ values: { load: 1000 } }]))).toBe(
      'Regale: jeder Block gehört zu einem Regal.',
    )
    expect(
      engine.valuesProblem(
        inspection,
        withLoads([{ itemId: 'shelf-1', item: { label: 'Keller' }, values: {} }]),
      ),
    ).toBe('Regale: jeder Block gehört zu einem Regal.')
    expect(
      engine.valuesProblem(
        inspection,
        withLoads([
          { itemId: 'shelf-1', item: keller, values: {} },
          { itemId: 'shelf-1', item: keller, values: {} },
        ]),
      ),
    ).toBe('Regale: ein Regal hat zwei Blöcke.')
    expect(
      engine.valuesProblem(inspection, {
        ...filled,
        findings: [{ itemId: 'shelf-1', item: keller, values: {} }],
      }),
    ).toBe('Weitere Befunde: ein freier Block gehört zu keinem Eintrag einer Liste.')
  })

  it('are refused for a field the definition does not know and a value of the wrong kind', () => {
    expect(engine.valuesProblem(inspection, { ...filled, colour: 'rot' })).toBe(
      'Das Feld colour gibt es in Regalprüfung nicht.',
    )
    expect(engine.valuesProblem(inspection, { ...filled, temperature: 21.5 })).toBe(
      'Raumtemperatur: eine Zahl.',
    )
    expect(
      engine.valuesProblem(inspection, { ...filled, signature: { ...signature, name: ' ' } }),
    ).toBe('Der Name dessen, der unterschreibt.')
  })

  it('refuses a value of a kind only a newer build knows, instead of letting it through', () => {
    const newer = {
      ...inspection,
      sections: [
        {
          key: 'general',
          title: 'Allgemein',
          fields: [{ kind: 'slider', key: 'level', label: 'Stand' }],
        },
      ],
    } as unknown as FormDefinition<ProbeTerms>

    expect(engine.valuesProblem(newer, { level: 3 })).toBe(
      'Stand: dieses Feld kennt dieser Stand nicht.',
    )
  })

  it('are signed only once every required field and the sealing signature are there', () => {
    const { signature: _seal, ...unsigned } = filled
    const withoutLoad: FormValues = {
      ...filled,
      loads: [{ itemId: 'shelf-1', item: keller, values: {} }] as unknown as readonly GroupBlock[],
    }

    expect(engine.sealingField(inspection)?.key).toBe('signature')
    expect(engine.sealProblems(inspection, filled)).toEqual([])
    expect(engine.sealProblems(inspection, unsigned)).toEqual(['Unterschrift fehlt.'])
    expect(engine.sealProblems(inspection, unsigned, { seal: false })).toEqual([])
    expect(engine.sealProblems(inspection, withoutLoad)).toEqual(['Regale, Block 1: Last fehlt.'])
  })

  it('lays the blocks over the items as they are now, and keeps a block of an item that is gone', () => {
    const blocks = filled['loads'] as readonly GroupBlock[]
    const laid = engine.listBlocks(blocks, [
      { id: 'shelf-3', item: { label: 'Garage', loadKilograms: 200 } },
      { id: 'shelf-1', item: { label: 'Keller', loadKilograms: 150 } },
    ])

    expect(laid).toEqual([
      { itemId: 'shelf-3', item: { label: 'Garage', loadKilograms: 200 }, values: {} },
      {
        itemId: 'shelf-1',
        item: { label: 'Keller', loadKilograms: 150 },
        values: { load: 95_000, remark: 'Linke Seite voll' },
      },
      { itemId: 'shelf-2', item: boden, values: { load: 81_000 } },
    ])
  })

  it('starts the next form from what carries, the blocks with their items', () => {
    expect(engine.templateValues(inspection, filled)).toEqual({
      inspector: 'Petra Probe',
      condition: 'good',
      loads: [
        { itemId: 'shelf-1', item: keller, values: { remark: 'Linke Seite voll' } },
        { itemId: 'shelf-2', item: boden, values: {} },
      ],
      findings: [{ values: {} }],
    })
  })

  it('keeps a block under the keys the application gave, as its stored forms were written', () => {
    const stored = formEngine<ProbeTerms>({
      units: {
        kilogram: { sign: 'kg' },
        degree_celsius: { sign: '°C' },
        cubic_metre: { sign: 'm³' },
      },
      lists: { shelves: shelfList },
      limits: { shelf_load: () => ({ none: 'Keine.' }) },
      kinds: blockFieldKinds,
      blockKeys: { id: 'shelfId', item: 'shelf' },
    })
    const loads = [{ shelfId: 'shelf-1', shelf: keller, values: { load: 1000 } }]

    expect(stored.valuesProblem(inspection, { ...filled, loads })).toBeNull()
    expect(stored.valuesProblem(inspection, { ...filled, loads: filled['loads'] })).toBe(
      'Regale: jeder Block gehört zu einem Regal.',
    )
    expect(
      formValuesText({ loads: stored.listBlocks(loads, [{ id: 'shelf-1', item: keller }]) }),
    ).toBe(formValuesText({ loads }))
  })
})

describe('the verdict on a measured value', () => {
  const temperature = inspection.sections[0]?.fields[1] as MeasurementField<ProbeTerms>
  const load = (
    inspection.sections[1]?.fields[0] as {
      readonly fields: readonly MeasurementField<ProbeTerms>[]
    }
  ).fields[0] as MeasurementField<ProbeTerms>

  it('takes a limit from a rule, in the unit of the field, with its source', () => {
    expect(engine.limitVerdict(temperature, 21_500, { rules, on: '2026-10-04' })).toEqual({
      within: true,
      limitMilli: 25_000,
      text: 'Innerhalb des Grenzwerts, höchstens 25,0 °C.',
      source: 'Lagerordnung des Probewerks',
    })
    expect(engine.limitVerdict(temperature, null, { rules, on: '2025-12-31' })).toEqual({
      within: null,
      limitMilli: null,
      text: 'Für diesen Tag ist kein Grenzwert hinterlegt.',
      source: null,
    })
  })

  it('works out a limit from what the block is about, and says so when it is about nothing', () => {
    expect(engine.limitVerdict(load, 81_000, { rules, on: '2026-10-04', item: boden })).toEqual({
      within: false,
      limitMilli: 80_000,
      text: 'Außerhalb des Grenzwerts, höchstens 80 kg.',
      source: 'Schild am Regal',
    })
    expect(engine.limitVerdict(load, 81_000, { rules, on: '2026-10-04' })).toEqual({
      within: null,
      limitMilli: null,
      text: 'Ohne Regal gibt es keine Traglast.',
      source: null,
    })
  })

  it('refuses a rule in a unit the field cannot be measured in', () => {
    const minutes: MeasurementField<ProbeTerms> = {
      ...temperature,
      limit: { kind: 'at_most', rule: 'probe.storage.minutes' },
    }

    expect(() => engine.limitVerdict(minutes, 1000, { rules, on: '2026-10-04' })).toThrow(
      'Die Regel probe.storage.minutes in minutes passt nicht zu einem Messwert in degree_celsius.',
    )
  })
})

describe('a filled form', () => {
  const registry = formRegistry([inspection])
  const record = (values: FormValues, status = 'draft') => ({
    definitionKey: 'shelf-inspection',
    definitionVersion: 1,
    status,
    values: formValuesText(values),
  })

  it('hangs on nothing the engine knows of, and is taken when it fits its version', () => {
    expect(engine.formRecordProblem(registry, record(filled, 'signed'))).toBeNull()
  })

  it('is refused as signed while something required is missing, and as values that are no object', () => {
    const { inspector: _missing, ...without } = filled

    expect(engine.formRecordProblem(registry, record(without, 'signed'))).toBe(
      'Unterschrieben wird ein vollständiges Protokoll: Prüfer fehlt.',
    )
    expect(engine.formRecordProblem(registry, { ...record(filled), values: '[1, 2, 3]' })).toBe(
      'Die Werte eines Formulars kommen als JSON-Text eines Objekts.',
    )
  })
})

/**
 * A round through the store room, as its operator keeps the template for this
 * one room: it names the room and the meter it reads, which a shipped form
 * cannot, and asks a check point of every shelf.
 */
const round: FormDefinition<ProbeTerms> = {
  key: 'store-round',
  version: 1,
  title: 'Rundgang Lager',
  sections: [
    {
      key: 'room',
      title: 'Lagerraum',
      fields: [
        {
          kind: 'check_point',
          key: 'escape_route',
          label: 'Fluchtweg frei',
          about: { kind: 'store_room', id: 'room-1' },
        },
        { kind: 'check_point', key: 'lighting', label: 'Beleuchtung' },
        {
          kind: 'meter_reading',
          key: 'water',
          label: 'Wasserzähler',
          unit: 'cubic_metre',
          decimals: 3,
          about: { kind: 'meter', id: 'meter-1' },
        },
      ],
    },
    {
      key: 'shelves',
      title: 'Regale',
      fields: [
        {
          kind: 'group',
          key: 'shelf_checks',
          label: 'Regale',
          repeat: 'shelves',
          fields: [{ kind: 'check_point', key: 'stable', label: 'Standsicher' }],
        },
      ],
    },
    {
      key: 'end',
      title: 'Abschluss',
      fields: [{ kind: 'signature', key: 'signature', label: 'Unterschrift', seals: true }],
    },
  ],
}

const answered: FormValues = {
  escape_route: { result: 'ok' },
  lighting: { result: 'not_ok', remark: 'Leuchte über der Tür defekt', photo: 'file-7' },
  water: 1_234_567,
  shelf_checks: [
    {
      itemId: 'shelf-1',
      item: keller,
      values: { stable: { result: 'not_applicable', remark: 'Regal leer geräumt' } },
    },
  ] as unknown as readonly GroupBlock[],
  signature,
}

/** The answers with one key replaced, or left out where the value is undefined. */
function answeredWith(key: string, value: unknown): FormValues {
  const { [key]: _replaced, ...rest } = answered

  return (value === undefined ? rest : { ...rest, [key]: value }) as FormValues
}

/** The answers with the one block of the shelves holding these values. */
function shelfWith(values: Readonly<Record<string, unknown>>): FormValues {
  return answeredWith('shelf_checks', [{ itemId: 'shelf-1', item: keller, values }])
}

describe('a definition with check points, readings and pointers', () => {
  it('passes a round that points at a room and a meter of its own', () => {
    expect(engine.definitionProblems(round)).toEqual([])
  })

  it('refuses a pointer to a kind of record nobody named, one without an id, one on a signature and one in a group', () => {
    const broken = {
      ...round,
      sections: [
        {
          key: 'room',
          title: 'Lagerraum',
          fields: [
            { kind: 'check_point', key: 'a', label: 'A', about: { kind: 'vehicle', id: 'v-1' } },
            { kind: 'check_point', key: 'b', label: 'B', about: { kind: 'meter', id: ' ' } },
            { kind: 'signature', key: 'c', label: 'C', about: { kind: 'meter', id: 'meter-1' } },
            {
              kind: 'group',
              key: 'g',
              label: 'G',
              repeat: 'free',
              fields: [
                { kind: 'check_point', key: 'd', label: 'D', about: { kind: 'meter', id: 'm-2' } },
              ],
            },
          ],
        },
      ],
    } as unknown as FormDefinition<ProbeTerms>

    expect(engine.definitionProblems(broken)).toEqual([
      'store-round: a zeigt auf eine Art von Datensatz, die es nicht gibt.',
      'store-round: b zeigt auf einen Datensatz ohne Kennung.',
      'store-round: c zeigt auf einen Datensatz, das kann weder eine Unterschrift noch eine Gruppe.',
      'store-round: d zeigt in einer Gruppe auf einen Datensatz, das kann nur ein Feld außerhalb einer Gruppe.',
    ])
  })

  it('refuses a check point that carries or may stay unanswered, and a reading that carries or has no unit it knows', () => {
    const broken = {
      ...round,
      sections: [
        {
          key: 'room',
          title: 'Lagerraum',
          fields: [
            { kind: 'check_point', key: 'e', label: 'E', carry: true },
            { kind: 'check_point', key: 'f', label: 'F', required: false },
            {
              kind: 'meter_reading',
              key: 'h',
              label: 'H',
              unit: 'litre',
              decimals: 4,
              carry: true,
            },
          ],
        },
      ],
    } as unknown as FormDefinition<ProbeTerms>

    expect(engine.definitionProblems(broken)).toEqual([
      'store-round: e wird nicht übernommen, eine Antwort auf einen Prüfpunkt und ein Zählerstand gehören zu dem Tag, an dem sie entstanden sind.',
      'store-round: der Prüfpunkt f braucht immer eine Antwort, dafür gibt es „entfällt“ und „nicht möglich“.',
      'store-round: h wird nicht übernommen, eine Antwort auf einen Prüfpunkt und ein Zählerstand gehören zu dem Tag, an dem sie entstanden sind.',
      'store-round: h nennt eine Einheit, die es nicht gibt.',
      'store-round: h zeigt null bis drei Nachkommastellen.',
    ])
  })
})

/** An application whose screens show texts and yes or no, and nothing else. */
interface NarrowTerms {
  readonly unit: 'kilogram'
  readonly list: never
  readonly limit: never
  readonly kind: 'text' | 'yes_no'
}

describe('an application that does not show every kind', () => {
  const narrow = formEngine<NarrowTerms>({
    units: { kilogram: { sign: 'kg' } },
    lists: {},
    limits: {},
    kinds: ['text', 'yes_no'],
  })

  it('has no check point in its types, so its screens need no case for one', () => {
    // @ts-expect-error A check point is no field of an application that does not show one.
    const point: BlockField<NarrowTerms> = { kind: 'check_point', key: 'tidy', label: 'Ordnung' }

    expect(point.kind).toBe('check_point')
  })

  it('refuses one in a definition out of a file, and a value for one', () => {
    const note = {
      key: 'note',
      version: 1,
      title: 'Notiz',
      sections: [
        {
          key: 'main',
          title: 'Notiz',
          fields: [
            { kind: 'text', key: 'note', label: 'Notiz' },
            { kind: 'check_point', key: 'tidy', label: 'Ordnung' },
          ],
        },
      ],
    } as unknown as FormDefinition<NarrowTerms>
    const tidy = { kind: 'check_point', key: 'tidy', label: 'Ordnung' }

    expect(narrow.definitionProblems(note)).toEqual([
      'note: das Feld tidy hat die Art check_point, die diese Anwendung nicht zeigt.',
    ])
    expect(narrow.valueProblem(tidy as unknown as BlockField<NarrowTerms>, { result: 'ok' })).toBe(
      'Ordnung: dieses Feld kennt dieser Stand nicht.',
    )
    expect(narrow.valuesProblem(note, { tidy: { result: 'ok' } })).toBe(
      'Ordnung: dieses Feld kennt dieser Stand nicht.',
    )
  })
})

describe('the answers of a round', () => {
  it('take an answer with its remark and photo, and a reading in thousandths', () => {
    expect(engine.valuesProblem(round, answered)).toBeNull()
  })

  it('refuse an answer that is none of the four, holds more than its three parts, or a remark or photo of the wrong shape', () => {
    const lighting = (value: unknown) =>
      engine.valuesProblem(round, answeredWith('lighting', value))
    const fourAnswers = 'Beleuchtung: in Ordnung, nicht in Ordnung, entfällt oder nicht möglich.'

    expect(lighting('ok')).toBe(fourAnswers)
    expect(lighting({ result: 'broken' })).toBe(fourAnswers)
    expect(lighting({ result: 'ok', defect: 'A' })).toBe(
      'Beleuchtung: ein Prüfpunkt hält eine Antwort, eine Bemerkung und ein Foto.',
    )
    expect(lighting({ result: 'not_ok', remark: 'x'.repeat(4001) })).toBe(
      'Beleuchtung: eine Bemerkung mit höchstens 4000 Zeichen.',
    )
    expect(lighting({ result: 'not_ok', remark: 'x', photo: '' })).toBe(
      'Beleuchtung: ein Foto aus den Dateien.',
    )
    expect(engine.valuesProblem(round, answeredWith('water', 1234.5))).toBe(
      'Wasserzähler: eine Zahl.',
    )
  })

  it('may be saved between the answer and its remark: what is missing is a question of signing', () => {
    expect(engine.valuesProblem(round, answeredWith('lighting', { result: 'not_ok' }))).toBeNull()
  })

  it('are signed only once every check point has an answer and every answer the remark it needs', () => {
    expect(engine.sealProblems(round, answered)).toEqual([])
    expect(engine.sealProblems(round, answeredWith('escape_route', undefined))).toEqual([
      'Fluchtweg frei fehlt.',
    ])
    expect(engine.sealProblems(round, answeredWith('lighting', { result: 'not_ok' }))).toEqual([
      'Beleuchtung: zu „nicht in Ordnung“ fehlt die Bemerkung.',
    ])
    expect(
      engine.sealProblems(round, answeredWith('lighting', { result: 'not_ok', remark: '  ' })),
    ).toEqual(['Beleuchtung: zu „nicht in Ordnung“ fehlt die Bemerkung.'])
    expect(engine.sealProblems(round, shelfWith({ stable: { result: 'not_possible' } }))).toEqual([
      'Regale, Block 1: Standsicher: zu „nicht möglich“ fehlt der Grund.',
    ])
    expect(engine.sealProblems(round, shelfWith({}))).toEqual([
      'Regale, Block 1: Standsicher fehlt.',
    ])
  })

  it('ask for an answer and its remark before the signature is offered, and a reading only where it is required', () => {
    const { signature: _seal, ...unsigned } = answered

    expect(engine.sealProblems(round, unsigned, { seal: false })).toEqual([])
    expect(
      engine.sealProblems(round, answeredWith('lighting', { result: 'not_applicable' }), {
        seal: false,
      }),
    ).toEqual(['Beleuchtung: zu „entfällt“ fehlt der Grund.'])
    expect(engine.sealProblems(round, answeredWith('water', undefined))).toEqual([])
  })

  it('start the next round empty: answers and readings do not carry', () => {
    // Marked to carry in a definition nobody checked, they still do not.
    const carrying = {
      ...round,
      sections: round.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.kind === 'group'
            ? { ...field, fields: field.fields.map((nested) => ({ ...nested, carry: true })) }
            : { ...field, carry: true },
        ),
      })),
    } as unknown as FormDefinition<ProbeTerms>

    expect(engine.templateValues(round, answered)).toEqual({
      shelf_checks: [{ itemId: 'shelf-1', item: keller, values: {} }],
    })
    expect(engine.templateValues(carrying, answered)).toEqual({
      shelf_checks: [{ itemId: 'shelf-1', item: keller, values: {} }],
    })
  })

  it('are read with the version they were answered in', () => {
    const second: FormDefinition<ProbeTerms> = {
      ...round,
      version: 2,
      sections: round.sections.map((section) =>
        section.key === 'room'
          ? {
              ...section,
              fields: [
                ...section.fields.filter((field) => field.key !== 'lighting'),
                { kind: 'check_point', key: 'fire_door', label: 'Brandschutztür' },
              ],
            }
          : section,
      ),
    }
    const registry = formRegistry([round, second])
    const record = (version: number, values: FormValues) => ({
      definitionKey: 'store-round',
      definitionVersion: version,
      status: 'signed',
      values: formValuesText(values),
    })

    expect(engine.formRecordProblem(registry, record(1, answered))).toBeNull()
    expect(engine.formRecordProblem(registry, record(2, answered))).toBe(
      'Das Feld lighting gibt es in Rundgang Lager nicht.',
    )
    expect(engine.formRecordProblem(registry, record(2, answeredWith('lighting', undefined)))).toBe(
      'Unterschrieben wird ein vollständiges Protokoll: Brandschutztür fehlt.',
    )
  })
})
