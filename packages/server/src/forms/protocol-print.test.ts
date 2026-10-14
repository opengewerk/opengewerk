import { type FormDefinition, ruleSet } from '@opengewerk/domain'
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
