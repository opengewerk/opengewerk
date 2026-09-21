import {
  type ContentSources,
  documentContent,
  type IssuerContent,
  type LineContent,
  type SignatureContent,
  shippedRules,
} from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { printJob } from './template.js'

/**
 * The template, without a renderer. What can be checked on the HTML is what
 * the law and the customer read: which figures stand there, which sentences,
 * and that nothing a person typed can become markup. Where it all lands on
 * the page is checked against the real renderer, by eye.
 */

const issuer: IssuerContent = {
  name: 'Elektro Nord GmbH',
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  phone: '040 1234567',
  email: 'buero@elektro-nord.example',
  website: null,
  taxNumber: '22/815/08154',
  vatId: 'DE123456789',
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  bankName: 'Commerzbank',
  registerCourt: 'Amtsgericht Hamburg',
  registerNumber: 'HRB 12345',
  managingDirectors: 'Geschäftsführer: Max Nord',
  logo: null,
}

function line(position: number, netCents: number, over: Partial<LineContent> = {}): LineContent {
  return {
    kind: 'item',
    position,
    designation: 'Unterverteilung setzen',
    description: null,
    quantityMilli: 1000,
    unit: 'flat_rate',
    unitPriceCents: netCents,
    vatRate: 'standard',
    netCents,
    ...over,
  }
}

function page(
  document: Partial<ContentSources['document']> = {},
  parts: {
    readonly lines?: readonly LineContent[]
    readonly country?: string
    readonly signature?: SignatureContent | null
  } = {},
) {
  const content = documentContent(shippedRules, {
    document: {
      kind: 'final_invoice',
      number: 'RE-2026-0042',
      documentDate: '2026-09-21',
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      subject: 'Zählerschrank erneuert',
      introText: null,
      closingText: null,
      taxTreatment: 'standard',
      ...document,
    },
    lines: parts.lines ?? [line(1, 100000)],
    issuer,
    recipient: {
      name: 'Familie Berg',
      street: 'Lindenweg',
      houseNumber: '3',
      postalCode: '22301',
      city: 'Hamburg',
      country: parts.country ?? 'DE',
      isBusiness: false,
    },
    site: null,
    signature: parts.signature ?? null,
  })

  return printJob(content, { logo: null })
}

describe('the page', () => {
  it('carries the number, the dates and the totals of an ordinary invoice', () => {
    const { html } = page()

    expect(html).toContain('<h1>Schlussrechnung RE-2026-0042</h1>')
    expect(html).toContain('<th>Rechnungsnummer</th><td>RE-2026-0042</td>')
    expect(html).toContain('<th>Datum</th><td>21.09.2026</td>')
    expect(html).toContain('<th>Leistungszeitraum</th><td>01.09.2026 bis 15.09.2026</td>')
    expect(html).toMatch(/Umsatzsteuer 19 % auf 1\.000,00\s€<\/td><td class="figure">190,00\s€/)
    expect(html).toMatch(/Gesamtbetrag<\/td><td class="figure">1\.190,00\s€/)
  })

  it('names a single day as a date of service rather than a period', () => {
    const { html } = page({ serviceUntil: null })

    expect(html).toContain('<th>Leistungsdatum</th><td>01.09.2026</td>')
  })

  it('breaks the tax down by rate, each with the amount it is on', () => {
    const { html } = page({}, { lines: [line(1, 80000), line(2, 20000, { vatRate: 'reduced' })] })

    expect(html).toMatch(/Umsatzsteuer 7 % auf 200,00\s€<\/td><td class="figure">14,00\s€/)
    expect(html).toMatch(/Umsatzsteuer 19 % auf 800,00\s€<\/td><td class="figure">152,00\s€/)
  })

  it('shows no tax at all under section 19, and says why', () => {
    const { html } = page({ taxTreatment: 'small_business' })

    expect(html).not.toContain('Umsatzsteuer 19 %')
    expect(html).not.toContain('<th class="figure">USt.</th>')
    expect(html).toMatch(/Gesamtbetrag<\/td><td class="figure">1\.000,00\s€/)
    expect(html).toContain('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')
  })

  it('writes the country of a foreign customer, in capitals, and not the home one', () => {
    expect(page({}, { country: 'AT' }).html).toContain('22301 Hamburg<br>ÖSTERREICH')
    expect(page().html).not.toContain('DEUTSCHLAND')
  })

  it('turns everything a person typed into text, never into markup', () => {
    const { html } = page(
      { subject: '<img src=x onerror=alert(1)>' },
      { lines: [line(1, 100000, { designation: '<script>alert("Rechnung")</script>' })] },
    )

    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(&quot;Rechnung&quot;)&lt;/script&gt;')
  })

  it('brings its own font, so the page does not depend on the renderer image', () => {
    const { html, footerHtml } = page()

    expect(html).toContain('src:url(data:font/woff2;base64,')
    expect(footerHtml).toContain('src:url(data:font/woff2;base64,')
  })
})

/** A title among the lines: a heading with no amount. */
function title(position: number, designation: string): LineContent {
  return line(position, 0, {
    kind: 'title',
    designation,
    quantityMilli: 0,
    unitPriceCents: 0,
  })
}

describe('titles and document texts', () => {
  const quote = { kind: 'quote', number: 'AN-2026-0007', serviceFrom: null } as const

  it('lays the lines out under their titles, numbered and summed per title', () => {
    const { html } = page(quote, {
      lines: [
        title(1, 'Zählerschrank'),
        line(2, 120000),
        line(3, 30000, { designation: 'Überspannungsschutz' }),
        title(4, 'Außenbeleuchtung'),
        line(5, 45000, { designation: 'Wandleuchten montieren' }),
      ],
    })

    expect(html).toMatch(
      /<tr class="title">\s*<td class="position">1<\/td>\s*<td colspan="5">Zählerschrank/,
    )
    expect(html).toMatch(/<td class="position">1\.1<\/td>\s*<td>Unterverteilung setzen/)
    expect(html).toMatch(/<td class="position">1\.2<\/td>\s*<td>Überspannungsschutz/)
    expect(html).toMatch(/<td class="position">2\.1<\/td>\s*<td>Wandleuchten montieren/)
    expect(html).toMatch(/Summe Titel 1: Zählerschrank<\/td>\s*<td class="figure">1\.500,00\s€/)
    expect(html).toMatch(/Summe Titel 2: Außenbeleuchtung<\/td>\s*<td class="figure">450,00\s€/)
    // A title is a heading, and the total is what the positions add up to.
    expect(html).toMatch(/Summe netto<\/td><td class="figure">1\.950,00\s€/)
  })

  it('numbers a document without titles plainly and prints no section sums', () => {
    const { html } = page(quote, { lines: [line(1, 1000), line(2, 2000)] })

    expect(html).toMatch(/<td class="position">2<\/td>/)
    expect(html).not.toContain('Summe Titel')
    expect(html).not.toContain('class="title"')
  })

  it('prints the text above the lines and the one below the notes, as written', () => {
    const { html } = page({
      ...quote,
      taxTreatment: 'small_business',
      introText: 'Sehr geehrte Familie Berg,\nvielen Dank für Ihre Anfrage.',
      closingText: 'Wir freuen uns auf Ihren Auftrag. <b>Gültig vier Wochen.</b>',
    })

    expect(html).toContain(
      '<div class="text intro">Sehr geehrte Familie Berg,\nvielen Dank für Ihre Anfrage.</div>',
    )
    expect(html).toContain('&lt;b&gt;Gültig vier Wochen.&lt;/b&gt;')

    const order = [
      html.indexOf('class="text intro"'),
      html.indexOf('<table class="lines">'),
      html.indexOf('Gemäß § 19 UStG'),
      html.indexOf('class="text closing"'),
    ]

    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('leaves both texts out when there are none', () => {
    const { html } = page(quote)

    expect(html).not.toContain('class="text intro"')
    expect(html).not.toContain('class="text closing"')
  })
})

describe('a draft', () => {
  it('says so, has no number yet, and carries the mark across the page', () => {
    const { html } = page({ number: null })

    expect(html).toContain('<h1>Schlussrechnung (Entwurf)</h1>')
    expect(html).toContain('<th>Rechnungsnummer</th><td>folgt beim Festschreiben</td>')
    expect(html).toContain('<div class="draft">ENTWURF</div>')
  })
})

describe('the footer', () => {
  it('has the business, how to reach it, its tax numbers and its bank, and the page count', () => {
    const { footerHtml } = page()

    expect(footerHtml).toContain('Elektro Nord GmbH<br>Hafenstraße 12<br>20457 Hamburg')
    expect(footerHtml).toContain('Steuernummer 22/815/08154<br>USt-IdNr. DE123456789')
    expect(footerHtml).toContain('Amtsgericht Hamburg, HRB 12345')
    expect(footerHtml).toContain('IBAN DE89 3704 0044 0532 0130 00')
    expect(footerHtml).toContain(
      'Seite <span class="pageNumber"></span> von <span class="totalPages"></span>',
    )
  })

  it('leaves out a column that would be empty', () => {
    const content = documentContent(shippedRules, {
      document: {
        kind: 'quote',
        number: 'AN-2026-0001',
        documentDate: '2026-09-21',
        serviceFrom: null,
        serviceUntil: null,
        subject: null,
        introText: null,
        closingText: null,
        taxTreatment: 'standard',
      },
      lines: [line(1, 1000)],
      issuer: { ...issuer, phone: null, email: null, website: null },
      recipient: {
        name: 'Familie Berg',
        street: null,
        houseNumber: null,
        postalCode: null,
        city: null,
        country: 'DE',
        isBusiness: false,
      },
      site: null,
      signature: null,
    })

    const { footerHtml } = printJob(content, { logo: null })

    expect(footerHtml).not.toContain('Telefon')
    expect(footerHtml.match(/class="column"/g)).toHaveLength(3)
  })
})

describe('a report', () => {
  const signed: SignatureContent = {
    signerName: 'Erika Berg',
    // 12:32 in UTC is 14:32 in Hamburg in September.
    signedAt: '2026-09-21T12:32:00.000Z',
    path: 'M100,300L200,120L300,280L400,100',
  }
  const worked = [
    line(1, 0, {
      designation: 'Arbeitszeit',
      quantityMilli: 2500,
      unit: 'hour',
      unitPriceCents: 0,
      netCents: 0,
    }),
    line(2, 0, {
      designation: 'LS-Schalter B16',
      quantityMilli: 2000,
      unit: 'piece',
      unitPriceCents: 0,
      netCents: 0,
    }),
  ]

  function report(signature: SignatureContent | null = signed) {
    return page(
      {
        kind: 'time_and_material_report',
        number: null,
        serviceFrom: null,
        serviceUntil: null,
        introText: 'Zwei Leitungsschutzschalter im Keller getauscht.',
        taxTreatment: 'small_business',
      },
      { lines: worked, signature },
    )
  }

  it('is printed with what was done and how much, and without a single price', () => {
    const { html } = report()

    expect(html).toMatch(/2,5\sStd\./)
    expect(html).toContain('LS-Schalter B16')
    expect(html).not.toContain('Einzelpreis')
    expect(html).not.toContain('Gesamtbetrag')
    // Nor the note on section 19, which would explain figures that are not there.
    expect(html).not.toContain('§ 19 UStG')
  })

  it('carries the signature, with who signed and when, and calls itself final', () => {
    const { html } = report()

    expect(html).toContain('<path d="M100,300L200,120L300,280L400,100"')
    expect(html).toMatch(/Erika Berg, 21\.09\.2026, 14:32 Uhr/)
    expect(html).toContain('<h1>Regiebericht</h1>')
    expect(html).not.toContain('class="draft"')
  })

  it('leaves out a picture that is not a path this system draws, and keeps the name', () => {
    const { html } = report({ ...signed, path: 'M1,1"/><script>alert(1)</script>' })

    expect(html).not.toContain('<svg class="signature-picture"')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('Erika Berg')
  })

  it('is a draft as long as nobody signed it', () => {
    const { html } = report(null)

    expect(html).toContain('<h1>Regiebericht (Entwurf)</h1>')
    expect(html).toContain('<div class="draft">ENTWURF</div>')
  })
})
