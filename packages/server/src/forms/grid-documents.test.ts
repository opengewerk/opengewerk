import type { IsoDate } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import {
  chargingApprovalText,
  type GridPapers,
  gridSections,
  marketRegisterDueOn,
  marketRegisterSections,
  sheetJob,
} from './grid-documents.js'
import { tradeRules } from './registry.js'

/**
 * The papers for a grid operator and the help for the register (#306), out of
 * what the server gathers: which questions stand there, and with what answer.
 */

function papers(over: Partial<GridPapers> = {}): GridPapers {
  return {
    keeper: {
      name: 'Elektro Nord GmbH',
      address: 'Hauptstraße 1, 68159 Mannheim',
      phone: null,
      email: null,
    },
    customer: {
      name: 'Familie Weber',
      address: 'Birkenweg 7, 69214 Eppelheim',
      phone: '06221 76 54 32',
      email: null,
      naturalPerson: true,
      vatId: null,
    },
    site: { designation: 'Wohnhaus', address: 'Birkenweg 7, 69214 Eppelheim' },
    installation: {
      kind: 'pv_system',
      designation: 'PV-Anlage Dach',
      maker: null,
      serialNumber: null,
      capacityWh: null,
      ratingW: null,
    },
    operator: { name: 'Stadtwerke Neckartal Netze GmbH', portalUrl: null, requirements: null },
    reference: 'SNN-2026-04711',
    registration: null,
    modules: { count: 24, makers: ['JA Solar JAM54S30-400/MR'], ratedPowerW: 9600 },
    inverters: [
      {
        designation: 'WR 1',
        maker: 'Fronius Symo GEN24 10.0 Plus',
        serialNumber: null,
        ratedPowerW: 10_000,
        capacityWh: null,
        ratingW: null,
        inverter: null,
        commissionedOn: null,
      },
    ],
    batteries: [],
    meters: [],
    wallboxes: [],
    charging: null,
    strings: [{ azimuthDeg: 180, tiltDeg: 30, modules: 24, ratedPowerW: 9600 }],
    commissionedOn: '2026-11-02' as IsoDate,
    protocols: [],
    ...over,
  }
}

function questions(of: GridPapers): readonly string[] {
  return marketRegisterSections(of).flatMap((section) => section.rows.map(([question]) => question))
}

function answer(of: GridPapers, question: string): string | null | undefined {
  return marketRegisterSections(of)
    .flatMap((section) => section.rows)
    .find(([asked]) => asked === question)?.[1]
}

describe('the deadline of the operator', () => {
  it('is a month after the commissioning, as the rule of that day says', () => {
    expect(marketRegisterDueOn('2026-11-02' as IsoDate, tradeRules)).toBe('2026-12-02')
    // The end of a month carries over to the last day of the next (§ 188 Abs. 3 BGB).
    expect(marketRegisterDueOn('2027-01-31' as IsoDate, tradeRules)).toBe('2027-02-28')
  })

  it('is unknown without a day of the commissioning, and before the MaStRV', () => {
    expect(marketRegisterDueOn(null, tradeRules)).toBeNull()
    expect(marketRegisterDueOn('2017-06-30' as IsoDate, tradeRules)).toBeNull()
  })
})

describe('the questions of the register', () => {
  it('ask a natural person for the day of birth, and an organisation for its legal form', () => {
    expect(questions(papers())).toContain('Geburtsdatum')
    expect(questions(papers())).not.toContain('Rechtsform')

    const firm = papers({
      customer: {
        ...papers().customer,
        name: 'Hausverwaltung Süd GmbH',
        naturalPerson: false,
        vatId: 'DE123456789',
      },
    })

    expect(questions(firm)).toContain('Rechtsform')
    expect(questions(firm)).not.toContain('Geburtsdatum')
    expect(answer(firm, 'USt-IdNr.')).toBe('DE123456789')
  })

  it('name the direct marketer from 25 kW on, by the inverters', () => {
    expect(questions(papers())).not.toContain('Fernsteuerbarkeit durch den Direktvermarkter')

    const larger = papers({
      inverters: [{ ...papers().inverters[0]!, ratedPowerW: 25_000 }],
    })

    expect(questions(larger)).toContain('Fernsteuerbarkeit durch den Direktvermarkter')
    expect(questions(larger)).not.toContain('W-EIC')
  })

  it('ask about the control and the limit only of a unit put into operation before 2023', () => {
    expect(questions(papers())).not.toContain('Leistungsbegrenzung')
    expect(questions(papers({ commissionedOn: '2022-12-31' as IsoDate }))).toContain(
      'Leistungsbegrenzung',
    )
  })

  it('answer the orientations out of the strings, and say when there is no second one', () => {
    expect(answer(papers(), 'Hauptausrichtung und Neigung')).toBe(
      'Süd, 180°, Neigung 30°, 24 Module',
    )
    expect(answer(papers(), 'Nebenausrichtung und Neigung')).toBe('keine')
    expect(answer(papers({ strings: [] }), 'Nebenausrichtung und Neigung')).toBeNull()
  })

  it('ask about a battery of its own as a unit, DC coupled only where it hangs at an inverter', () => {
    const own = papers({
      installation: {
        kind: 'battery',
        designation: 'Speicher Keller',
        maker: 'BYD',
        serialNumber: null,
        capacityWh: null,
        ratingW: null,
      },
      modules: { count: 0, makers: [], ratedPowerW: null },
      inverters: [],
      strings: [],
    })

    expect(questions(own)).not.toContain('Bruttoleistung der Module')
    expect(answer(own, 'Name der Einheit')).toBe('Speicher Keller, Wohnhaus')
    expect(answer(own, 'AC- oder DC-gekoppelt')).toBeNull()

    const hanging = papers({
      batteries: [
        {
          designation: 'Speicher Technikraum',
          maker: null,
          serialNumber: null,
          ratedPowerW: null,
          capacityWh: null,
          ratingW: null,
          inverter: 'WR 1',
          commissionedOn: null,
        },
      ],
    })

    expect(answer(hanging, 'AC- oder DC-gekoppelt')).toBe('DC-gekoppelt, am WR 1')
  })
})

describe('the application and the completion', () => {
  it('leave a line for the entry where none holds, and ask the planned day only in the application', () => {
    const rows = gridSections(papers(), false).flatMap((section) => section.rows)

    expect(rows.find(([asked]) => asked === 'Installateurverzeichnis')?.[1]).toBeNull()
    expect(rows.map(([asked]) => asked)).toContain('Geplante Inbetriebnahme')
    expect(
      gridSections(papers(), true)
        .flatMap((section) => section.rows)
        .map(([asked]) => asked),
    ).not.toContain('Geplante Inbetriebnahme')
  })

  it('sum the inverters only where every one names its power', () => {
    const unknown = papers({
      inverters: [
        ...papers().inverters,
        { ...papers().inverters[0]!, designation: 'WR 2', ratedPowerW: null },
      ],
    })
    const rows = gridSections(unknown, false).flatMap((section) => section.rows)

    expect(rows.find(([asked]) => asked === 'Wechselrichterleistung zusammen')?.[1]).toBeNull()
  })
})

describe('the consent of the grid operator to wallboxes (#307, § 19 Abs. 2 NAV)', () => {
  const limit = 12_000

  it('is needed above 12 kVA of all wallboxes at the site, and a notice is enough up to them', () => {
    expect(chargingApprovalText({ totalW: 22_000, approvalAboveW: limit })).toBe(
      'nötig: 22 kVA Summen-Bemessungsleistung der Wallboxen am Objekt, über 12 kVA (§ 19 Abs. 2 NAV)',
    )
    expect(chargingApprovalText({ totalW: 12_000, approvalAboveW: limit })).toBe(
      'nicht nötig, die Mitteilung reicht: 12 kVA Summen-Bemessungsleistung der Wallboxen am Objekt, bis 12 kVA (§ 19 Abs. 2 NAV)',
    )
  })

  it('is a line to write on where a wallbox names no power, and stands only where the papers name a wallbox', () => {
    expect(chargingApprovalText({ totalW: null, approvalAboveW: limit })).toBeNull()
    expect(chargingApprovalText(null)).toBeNull()
  })
})

describe('a sheet of the office (#310)', () => {
  it('brings the typeface of every report into its page, without which the renderer leaves out the footer', () => {
    const job = sheetJob(
      'Aufforderung zur Abnahme',
      '<p>Text</p>',
      'Aufforderung zur Abnahme, 03.11.2026',
    )

    expect(job.html).toContain('@font-face')
    expect(job.footerHtml).toContain('Aufforderung zur Abnahme, 03.11.2026')
  })
})
