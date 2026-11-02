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

  it('stands on the first inspection of a new installation, and only where it is sooner after an extension (#814, #822)', () => {
    const first = elektroRegistry.definitionFor('vde-0100-600', 3) as FormDefinition
    const printed = (occasion: string, months?: number) =>
      protocolPrintJob({
        ...protocol,
        definition: first,
        values: {
          occasion,
          ...(months === undefined ? {} : { next_inspection_months: months * 1000 }),
        },
        performedOn: '2026-11-02',
        rules: elektroRules,
      }).html

    expect(printed('new', 48)).toContain(
      '<tr><th>Prüffrist bis zur ersten Wiederholungsprüfung</th><td>48 Mon., nächste Prüfung bis zum 02.11.2030</td></tr>',
    )
    expect(printed('extension', 12)).toContain(
      '<tr><th>Prüffrist bis zur ersten Wiederholungsprüfung</th><td>12 Mon., nächste Prüfung bis zum 02.11.2027, wenn die Frist der letzten Prüfung der Anlage nicht früher endet</td></tr>',
    )
    expect(printed('change')).toContain(
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

describe('the commissioning protocol after VDE-AR-N 4105 on paper (#304)', () => {
  const commissioning = elektroRegistry.definitionFor('vde-ar-n-4105', 1)

  it('names the day of the commissioning, the power and the day the system first ran with the grid', () => {
    expect(commissioning).not.toBeNull()

    const { html } = protocolPrintJob({
      ...protocol,
      definition: commissioning as FormDefinition,
      values: {
        operator: 'Familie Berger\nLindenweg 4, 68535 Edingen-Neckarhausen',
        apparent_power: 9500,
        module_power: 9460,
        feed_in_limit: 70_000,
        grid_parallel_on: '2026-11-04',
      },
      performedOn: '2026-11-02',
      rules: elektroRules,
    })

    expect(html).toContain('<p class="where">In Betrieb gesetzt am 02.11.2026</p>')
    expect(html).not.toContain('Geprüft am')
    expect(html).toContain(
      '<tr><th>Anlagenbetreiber</th><td>Familie Berger<br>Lindenweg 4, 68535 Edingen-Neckarhausen</td></tr>',
    )
    expect(html).toContain('<tr><th>Maximale Scheinleistung SAmax</th><td>9,50 kVA</td></tr>')
    expect(html).toContain('<tr><th>Modulleistung</th><td>9,46 kWp</td></tr>')
    expect(html).toContain('<tr><th>Erster Netzparallelbetrieb</th><td>04.11.2026</td></tr>')
    // 70 % is over the limit of the Solarspitzengesetz, which is named with its source.
    expect(html).toContain(
      '<tr><th>Begrenzung der Einspeisung</th><td>70 % <span class="outside">außerhalb des Grenzwerts</span></td></tr>',
    )
    expect(html).toContain(
      '<strong>Begrenzung der Einspeisung:</strong> höchstens 60 %; § 9 Abs. 2',
    )
    expect(html).toContain('<tr><th>Unterschrift des Anlagenbetreibers</th>')
    expect(html).toContain('<tr><th>Unterschrift des Elektrofachbetriebs</th>')
  })
})
