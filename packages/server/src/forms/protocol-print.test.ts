import { type FormDefinition, ruleSet } from '@opengewerk/domain'
import { elektroRegistry, elektroRules } from '@opengewerk/gewerk-elektro'
import { describe, expect, it } from 'vitest'

import { protocolPrintJob, type PrintedProtocol } from './protocol-print.js'

// One rule, measured against in two ways: a value may reach it, or it has to
// stay under it (opengewerk-haustechnik#93).
const definition: FormDefinition = {
  key: 'probe_protocol',
  version: 1,
  title: 'Probe',
  attachesTo: 'installation',
  sections: [
    {
      key: 'values',
      title: 'Werte',
      fields: [
        {
          kind: 'group',
          key: 'points',
          label: 'Messstellen',
          repeat: 'free',
          fields: [
            {
              kind: 'measurement',
              key: 'reached',
              label: 'Darf ihn erreichen',
              unit: 'volt',
              decimals: 0,
              limit: { kind: 'at_most', rule: 'probe.voltage' },
            },
            {
              kind: 'measurement',
              key: 'under',
              label: 'Bleibt unter ihm',
              unit: 'volt',
              decimals: 0,
              limit: { kind: 'below', rule: 'probe.voltage' },
            },
          ],
        },
      ],
    },
  ],
}

const protocol: PrintedProtocol = {
  definition,
  values: {
    points: [{ circuitId: null, circuit: null, values: { reached: 50_000, under: 50_000 } }],
  },
  performedOn: '2026-10-14',
  status: 'signed',
  keeper: { name: 'Probebetrieb', phone: null },
  installation: 'Probeanlage',
  appliance: null,
  site: '',
  rules: ruleSet([
    {
      key: 'probe.voltage',
      validFrom: '2026-01-01',
      validUntil: null,
      unit: 'volts',
      value: 50,
      source: 'Probevorschrift Nr. 1',
    },
  ]),
}

describe('the limits under a table of a printed protocol', () => {
  it('names a limit a value has to stay under as such, with the source of its rule', () => {
    const { html } = protocolPrintJob(protocol)

    expect(html).toContain(
      '<li><strong>Darf ihn erreichen:</strong> höchstens 50 V; Probevorschrift Nr. 1</li>',
    )
    expect(html).toContain(
      '<li><strong>Bleibt unter ihm:</strong> unter 50 V; Probevorschrift Nr. 1</li>',
    )
    // The same 50 V reach the first limit and stay within, and are outside the second.
    expect(html.match(/<td class="figure outside">50 !<\/td>/g)).toHaveLength(1)
  })
})

describe('the next inspection on a printed protocol (#301)', () => {
  const recurring = elektroRegistry.definitionFor('vde-0105-100', 1)

  it('stands beside its interval, counted from the day of the test', () => {
    expect(recurring).not.toBeNull()

    const { html } = protocolPrintJob({
      ...protocol,
      definition: recurring as FormDefinition,
      values: { next_inspection_months: 48_000 },
      performedOn: '2026-09-18',
      rules: elektroRules,
    })

    expect(html).toContain(
      '<tr><th>Prüffrist bis zur nächsten Prüfung</th><td>48 Mon., nächste Prüfung bis zum 18.09.2030</td></tr>',
    )
  })

  it('is left out where the interval is not filled in', () => {
    const { html } = protocolPrintJob({
      ...protocol,
      definition: recurring as FormDefinition,
      values: {},
      performedOn: '2026-09-18',
      rules: elektroRules,
    })

    expect(html).toContain('<tr><th>Prüffrist bis zur nächsten Prüfung</th><td></td></tr>')
    expect(html).not.toContain('nächste Prüfung bis')
  })

  it('stands on the first inspection of a new installation, and gives way after an extension (#814)', () => {
    const first = elektroRegistry.definitionFor('vde-0100-600', 3) as FormDefinition
    const printed = (occasion: string) =>
      protocolPrintJob({
        ...protocol,
        definition: first,
        values: { occasion, next_inspection_months: 48_000 },
        performedOn: '2026-11-02',
        rules: elektroRules,
      }).html

    expect(printed('new')).toContain(
      '<tr><th>Prüffrist bis zur ersten Wiederholungsprüfung</th><td>48 Mon., nächste Prüfung bis zum 02.11.2030</td></tr>',
    )
    expect(printed('extension')).toContain(
      '<tr><th>Prüffrist bis zur ersten Wiederholungsprüfung</th><td>Nach einer Erweiterung oder Änderung bleibt die Frist der letzten Prüfung der Anlage stehen.</td></tr>',
    )
    expect(printed('change')).not.toContain('nächste Prüfung bis')
  })
})

describe('the test of an appliance on paper (#303)', () => {
  const test = elektroRegistry.definitionFor('dguv-v3', 1)
  const printed = (
    appliance: PrintedProtocol['appliance'],
    values: PrintedProtocol['values'],
  ): string =>
    protocolPrintJob({
      ...protocol,
      definition: test as FormDefinition,
      values,
      performedOn: '2026-11-02',
      installation: '002 Verlängerungsleitung 25 m, Schutzklasse I, Anschlussleitung 25 m',
      appliance,
      rules: elektroRules,
    }).html

  it('judges a value by the limit worked out of the appliance, and names it with its source', () => {
    expect(test).not.toBeNull()

    const lead = { protectionClass: 'I' as const, cordLengthMilli: 25_000 }

    // 0,3 Ω up to 5 m and 0,1 Ω for each of the three lengths of 7,5 m begun beyond.
    expect(printed(lead, { protective_conductor: 650 })).toContain(
      '0,65 Ω <span class="outside">außerhalb des Grenzwerts</span>',
    )
    expect(printed(lead, { protective_conductor: 600 })).not.toContain('außerhalb des Grenzwerts')
    expect(printed(lead, {})).toContain(
      '<strong>Schutzleiterwiderstand RPE:</strong> höchstens 0,60 Ω; DGUV Information 203-070',
    )
  })

  it('says why there is no limit where the protection class has no protective conductor', () => {
    expect(printed({ protectionClass: 'II', cordLengthMilli: null }, {})).toContain(
      '<strong>Schutzleiterwiderstand RPE:</strong> Ein Gerät dieser Schutzklasse hat keinen Schutzleiter.',
    )
    expect(printed({ protectionClass: 'II', cordLengthMilli: null }, {})).toContain(
      '<strong>Isolationswiderstand Riso:</strong> mindestens 2,00 MΩ; DGUV Information 203-070',
    )
  })
})
