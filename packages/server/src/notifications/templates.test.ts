import {
  type DeductionContent,
  documentContent,
  type DocumentKind,
  type IssuerContent,
  shippedRules,
} from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { documentMessage } from './templates.js'

/**
 * The message a document goes out with, as far as it names the document: the
 * same name its page carries (#132), so that a plain invoice is not announced
 * as a Schlussrechnung and a Schlussrechnung not as a plain invoice.
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
  registerCourt: null,
  registerNumber: null,
  managingDirectors: null,
  logo: null,
}

const earlier: DeductionContent = {
  number: 'RE-2026-0040',
  documentDate: '2026-09-01',
  taxTreatment: 'standard',
  billed: {
    netCents: 40000,
    taxCents: 7600,
    grossCents: 47600,
    byRate: [
      { rate: 'standard', basisPoints: 1900, netCents: 40000, taxCents: 7600, grossCents: 47600 },
    ],
  },
  received: null,
  receivedOn: null,
}

function message(kind: DocumentKind, deductions: readonly DeductionContent[] = []) {
  const content = documentContent(shippedRules, {
    document: {
      kind,
      number: 'RE-2026-0042',
      documentDate: '2026-09-21',
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      subject: null,
      introText: null,
      closingText: null,
      taxTreatment: 'standard',
    },
    lines: [
      {
        kind: 'item',
        position: 1,
        designation: 'Unterverteilung setzen',
        description: null,
        quantityMilli: 1000,
        unit: 'flat_rate',
        unitPriceCents: 100000,
        vatRate: 'standard',
        netCents: 100000,
      },
    ],
    issuer,
    recipient: {
      name: 'Familie Berg',
      street: 'Lindenweg',
      houseNumber: '3',
      postalCode: '22301',
      city: 'Hamburg',
      country: 'DE',
      isBusiness: false,
      email: 'berg@example.de',
      vatId: null,
      buyerReference: null,
    },
    site: null,
    signature: null,
    cashAccounting: false,
    deductions,
    paymentTermDays: 14,
    instructions: [],
  })

  return documentMessage({ content, attachment: 'pdf', issuer, signature: 'Elektro Nord GmbH' })
}

describe('the message of an invoice', () => {
  it('names a plain invoice a Rechnung', () => {
    const sent = message('final_invoice')

    expect(sent.subject).toBe('Rechnung RE-2026-0042 von Elektro Nord GmbH')
    expect(sent.body).toContain('im Anhang erhalten Sie die Rechnung RE-2026-0042 vom 21.09.2026')
  })

  it('names the one that closes a row of progress invoices a Schlussrechnung', () => {
    const sent = message('final_invoice', [earlier])

    expect(sent.subject).toBe('Schlussrechnung RE-2026-0042 von Elektro Nord GmbH')
    expect(sent.body).toContain(
      'im Anhang erhalten Sie die Schlussrechnung RE-2026-0042 vom 21.09.2026',
    )
  })

  it('names a progress invoice for what it is, whatever it takes off', () => {
    const sent = message('progress_invoice', [earlier])

    expect(sent.subject).toBe('Abschlagsrechnung RE-2026-0042 von Elektro Nord GmbH')
    expect(sent.body).toContain('im Anhang erhalten Sie die Abschlagsrechnung RE-2026-0042')
  })
})
