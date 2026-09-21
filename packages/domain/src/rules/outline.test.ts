import { describe, expect, it } from 'vitest'

import type { DocumentContentV1, LineContent } from '../model/document-content.js'
import { deducts, documentKinds, successorsOf } from '../model/document.js'
import { currentContent } from './document-content.js'
import { outlineRows } from './outline.js'

/**
 * The outline is what a quote reads like: numbered, sectioned, with a sum
 * under each section. It is worked out rather than stored, and the paper and
 * the screen both call the same function, so these tests hold the numbering
 * for both.
 */

function item(designation: string, netCents: number): LineContent {
  return {
    kind: 'item',
    position: 0,
    designation,
    description: null,
    quantityMilli: 1000,
    unit: 'flat_rate',
    unitPriceCents: netCents,
    vatRate: 'standard',
    netCents,
  }
}

function title(designation: string): LineContent {
  return { ...item(designation, 0), kind: 'title', unit: 'flat_rate' }
}

function shape(rows: ReturnType<typeof outlineRows>) {
  return rows.map((row) =>
    row.row === 'subtotal'
      ? `Summe ${row.number}: ${String(row.netCents)}`
      : `${row.number} ${row.line.designation}`,
  )
}

describe('the outline of a document', () => {
  it('numbers positions 1, 2, 3 when there are no titles, and adds no sums', () => {
    expect(shape(outlineRows([item('Kabel', 100), item('Dose', 200)]))).toEqual([
      '1 Kabel',
      '2 Dose',
    ])
  })

  it('numbers titles and the positions under them, with a sum after each section', () => {
    const rows = outlineRows([
      title('Erdgeschoss'),
      item('Unterverteilung', 124000),
      item('Steckdosen', 18000),
      title('Obergeschoss'),
      item('Leitungen', 32000),
    ])

    expect(shape(rows)).toEqual([
      '1 Erdgeschoss',
      '1.1 Unterverteilung',
      '1.2 Steckdosen',
      'Summe 1: 142000',
      '2 Obergeschoss',
      '2.1 Leitungen',
      'Summe 2: 32000',
    ])
  })

  it('gives an empty title no sum, because a line of nothing tells a reader nothing', () => {
    expect(
      shape(outlineRows([title('Reserve'), title('Außenanlage'), item('Leuchte', 900)])),
    ).toEqual(['1 Reserve', '2 Außenanlage', '2.1 Leuchte', 'Summe 2: 900'])
  })

  it('keeps plain numbers for positions before the first title', () => {
    expect(
      shape(outlineRows([item('Anfahrt', 4500), title('Keller'), item('Leitung', 100)])),
    ).toEqual(['1 Anfahrt', '1 Keller', '1.1 Leitung', 'Summe 1: 100'])
  })
})

describe('a snapshot written in the first shape', () => {
  it('reads as positions only, with no texts, and says exactly what it said', () => {
    const { kind: _kind, ...plain } = item('Unterverteilung', 124000)
    const first = {
      version: 1,
      kind: 'final_invoice',
      number: 'RE-2026-0001',
      documentDate: '2026-09-21',
      serviceFrom: '2026-09-01',
      serviceUntil: null,
      subject: null,
      taxTreatment: 'standard',
      issuer: {
        name: 'Elektro Nord GmbH',
        street: 'Hafenstraße',
        houseNumber: '12',
        postalCode: '20457',
        city: 'Hamburg',
        country: 'DE',
        phone: null,
        email: null,
        website: null,
        taxNumber: '22/815/08154',
        vatId: null,
        iban: null,
        bic: null,
        bankName: null,
        registerCourt: null,
        registerNumber: null,
        managingDirectors: null,
        logo: null,
      },
      recipient: {
        name: 'Familie Berg',
        street: 'Lindenweg',
        houseNumber: '3',
        postalCode: '22301',
        city: 'Hamburg',
        country: 'DE',
        isBusiness: false,
      },
      site: null,
      lines: [plain],
      totals: { netCents: 124000, taxCents: 23560, grossCents: 147560, byRate: [], taxNote: null },
      notes: [],
    } satisfies DocumentContentV1

    const read = currentContent(first)

    // Lifted all the way to today, one version at a time.
    expect(read.version).toBe(5)
    expect(read.introText).toBeNull()
    expect(read.closingText).toBeNull()
    expect(read.signature).toBeNull()
    expect(read.lines).toEqual([{ ...plain, kind: 'item' }])
    // The figures are carried over, not worked out again.
    expect(read.totals).toBe(first.totals)
    // Nothing was deducted before version 4, so it billed what it totalled,
    // and nothing was cancelled before version 5.
    expect(read.corrects).toBeNull()
    expect(read.deductions).toEqual([])
    expect(read.billed).toEqual({
      netCents: 124000,
      taxCents: 23560,
      grossCents: 147560,
      byRate: [],
    })
  })
})

describe('the chain of documents', () => {
  it('lets an order confirmation follow a quote and an estimate', () => {
    expect(successorsOf('quote')).toContain('order_confirmation')
    expect(successorsOf('cost_estimate')).toContain('order_confirmation')
  })

  it('lets an invoice follow whatever the work was agreed or recorded on', () => {
    for (const agreed of ['quote', 'cost_estimate', 'order_confirmation'] as const) {
      expect(successorsOf(agreed)).toEqual(
        expect.arrayContaining(['progress_invoice', 'final_invoice']),
      )
    }

    // A report records work that is done, so it is settled and not paid on.
    expect(successorsOf('time_and_material_report')).toEqual(['final_invoice'])
  })

  it('chains progress invoices, each deducting the ones before it', () => {
    expect(successorsOf('progress_invoice')).toEqual(['progress_invoice', 'final_invoice'])
    expect(deducts('progress_invoice')).toBe(true)
    expect(deducts('final_invoice')).toBe(true)
    expect(deducts('order_confirmation')).toBe(false)
  })

  it('ends at the final invoice, which is cancelled and not followed', () => {
    expect(successorsOf('final_invoice')).toEqual([])
    // The cancellation has a route of its own and is never written out of the
    // chain, so no kind leads to it.
    for (const kind of documentKinds) {
      expect(successorsOf(kind)).not.toContain('cancellation_invoice')
    }
  })
})
