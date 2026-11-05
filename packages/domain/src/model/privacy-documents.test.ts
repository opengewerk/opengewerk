import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { type DeletionSettings, describeDeletion, erasureWhen } from './deletion-concept.js'
import { describeMeasures, measuresPartA, MeasuresTemplateError } from './measures-document.js'
import {
  describeRecord,
  type ProcessingActivityKey,
  processingActivities,
  type ProcessingRecordInputs,
  recipientsFor,
  recordText,
} from './processing-record.js'

/**
 * The three documents on data protection (#319) as Markdown: the record names
 * only what the business uses and prints what the owner typed as text; the
 * measures fill each place of the template once; the deletion concept says
 * what the business set.
 */

const nothingWritten: ProcessingRecordInputs = {
  controller: null,
  officer: null,
  outside: null,
  activities: {},
}

const always = new Set(
  processingActivities
    .filter((activity) => activity.uses === 'always')
    .map((activity) => activity.key as ProcessingActivityKey),
)

function record(inputs: ProcessingRecordInputs, used: ReadonlySet<ProcessingActivityKey> = always) {
  return describeRecord({
    business: 'Elektro Nord GmbH',
    at: 'am 05.11.2026 um 10:40',
    inputs,
    proposedController: 'Elektro Nord GmbH\nHauptstraße 103, 68535 Edingen',
    used,
  })
}

describe('the record of the processing', () => {
  it('names only the activities the business uses, numbered in their order', () => {
    const made = record(nothingWritten)

    expect(made).toContain('### 3.1 Konten, Anmeldung und Zugänge')
    expect(made).toContain('### 3.2 Kunden, Ansprechpartner und Verlauf')
    expect(made).not.toContain('Leads und Vertrieb')
    expect(made).not.toContain('Kalender-Abo')
    expect(record(nothingWritten, new Set([...always, 'prospects']))).toContain(
      '### 3.3 Leads und Vertrieb',
    )
  })

  it('proposes the letterhead and the purposes until the owner confirms them', () => {
    const made = record(nothingWritten)

    expect(made).toContain(
      '- **Verantwortlicher:** Elektro Nord GmbH, Hauptstraße 103, 68535 Edingen (aus dem Briefkopf, nicht bestätigt)',
    )
    expect(made).toContain('- **Datenschutzbeauftragter:** keiner angegeben')
    expect(made).toContain('(Vorschlag der Anwendung, nicht bestätigt)')
    expect(made).not.toContain('## 4. Verarbeitungen außerhalb von OpenGewerk')
  })

  it('prints what the owner typed as text, never as Markdown', () => {
    const made = record({
      controller: '# Elektro **Nord**',
      officer: 'Datenschutz | Nord',
      outside: 'Lohn bei [DATEV](https://datev.example)\n\n- Steuerberatung',
      activities: {
        customers: { purpose: '*Kunden*', legalBasis: 'Art. 6 <b>', recipients: 'Mailo\nPost' },
      },
    })

    expect(made).toContain('- **Verantwortlicher:** \\# Elektro \\*\\*Nord\\*\\*')
    expect(made).toContain('- **Datenschutzbeauftragter:** Datenschutz \\| Nord')
    expect(made).toContain('- Lohn bei \\[DATEV\\](https://datev.example)')
    expect(made).toContain('- - Steuerberatung')
    expect(made).toContain('- **Zweck:** \\*Kunden\\*')
    expect(made).toContain('- **Rechtsgrundlage:** Art. 6 \\<b\\>')
    expect(made).toContain('- **Empfänger:** Mailo, Post')
  })

  it('gives the answer to a request for access the recipients of what concerns the person', () => {
    const inputs = {
      activities: {
        mail: { purpose: null, legalBasis: null, recipients: 'Mailo GmbH\n\nPost AG' },
        staff: { purpose: null, legalBasis: null, recipients: 'Lohnbüro Meyer' },
        customers: { purpose: null, legalBasis: null, recipients: 'Post AG' },
      },
    }
    const used = new Set<ProcessingActivityKey>([...always, 'mail', 'staff'])

    expect(recipientsFor('customer', inputs, used)).toEqual(['Post AG', 'Mailo GmbH'])
    expect(recipientsFor('person', inputs, used)).toEqual([
      'Lohnbüro Meyer',
      'Mailo GmbH',
      'Post AG',
    ])
    // An activity the business does not use names nobody.
    expect(recipientsFor('person', inputs, always)).toEqual([])
  })

  it('keeps a text without spaces around it, an empty one as none, and refuses a long one', () => {
    expect(recordText('  Nord\r\nGmbH ', 'Zweck')).toBe('Nord\nGmbH')
    expect(recordText('   ', 'Zweck')).toBeNull()
    expect(recordText(undefined, 'Zweck')).toBeNull()
    expect(recordText(3, 'Zweck')).toEqual({ problem: '„Zweck“ ist ein Text.' })
    expect(recordText('x'.repeat(2001), 'Zweck')).toEqual({
      problem: '„Zweck“: höchstens 2.000 Zeichen.',
    })
  })
})

const template = `# Maßnahmen{{for}}

- **Erzeugt:** {{made}}

---

Teil B; {{part-b-changed}}.

## Teil A: Was die Anwendung mitbringt

- Argon2id

## Teil B: Beim Betrieb

{{part-b}}

## Anlage 2: Unterauftragsverarbeiter

{{subprocessors}}
`

describe('the technical and organisational measures', () => {
  const made = {
    business: 'Elektro **Nord**',
    at: 'am 05.11.2026 um 10:40',
    measures: { serverPlace: 'Deutschland, Nürnberg', entryOwnRoom: true },
    subprocessors: [{ name: 'Hetzner | Online', service: 'Server', place: 'Nürnberg' }],
    changedAt: 'am 02.11.2026',
  }

  it('fill every place of the template with part B and annex 2 of the instance', () => {
    const filled = describeMeasures(template, made)

    expect(filled).toContain('# Maßnahmen für Elektro \\*\\*Nord\\*\\*')
    expect(filled).toContain('Teil B; hier zuletzt geändert am 02.11.2026.')
    expect(filled).toContain('- Land und Ort des Servers: Deutschland, Nürnberg')
    expect(filled).toContain('- Ja: eigener Raum, verschlossen')
    expect(filled).toContain('- Nein: Anmeldung am Server nur mit Schlüssel, nicht mit Passwort')
    expect(filled).toContain('| Hetzner \\| Online | Server | Nürnberg |')
    expect(filled).not.toContain('{{')
  })

  it('say that part B is not filled in while it never was', () => {
    const filled = describeMeasures(template, { ...made, changedAt: null, subprocessors: [] })

    expect(filled).toContain('Teil B; hier sind sie noch nicht ausgefüllt.')
    expect(filled).toContain('hat Teil B noch nicht ausgefüllt')
    expect(filled).toContain('Keine eingetragen.')
  })

  it('refuse a template with a place there is none of, or a place twice or missing', () => {
    expect(() => describeMeasures(`${template}{{owner}}`, made)).toThrow(MeasuresTemplateError)
    expect(() => describeMeasures(`${template}{{made}}`, made)).toThrow('stands 2 times')
    expect(() => describeMeasures(template.replace('{{part-b}}', ''), made)).toThrow(
      'stands 0 times',
    )
  })

  it('give part A alone, as the page of the contract shows it', () => {
    expect(measuresPartA(template)).toBe('## Teil A: Was die Anwendung mitbringt\n\n- Argon2id')
    expect(() => measuresPartA('# Nichts')).toThrow(MeasuresTemplateError)
  })
})

describe('the deletion concept', () => {
  const settings: DeletionSettings = {
    prospectMonths: 18,
    customerMonths: 1,
    automatic: ['sickness'],
  }

  it('says when a kind falls due with the months the business set', () => {
    expect(erasureWhen('prospect', settings)).toBe(
      '18 Monate nach dem letzten Kontakt, wenn kein Kunde aus dem Lead geworden ist',
    )
    expect(erasureWhen('customer', settings)).toContain('1 Monat nach dem letzten Kontakt')
  })

  it('says which kinds go by themselves, and keeps the periods with their source', () => {
    const made = describeDeletion({
      business: 'Elektro Nord GmbH',
      at: 'am 05.11.2026 um 10:40',
      on: '2026-11-05' as IsoDate,
      settings,
    })
    const rows = made.split('\n').filter((line) => line.startsWith('| '))
    const sickness = rows.find((line) => line.startsWith('| Krankheiten'))
    const prospect = rows.find((line) => line.startsWith('| Leads'))

    expect(sickness).toContain('von selbst, im Namen dessen, der es eingeschaltet hat')
    expect(prospect).toContain('| vorgeschlagen |')
    expect(made).toContain('§ 147')
    expect(made).toContain('## 4. Sicherungen')
  })
})
