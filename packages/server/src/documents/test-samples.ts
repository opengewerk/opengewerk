import {
  cancellationOf,
  type ContentSources,
  type DeductionContent,
  type DocumentContent,
  documentContent,
  type EInvoiceProfile,
  type IssuerContent,
  type IsoDate,
  type LineContent,
  receivedShare,
  type RecipientContent,
  shippedRules,
  type SiteContent,
} from '@opengewerk/domain'

/**
 * Invoices that between them take every branch of the e-invoice writer.
 *
 * Shared by the test of the writer, which holds each of them against the
 * schema, and the test of the ZUGFeRD PDF, which prints the ones in the
 * standard. In CI both write what they made to disk for the validators that
 * need Java: the one of the KoSIT for the XML, Mustang for the PDF. A new
 * branch in the writer gets a new invoice here, or neither of them ever sees
 * it.
 */

export const issuer: IssuerContent = {
  name: 'Elektro Nord GmbH',
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  phone: '+49 40 1234567',
  email: 'rechnung@elektro-nord.example',
  website: 'www.elektro-nord.example',
  taxNumber: '22/815/08154',
  // Typed the way people type it. What goes out has neither the spaces nor
  // the lower case.
  vatId: 'de 123 456 789',
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM1001',
  bankName: 'Deutsche Kreditbank',
  registerCourt: 'Amtsgericht Hamburg',
  registerNumber: 'HRB 12345',
  managingDirectors: 'Geschäftsführer: Max Nord',
  logo: null,
}

/** The least a business can have and still send an e-invoice under EN 16931. */
const plainIssuer: IssuerContent = {
  ...issuer,
  phone: null,
  email: null,
  website: null,
  iban: null,
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  vatId: 'DE123456789',
}

const recipient: RecipientContent = {
  name: 'Hausverwaltung Kramer GmbH',
  street: 'Mühlenkamp',
  houseNumber: '8',
  postalCode: '22303',
  city: 'Hamburg',
  country: 'DE',
  isBusiness: true,
  email: 'buchhaltung@kramer-hv.example',
  vatId: 'DE987654321',
  buyerReference: '04011000-12345-03',
}

const site: SiteContent = {
  designation: 'Wohnanlage Mühlenkamp 8',
  street: 'Mühlenkamp',
  houseNumber: '8',
  postalCode: '22303',
  city: 'Hamburg',
  country: 'DE',
}

let lastPosition = 0

function title(designation: string): LineContent {
  lastPosition += 1

  return {
    kind: 'title',
    position: lastPosition,
    designation,
    description: null,
    quantityMilli: 0,
    unit: 'flat_rate',
    unitPriceCents: 0,
    vatRate: 'standard',
    netCents: 0,
  }
}

export function item(
  designation: string,
  quantityMilli: number,
  unitPriceCents: number,
  over: Partial<LineContent> = {},
): LineContent {
  lastPosition += 1
  const exact = quantityMilli * unitPriceCents

  return {
    kind: 'item',
    position: lastPosition,
    designation,
    description: null,
    quantityMilli,
    unit: 'piece',
    unitPriceCents,
    vatRate: 'standard',
    // Half away from zero, as `lineNetCents` rounds.
    netCents: Math.sign(exact) * Math.round(Math.abs(exact) / 1000),
    ...over,
  }
}

export function content(
  document: Partial<ContentSources['document']>,
  parts: {
    readonly lines: readonly LineContent[]
    readonly issuer?: IssuerContent
    readonly recipient?: Partial<RecipientContent>
    readonly site?: SiteContent | null
    readonly deductions?: readonly DeductionContent[]
    readonly cashAccounting?: boolean
    /** The term that applies, fourteen days unless a sample says otherwise. */
    readonly paymentTermDays?: number
  },
): DocumentContent {
  return documentContent(shippedRules, {
    document: {
      kind: 'final_invoice',
      number: 'RE-2026-0001',
      documentDate: '2026-09-21',
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      subject: null,
      introText: null,
      closingText: null,
      taxTreatment: 'standard',
      ...document,
    },
    lines: parts.lines,
    issuer: parts.issuer ?? issuer,
    recipient: { ...recipient, ...parts.recipient },
    site: parts.site === undefined ? site : parts.site,
    signature: null,
    cashAccounting: parts.cashAccounting ?? false,
    deductions: parts.deductions ?? [],
    paymentTermDays: parts.paymentTermDays ?? 14,
    instructions: [],
  })
}

/** What an issued invoice deducts later on, out of what it froze. */
function deducted(invoice: DocumentContent): DeductionContent {
  if (invoice.number === null) {
    throw new Error('A deduction needs an issued invoice.')
  }

  return {
    number: invoice.number,
    documentDate: invoice.documentDate,
    taxTreatment: invoice.taxTreatment,
    billed: invoice.billed,
    received: null,
    receivedOn: null,
  }
}

export const firstProgress = content(
  {
    kind: 'progress_invoice',
    number: 'RE-2026-0001',
    documentDate: '2026-07-01',
    serviceFrom: null,
    serviceUntil: null,
    subject: 'Abschlag Rohinstallation',
  },
  { lines: [item('Leistungsstand Rohinstallation', 1000, 500000, { unit: 'flat_rate' })] },
)

export const secondProgress = content(
  {
    kind: 'progress_invoice',
    number: 'RE-2026-0002',
    documentDate: '2026-08-03',
    serviceFrom: null,
    serviceUntil: null,
  },
  {
    lines: [
      item('Leistungsstand Rohinstallation', 1000, 500000, { unit: 'flat_rate' }),
      item('Leistungsstand Unterverteilung', 1000, 312050, { unit: 'flat_rate' }),
    ],
    deductions: [deducted(firstProgress)],
  },
)

export const finalInvoice = content(
  {
    number: 'RE-2026-0003',
    subject: 'Elektroinstallation Mühlenkamp 8',
    introText: 'Vielen Dank für Ihren Auftrag.',
  },
  {
    lines: [
      title('Erdgeschoss'),
      item('Unterverteilung setzen', 1000, 124000, { unit: 'flat_rate' }),
      item('Steckdosen tauschen', 12_000, 4550, { description: 'Schuko, reinweiß\nmit Rahmen' }),
      title('Material'),
      item('Kabel NYM-J 3x1,5', 150_500, 129, { unit: 'metre' }),
      item('Fachbuch Elektroinstallation', 1000, 3990, { vatRate: 'reduced' }),
      item('Montage "Küche" & Bad <innen>\u0007', 2500, 6800, { unit: 'hour' }),
      item('Nachlass Stammkunde', 1000, -5000, { unit: 'flat_rate' }),
    ],
    deductions: [deducted(firstProgress), deducted(secondProgress)],
  },
)

/** What an issued progress invoice deducts once some or all of it came in, #189. */
function paid(invoice: DocumentContent, grossCents: number, on: IsoDate | null): DeductionContent {
  return {
    ...deducted(invoice),
    received: receivedShare(invoice.billed, grossCents),
    receivedOn: on,
  }
}

/**
 * The same work once less came in than was billed (#189): part of the first
 * progress invoice and nothing of the second. The final invoice takes off
 * what came in, and the second has no line of its own, because nothing is
 * taken off it.
 */
export const partlyPaid = content(
  {
    number: 'RE-2026-0005',
    subject: 'Elektroinstallation Mühlenkamp 8',
  },
  {
    lines: finalInvoice.lines,
    deductions: [paid(firstProgress, 400_000, '2026-07-20'), paid(secondProgress, 0, null)],
  },
)

/**
 * A progress invoice of the second half of 2020, at sixteen percent, taken off
 * by a final invoice of 2021 at nineteen. The tax that was stated stays the
 * tax that is taken off, so the invoice shows two rates.
 */
const earlyProgress = content(
  {
    kind: 'progress_invoice',
    number: 'RE-2020-0017',
    documentDate: '2020-11-16',
    serviceFrom: null,
    serviceUntil: null,
  },
  { lines: [item('Abschlag Neubau', 1000, 100000, { unit: 'flat_rate' })] },
)

export const acrossTheChange = content(
  {
    number: 'RE-2021-0004',
    documentDate: '2021-02-10',
    serviceFrom: '2021-02-01',
    serviceUntil: '2021-02-05',
  },
  {
    lines: [item('Elektroinstallation Neubau', 1000, 300000, { unit: 'flat_rate' })],
    deductions: [deducted(earlyProgress)],
  },
)

export const reverseCharge = content(
  { number: 'RE-2026-0010', taxTreatment: 'reverse_charge', subject: 'Nachunternehmerleistung' },
  {
    lines: [
      item('Kabeltrasse montieren', 32_000, 6500, { unit: 'hour' }),
      item('Kabelrinne 100x60', 48_000, 1890, { unit: 'metre' }),
    ],
    recipient: { name: 'Bau Hansa GmbH', vatId: 'DE 111 222 333' },
    // Agreed with the general contractor, and longer than the setting.
    paymentTermDays: 30,
  },
)

export const cancellation = cancellationOf(finalInvoice, {
  number: 'RE-2026-0004',
  documentDate: '2026-10-05',
  issuer,
})

export const singleDay = content(
  { number: 'RE-2026-0011', serviceFrom: '2026-09-18', serviceUntil: null },
  {
    lines: [item('Fehlersuche Beleuchtung', 4500, 7200, { unit: 'hour' })],
    issuer: plainIssuer,
    recipient: { email: null, buyerReference: null, vatId: null },
    site: { ...site, postalCode: null },
    // An hour of fault finding, payable at once: a due date on the day of
    // the invoice.
    paymentTermDays: 0,
  },
)

/**
 * An invoice of 2028 from a business that calculates its tax on what it
 * receives. It carries the statement of section 14 (4) sentence 1 number 6a
 * UStG among its notes, and the e-invoice writes it as a note like any other.
 */
export const cashAccounting = content(
  {
    number: 'RE-2028-0001',
    documentDate: '2028-01-12',
    serviceFrom: '2028-01-05',
    serviceUntil: '2028-01-07',
  },
  {
    lines: [item('Wallbox montieren und anschließen', 1000, 89000, { unit: 'flat_rate' })],
    cashAccounting: true,
  },
)

/**
 * A photovoltaic installation with its storage, delivered and installed at
 * the zero rate of section 12 (3) UStG (#127), and a wallbox at the standard
 * rate next to it, which is no component of the installation. The e-invoice
 * carries both categories: `S` at nineteen and `Z` at zero, the latter with
 * no reason for an exemption, because it is a rate.
 */
export const photovoltaics = content(
  { number: 'RE-2026-0012', subject: 'Photovoltaikanlage Mühlenkamp 8' },
  {
    lines: [
      item('Solarmodule 9,8 kWp liefern und montieren', 1000, 1_240_000, {
        unit: 'flat_rate',
        vatRate: 'zero',
      }),
      item('Batteriespeicher 10 kWh liefern und anschließen', 1000, 690_000, {
        vatRate: 'zero',
      }),
      item('Wallbox montieren und anschließen', 1000, 89000, { unit: 'flat_rate' }),
    ],
  },
)

export const samples: readonly {
  readonly name: string
  readonly profile: EInvoiceProfile
  readonly content: DocumentContent
}[] = [
  { name: 'final-invoice-xrechnung', profile: 'xrechnung', content: finalInvoice },
  { name: 'final-invoice-en16931', profile: 'en16931', content: finalInvoice },
  { name: 'partly-paid-xrechnung', profile: 'xrechnung', content: partlyPaid },
  { name: 'partly-paid-en16931', profile: 'en16931', content: partlyPaid },
  { name: 'progress-invoice-xrechnung', profile: 'xrechnung', content: secondProgress },
  { name: 'first-progress-invoice-en16931', profile: 'en16931', content: firstProgress },
  { name: 'rate-change-xrechnung', profile: 'xrechnung', content: acrossTheChange },
  { name: 'reverse-charge-xrechnung', profile: 'xrechnung', content: reverseCharge },
  { name: 'cancellation-xrechnung', profile: 'xrechnung', content: cancellation },
  { name: 'cancellation-en16931', profile: 'en16931', content: cancellation },
  { name: 'single-day-plain-en16931', profile: 'en16931', content: singleDay },
  { name: 'cash-accounting-xrechnung', profile: 'xrechnung', content: cashAccounting },
  { name: 'photovoltaics-xrechnung', profile: 'xrechnung', content: photovoltaics },
  { name: 'photovoltaics-en16931', profile: 'en16931', content: photovoltaics },
]
