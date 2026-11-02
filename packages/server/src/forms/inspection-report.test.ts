import type { FormDefinition, IsoDate } from '@opengewerk/domain'
import { elektroRegistry } from '@opengewerk/gewerk-elektro'
import { describe, expect, it } from 'vitest'

import { type LastTest, nextOf } from './appliance-report.js'
import {
  type InspectionReport,
  inspectionReportJob,
  inspectionResult,
} from './inspection-report.js'

/**
 * The result of the whole in the test of the electrical installation (#302):
 * defects where any last test found some, no defects only where everything is
 * tested, and the next day a test is due at the site.
 */

const recurring = elektroRegistry.definitionFor('vde-0105-100', 1) as FormDefinition
const appliance = elektroRegistry.definitionFor('dguv-v3', 1) as FormDefinition

function test(definition: FormDefinition, verdict: string, months: number, on: string): LastTest {
  return {
    definition,
    values: { verdict, next_inspection_months: months * 1000 },
    performedOn: on as IsoDate,
  }
}

function report(
  installations: readonly (LastTest | null)[],
  appliances: readonly (LastTest | null)[],
): InspectionReport {
  return {
    keeper: { name: 'Elektro Nord GmbH', phone: null },
    site: 'Rheinstraße 12',
    customer: '',
    on: '2026-11-02',
    installations: installations.map((last, index) => ({
      designation: `Anlage ${String(index + 1)}`,
      kind: 'Zählerschrank',
      last,
      next: last ? nextOf(last) : null,
      sooner: null,
    })),
    appliances: appliances.map((last, index) => ({
      appliance: {
        inventoryNumber: String(index + 1),
        designation: 'Bohrhammer',
        manufacturer: null,
        model: null,
        protectionClass: 'II',
        mobility: 'portable',
        location: null,
      },
      last,
    })),
  }
}

describe('the result of the test of the electrical installation', () => {
  it('finds no defects only where everything is tested and passed', () => {
    const passed = test(recurring, 'passed', 48, '2026-11-02')

    expect(inspectionResult(report([passed], [])).verdict).toBe('Keine Mängel festgestellt')
    expect(inspectionResult(report([passed], [null])).verdict).toBe('Noch nicht alles geprüft')
    expect(inspectionResult(report([null], [null])).verdict).toBe('Noch nichts geprüft')
    expect(
      inspectionResult(report([passed, null], [test(appliance, 'defects', 12, '2026-11-02')])),
    ).toMatchObject({ verdict: 'Mängel festgestellt', defects: true })
  })

  it('counts each kind and names the earliest next test at the site', () => {
    const result = inspectionResult(
      report(
        [test(recurring, 'passed', 48, '2026-11-02')],
        [test(appliance, 'passed', 6, '2026-11-02'), test(appliance, 'passed', 12, '2026-11-02')],
      ),
    )

    expect(result.lines).toEqual([
      '1 Anlage: 1 ohne Mängel, 0 mit Mängeln, 0 noch nicht geprüft. 2 Geräte: 2 ohne Mängel, 0 mit Mängeln, 0 noch nicht geprüft.',
      'Nächste Prüfung am Objekt: 02.05.2027.',
    ])
    expect(inspectionResult(report([null], [])).lines).toEqual([
      '1 Anlage: 0 ohne Mängel, 0 mit Mängeln, 1 noch nicht geprüft. Kein Gerät.',
    ])
    expect(inspectionResult(report([], [null, null])).lines).toEqual([
      'Keine Anlage. 2 Geräte: 0 ohne Mängel, 0 mit Mängeln, 2 noch nicht geprüft.',
    ])
  })

  it('marks defects on the page and names the test of an installation by its form', () => {
    const { html, landscape } = inspectionReportJob(
      report([test(recurring, 'defects', 48, '2026-11-02')], []),
    )

    expect(landscape).toBe(true)
    expect(html).toContain('<p class="verdict outside">Ergebnis: Mängel festgestellt</p>')
    expect(html).toContain('<td>Wiederholungsprüfung nach DIN VDE 0105-100</td>')
    expect(html).toContain('<span class="outside">Mängel festgestellt</span>')
    expect(html).toContain('<td class="figure">02.11.2030</td>')
    expect(html).toContain('Die Protokolle der Anlagen folgen auf den nächsten Seiten')
  })
})
