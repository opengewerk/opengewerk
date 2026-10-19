import { describe, expect, it } from 'vitest'

import { type ChartBoard, type ChartCircuit, circuitChartJob } from './circuit-chart.js'

// The circuit chart as a page to print (ADR 0014), asked of the HTML it
// hands the renderer. What a route of an application puts into it, and that
// a PDF comes out, the tests of that route hold.

const nothing: ChartCircuit = {
  designation: 'F1',
  consumer: null,
  overcurrentDevice: null,
  tripCharacteristic: null,
  ratedCurrentMilli: null,
  rcdType: null,
  ratedResidualCurrentMilli: null,
  cableType: null,
  cableCores: null,
  cableCrossSectionMilli: null,
  cableLengthMilli: null,
  cableInstallationMethod: null,
}

const board = (groups: ChartBoard['groups']): ChartBoard => ({
  designation: 'UV 1',
  kind: 'sub_distribution',
  location: 'Keller',
  changedOn: '2026-10-19',
  groups,
})

const chart = (boards: readonly ChartBoard[]) =>
  circuitChartJob({
    keeper: { name: 'Muster & Co', phone: '0000 123' },
    installation: 'Elektroinstallation Wohnhaus',
    site: 'Hauptstraße 1, 12345 Musterstadt',
    boards,
  })

describe('the circuit chart', () => {
  it('is landscape, one board to a page, with who keeps it and how current it is', () => {
    const job = chart([board([{ section: null, circuits: [nothing] }]), board([])])

    expect(job.landscape).toBe(true)
    expect(job.html.match(/<section class="board">/g)).toHaveLength(2)
    expect(job.html).toContain('Muster &amp; Co')
    expect(job.html).toContain('Telefon 0000 123')
    expect(job.html).toContain('Stand 19.10.2026')
    expect(job.html).toContain('Elektroinstallation Wohnhaus, Hauptstraße 1, 12345 Musterstadt')
    expect(job.footerHtml).toContain('Stromkreisverzeichnis, Elektroinstallation Wohnhaus')
  })

  it('heads every section, and the circuits on the board itself, only when the board has sections', () => {
    const sectioned = chart([
      board([
        { section: 'Feld 1', circuits: [nothing] },
        { section: null, circuits: [{ ...nothing, designation: 'F9' }] },
      ]),
    ])
    const plain = chart([board([{ section: null, circuits: [nothing] }])])

    expect(sectioned.html).toContain('Feld 1')
    expect(sectioned.html).toContain('Ohne Feld')
    expect(plain.html).not.toContain('class="section"')
  })

  it('escapes what somebody typed, and leaves a cell empty where nothing is known', () => {
    const job = chart([
      board([{ section: null, circuits: [{ ...nothing, consumer: '<b>Herd</b>' }] }]),
    ])

    expect(job.html).toContain('&lt;b&gt;Herd&lt;/b&gt;')
    expect(job.html).not.toContain('<b>Herd</b>')
    const dashes = ['-', String.fromCharCode(0x2013), String.fromCharCode(0x2014)]
    expect(dashes.some((dash) => job.html.includes(`>${dash}</td>`))).toBe(false)
  })

  it('says a board without circuits has none, and an installation without boards has none', () => {
    expect(chart([board([])]).html).toContain(
      'Für diesen Verteiler ist noch kein Stromkreis erfasst.',
    )
    expect(chart([]).html).toContain('Elektroinstallation Wohnhaus hat noch keinen Verteiler.')
  })
})
