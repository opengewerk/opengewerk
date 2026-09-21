import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import {
  type DocumentContent,
  type DocumentKind,
  type IsoDate,
  isInvoice,
  type LineContent,
  type LineUnit,
  outlineRows,
  quantityFactor,
  showsPrices,
  signatureBox,
  signaturePathIsValid,
  type VatRate,
} from '@opengewerk/domain'

import type { PageMargin, PrintJob } from './renderer.js'

/**
 * The one letterhead template every document is printed with.
 *
 * One for all kinds, which is the point of the issue that brought it: a quote,
 * an order confirmation, a report and an invoice share the head, the address,
 * the lines, the totals and the footer, and four half templates next to each
 * other would drift within a month. What differs between the kinds is a title
 * and a label, and those are two small tables below.
 *
 * The layout follows DIN 5008, form B, because that is what fits a window
 * envelope: the address field sits 45 millimetres from the top edge and 20
 * from the left, the information block 50 from the top and 125 from the left,
 * and the text starts at the height of the subject line. Get these wrong and
 * the envelope shows the letterhead instead of the customer's name.
 *
 * It is a function of the content record and nothing else. It does not read
 * the database, and a document printed a year after it was issued comes out
 * of the same record it was checked against. What it does read is a font,
 * embedded so that a PDF looks the same whichever Chromium the renderer ships.
 *
 * Plain template strings and not a component library. The server has no
 * React, and adding it for one page would cost more than the escaping below,
 * which is all a template string needs to be safe. Every value that came from
 * a person goes through `text`.
 */

/** What the page is printed on, measured from the edges of an A4 sheet. */
const margin: PageMargin = { top: '15mm', right: '20mm', bottom: '32mm', left: '20mm' }

/** HTML escaping for anything a person typed. */
function text(value: string | null | undefined): string {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== ''
}

const money = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const quantities = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 })
const percentages = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const regions = new Intl.DisplayNames(['de'], { type: 'region' })

function euros(cents: number): string {
  return money.format(cents / 100)
}

function day(date: IsoDate): string {
  const [year, month, dayOfMonth] = date.split('-')

  return `${dayOfMonth ?? ''}.${month ?? ''}.${year ?? ''}`
}

function percent(basisPoints: number): string {
  return `${percentages.format(basisPoints / 100)} %`
}

/** An IBAN in groups of four, the way it is read out and typed in. */
function iban(value: string): string {
  return value.replaceAll(/\s+/g, '').replaceAll(/(.{4})(?=.)/g, '$1 ')
}

const titles: Readonly<Record<DocumentKind, string>> = {
  cost_estimate: 'Kostenvoranschlag',
  quote: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  delivery_note: 'Lieferschein',
  time_and_material_report: 'Regiebericht',
  progress_invoice: 'Abschlagsrechnung',
  partial_invoice: 'Teilrechnung',
  final_invoice: 'Schlussrechnung',
  credit_note: 'Gutschrift',
  cancellation_invoice: 'Stornorechnung',
  recurring_invoice: 'Dauerrechnung',
}

/** What a kind of document is called at the top of the page. */
export function documentTitle(kind: DocumentKind): string {
  return titles[kind]
}

/** The unit as it is printed next to a quantity. Short, because the column is. */
const units: Readonly<Record<LineUnit, string>> = {
  piece: 'Stk.',
  hour: 'Std.',
  day: 'Tag',
  metre: 'm',
  square_metre: 'm²',
  cubic_metre: 'm³',
  kilogram: 'kg',
  litre: 'l',
  package: 'Pkg.',
  flat_rate: 'psch.',
}

const require = createRequire(import.meta.url)

/** The faces the page uses: regular and semibold, Latin and extended Latin. */
const faces = [
  { weight: 400, subset: 'latin', range: latinRange() },
  { weight: 400, subset: 'latin-ext', range: latinExtendedRange() },
  { weight: 600, subset: 'latin', range: latinRange() },
  { weight: 600, subset: 'latin-ext', range: latinExtendedRange() },
] as const

function latinRange(): string {
  return (
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,' +
    'U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
  )
}

function latinExtendedRange(): string {
  return (
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,' +
    'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,' +
    'U+A720-A7FF'
  )
}

let embeddedFaces: Map<number, string> | undefined

/**
 * The @font-face rules, with the fonts inside them as data.
 *
 * Embedded rather than left to the renderer's system fonts. The renderer image
 * is pulled as `latest`, and a font that changes with it changes every PDF an
 * installation produces after an update, line breaks included. Read once and
 * kept, because they are the same for every document.
 */
function fontFaces(weights: readonly number[]): string {
  embeddedFaces ??= new Map(
    faces.map((face, index) => {
      const file = require.resolve(
        `@fontsource/barlow/files/barlow-${face.subset}-${String(face.weight)}-normal.woff2`,
      )
      const data = readFileSync(file).toString('base64')

      return [
        index,
        `@font-face{font-family:'Barlow';font-style:normal;font-weight:${String(face.weight)};` +
          `font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');` +
          `unicode-range:${face.range}}`,
      ]
    }),
  )

  return faces
    .map((face, index) => (weights.includes(face.weight) ? embeddedFaces?.get(index) : undefined))
    .filter((rule): rule is string => rule !== undefined)
    .join('\n')
}

const typeface = `'Barlow', 'Liberation Sans', Arial, sans-serif`

/** An address as lines, the country only when it is not the sender's. */
function addressLines(
  address: {
    readonly street: string | null
    readonly houseNumber: string | null
    readonly postalCode: string | null
    readonly city: string | null
    readonly country: string
  },
  home: string,
): string[] {
  const street = [address.street, address.houseNumber].filter(present).join(' ')
  const place = [address.postalCode, address.city].filter(present).join(' ')
  const country =
    address.country !== home ? (regions.of(address.country) ?? address.country).toUpperCase() : ''

  return [street, place, country].filter(present)
}

/** The logo as a data address, so the renderer has nothing to fetch. */
export interface PrintAssets {
  readonly logo: { readonly mediaType: string; readonly bytes: Uint8Array } | null
}

function head(content: DocumentContent, assets: PrintAssets): string {
  const { issuer } = content
  const logo = assets.logo
    ? `<img class="logo" alt="" src="data:${text(assets.logo.mediaType)};base64,${Buffer.from(
        assets.logo.bytes,
      ).toString('base64')}">`
    : ''

  const sender = [issuer.name, ...addressLines(issuer, issuer.country)].filter(present).join(' · ')
  const recipient = [content.recipient.name, ...addressLines(content.recipient, issuer.country)]
    .filter(present)
    .map(text)
    .join('<br>')

  return `
    <header class="brand">
      <div class="company">${text(issuer.name)}</div>
      ${logo}
    </header>
    <div class="window">
      <div class="sender">${text(sender)}</div>
      <div class="recipient">${recipient}</div>
    </div>
    <div class="information">${information(content)}</div>`
}

function information(content: DocumentContent): string {
  const rows: [string, string][] = []
  const numberLabel = isInvoice(content.kind) ? 'Rechnungsnummer' : 'Belegnummer'

  rows.push([
    numberLabel,
    content.number === null ? 'folgt beim Festschreiben' : text(content.number),
  ])
  rows.push(['Datum', day(content.documentDate)])

  if (content.corrects !== null) {
    rows.push([
      'Zur Rechnung',
      `${text(content.corrects.number)} vom ${day(content.corrects.documentDate)}`,
    ])
  }

  if (content.serviceFrom !== null) {
    const until = content.serviceUntil
    const single = until === null || until === content.serviceFrom

    rows.push(
      single
        ? ['Leistungsdatum', day(content.serviceFrom)]
        : ['Leistungszeitraum', `${day(content.serviceFrom)} bis ${day(until)}`],
    )
  }

  if (content.site !== null) {
    const place = [
      content.site.designation,
      ...addressLines(content.site, content.issuer.country),
    ].filter(present)

    rows.push(['Objekt', place.map(text).join('<br>')])
  }

  return `<table>${rows
    .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
    .join('')}</table>`
}

/** The small grey text under a designation, line breaks as they were typed. */
function descriptionOf(line: LineContent): string {
  return present(line.description) ? `<div class="description">${text(line.description)}</div>` : ''
}

/**
 * The lines, in the outline a quote is read in: titles as headings over their
 * positions, the positions numbered below them, and after each title the sum
 * of what it holds. The numbering and the sums come from `outlineRows`, the
 * same function the office screen uses, so the paper and the screen agree on
 * what position 2.3 is.
 */
function lines(content: DocumentContent): string {
  // A report records what was done and is printed without prices, see
  // `showsPrices`. Its lines keep their quantities and lose the three columns
  // that would only say zero, and its titles lose their sums for the same
  // reason.
  const priced = showsPrices(content.kind)
  const taxed = priced && content.taxTreatment === 'standard'
  const columns = priced ? (taxed ? 6 : 5) : 3
  const rateOf = new Map<VatRate, number>(
    content.totals.byRate.map((entry) => [entry.rate, entry.basisPoints]),
  )

  const rows = outlineRows(content.lines)
    .map((row) => {
      switch (row.row) {
        case 'title':
          return `<tr class="title">
        <td class="position">${row.number}</td>
        <td colspan="${String(columns - 1)}">${text(row.line.designation)}${descriptionOf(row.line)}</td>
      </tr>`

        case 'subtotal':
          if (!priced) {
            return ''
          }

          return `<tr class="subtotal">
        <td></td>
        <td colspan="${String(columns - 2)}">Summe Titel ${row.number}: ${text(row.designation)}</td>
        <td class="figure">${euros(row.netCents)}</td>
      </tr>`

        case 'item': {
          const { line } = row
          const rate = rateOf.get(line.vatRate)

          if (!priced) {
            return `<tr>
        <td class="position">${row.number}</td>
        <td>${text(line.designation)}${descriptionOf(line)}</td>
        <td class="figure">${quantities.format(line.quantityMilli / quantityFactor)} ${units[line.unit]}</td>
      </tr>`
          }

          return `<tr>
        <td class="position">${row.number}</td>
        <td>${text(line.designation)}${descriptionOf(line)}</td>
        <td class="figure">${quantities.format(line.quantityMilli / quantityFactor)} ${units[line.unit]}</td>
        <td class="figure">${euros(line.unitPriceCents)}</td>
        ${taxed ? `<td class="figure">${rate === undefined ? '' : percent(rate)}</td>` : ''}
        <td class="figure">${euros(line.netCents)}</td>
      </tr>`
        }
      }
    })
    .join('')

  const head = priced
    ? `<th class="figure">Einzelpreis</th>
      ${taxed ? '<th class="figure">USt.</th>' : ''}
      <th class="figure">Gesamt</th>`
    : ''

  return `<table class="lines">
    <thead><tr>
      <th class="position">Pos.</th>
      <th>Bezeichnung</th>
      <th class="figure">Menge</th>
      ${head}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

/**
 * The totals, by rate. Section 14 (4) numbers 7 and 8 UStG want the amount
 * broken down by rate, with the rate and the tax on it, so every rate gets its
 * own line with the base it applies to, even when there is only one.
 *
 * Without tax there is one figure and no zero line. What explains it is the
 * note underneath, and "0,00 € Umsatzsteuer" would say something else.
 *
 * An invoice that takes off earlier progress invoices prints three parts, in
 * the order the arithmetic runs: the whole of the work, each progress invoice
 * it deducts with its number and date and what it billed, and what this
 * invoice asks for. The last part states net and tax once more, per rate,
 * because those are the figures of this invoice in the sense of numbers 7 and
 * 8; the first part is what they are worked out from. The tax of the last part
 * carries no percentage. After a change of rate it is the tax on the whole less
 * the tax stated before, which is right and is not the rate times the net
 * beside it; the rate stands in the first part, where it applies.
 */
function totals(content: DocumentContent): string {
  const { totals: sums, billed } = content

  if (!showsPrices(content.kind)) {
    return ''
  }

  const taxed = content.taxTreatment === 'standard'
  const deducting = content.deductions.length > 0
  const figure = (cents: number) => `<td class="figure">${euros(cents)}</td>`
  // A cancellation speaks of the invoice it mirrors: the progress of a
  // progress invoice, the whole work of a final one.
  const mirrored = content.corrects?.kind ?? content.kind
  const whole = deducting
    ? mirrored === 'progress_invoice'
      ? 'Leistungsstand gesamt'
      : 'Gesamtleistung'
    : 'Gesamtbetrag'
  // On a cancellation the deductions are turned round like everything else:
  // what the invoice took off, the cancellation gives back.
  const deducted =
    content.kind === 'cancellation_invoice'
      ? 'zurückgenommener Abzug der Abschlagsrechnung'
      : 'abzüglich Abschlagsrechnung'

  const work = taxed
    ? `<tr><td>Summe netto</td>${figure(sums.netCents)}</tr>` +
      sums.byRate
        .map(
          (entry) =>
            `<tr><td>Umsatzsteuer ${percent(entry.basisPoints)} auf ${euros(entry.netCents)}</td>` +
            `${figure(entry.taxCents)}</tr>`,
        )
        .join('') +
      `<tr class="${deducting ? 'whole' : 'grand'}"><td>${whole}</td>${figure(sums.grossCents)}</tr>`
    : `<tr class="${deducting ? 'whole' : 'grand'}"><td>${whole}</td>${figure(sums.grossCents)}</tr>`

  if (!deducting) {
    return `<table class="totals">${work}</table>`
  }

  const deductions = content.deductions
    .map(
      (deduction) =>
        `<tr class="deduction"><td>${deducted} ${text(deduction.number)} ` +
        `vom ${day(deduction.documentDate)}` +
        (taxed
          ? `<div class="detail">netto ${euros(deduction.billed.netCents)}, ` +
            `Umsatzsteuer ${euros(deduction.billed.taxCents)}</div>`
          : '') +
        `</td>${figure(-deduction.billed.grossCents)}</tr>`,
    )
    .join('')

  const single = billed.byRate.length === 1
  const due = taxed
    ? billed.byRate
        .map((entry) => {
          const group = single ? '' : ` zu ${percent(entry.basisPoints)}`

          return (
            `<tr><td>Rechnungsbetrag netto${group}</td>${figure(entry.netCents)}</tr>` +
            `<tr><td>Umsatzsteuer${group}</td>${figure(entry.taxCents)}</tr>`
          )
        })
        .join('')
    : ''

  return `<table class="totals">
    ${work}
    ${deductions}
    ${due}
    <tr class="grand"><td>Rechnungsbetrag</td>${figure(billed.grossCents)}</tr>
  </table>`
}

const pageStyle = `
  html {
    font-family: ${typeface};
    font-size: 9.5pt;
    line-height: 1.4;
    color: #1b2430;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { margin: 0; }
  .first { position: relative; height: 83.5mm; }
  .brand {
    position: absolute; top: 0; left: 0; right: 0; height: 26mm;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm;
  }
  .company { font-size: 15pt; font-weight: 600; line-height: 1.2; }
  .logo { max-height: 24mm; max-width: 70mm; object-fit: contain; }
  .window { position: absolute; top: 30mm; left: 0; width: 85mm; height: 45mm; overflow: hidden; }
  .sender {
    font-size: 7pt; color: #5b6573; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; border-bottom: 0.3pt solid #9aa3ad; padding-bottom: 0.8mm;
  }
  .recipient { margin-top: 4mm; font-size: 10pt; line-height: 1.35; }
  .information { position: absolute; top: 35mm; left: 105mm; width: 65mm; font-size: 9pt; }
  .information table { border-collapse: collapse; width: 100%; }
  .information th {
    text-align: left; font-weight: 400; color: #5b6573;
    padding: 0 2.5mm 1.2mm 0; vertical-align: top; white-space: nowrap;
  }
  .information td { padding: 0 0 1.2mm; vertical-align: top; }
  h1 { font-size: 14pt; font-weight: 600; margin: 0 0 1.5mm; }
  .subject { margin: 0 0 6mm; }
  .lines { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  .lines th {
    font-size: 8.5pt; font-weight: 600; text-align: left;
    border-bottom: 0.6pt solid #1b2430; padding: 1.5mm 1.5mm;
  }
  .lines td { padding: 1.8mm 1.5mm; border-bottom: 0.3pt solid #d5d9de; vertical-align: top; }
  .lines tr { break-inside: avoid; }
  .lines tr.title td {
    font-weight: 600; padding-top: 4mm; border-bottom: 0.6pt solid #9aa3ad;
  }
  .lines tr.title td.position { color: #1b2430; }
  .lines tr.title { break-after: avoid; }
  .lines tr.subtotal td { font-weight: 600; border-bottom: none; padding-bottom: 3mm; }
  .position { width: 11mm; text-align: left; color: #5b6573; white-space: nowrap; }
  .figure { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lines th.figure { text-align: right; }
  .description {
    font-size: 8.5pt; font-weight: 400; color: #5b6573; white-space: pre-line; margin-top: 0.8mm;
  }
  .totals {
    margin: 4mm 0 0 auto; width: 88mm; border-collapse: collapse; break-inside: avoid;
  }
  .totals td { padding: 1mm 1.5mm; }
  .totals .grand td {
    font-weight: 600; font-size: 10.5pt; border-top: 0.6pt solid #1b2430; padding-top: 1.8mm;
  }
  .totals .whole td { font-weight: 600; border-top: 0.3pt solid #9aa3ad; padding-bottom: 2.5mm; }
  .totals .deduction td { vertical-align: top; }
  .totals .detail { font-size: 8pt; color: #5b6573; }
  .signature { margin-top: 12mm; width: 80mm; break-inside: avoid; }
  .signature-picture { display: block; width: 80mm; height: 32mm; }
  .signature-line {
    border-top: 0.6pt solid #1b2430; padding-top: 1.2mm; font-size: 8.5pt; color: #5b6573;
  }
  .notes { margin-top: 8mm; break-inside: avoid; }
  .notes p { margin: 0 0 2mm; }
  .text { white-space: pre-line; }
  .intro { margin: 0 0 4mm; }
  .closing { margin-top: 8mm; break-inside: avoid; }
  .draft {
    position: fixed; top: 120mm; left: 0; right: 0; text-align: center;
    font-size: 64pt; font-weight: 600; letter-spacing: 6mm;
    color: rgba(27, 36, 48, 0.08); transform: rotate(-30deg);
  }
`

const moments = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  dateStyle: 'medium',
  timeStyle: 'short',
})

/**
 * The customer's signature, under everything else, where a signature goes:
 * the picture, and below the line who signed and when.
 *
 * The picture goes in only as a path that passes `signaturePathIsValid`, the
 * check the device, the server and the database make as well. It is the one
 * value on the page that is not escaped text, and the check is what keeps it
 * from being anything but a line.
 */
function signatureOf(content: DocumentContent): string {
  const signature = content.signature

  if (!signature) {
    return ''
  }

  const picture = signaturePathIsValid(signature.path)
    ? `<svg class="signature-picture" viewBox="0 0 ${String(signatureBox.width)} ${String(signatureBox.height)}" aria-hidden="true"><path d="${signature.path}" fill="none" stroke="#1b2430" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : ''

  return `<section class="signature">
    ${picture}
    <div class="signature-line">${text(signature.signerName)}, ${moments.format(new Date(signature.signedAt))} Uhr</div>
  </section>`
}

/**
 * What goes into the bottom margin of every page: who the business is, how
 * to reach it and pay it, and the page count. The part of a letter that the
 * law and the customer both look for, printed where they both expect it.
 *
 * Its own small document, because Chromium renders the footer apart from the
 * page. It carries its own style and its own font for that reason, and only
 * the regular weight to keep the job small.
 */
function footer(content: DocumentContent): string {
  const { issuer } = content
  const columns = [
    [issuer.name, ...addressLines(issuer, issuer.country)],
    [
      present(issuer.phone) ? `Telefon ${issuer.phone}` : null,
      present(issuer.email) ? issuer.email : null,
      present(issuer.website) ? issuer.website : null,
    ],
    [
      present(issuer.taxNumber) ? `Steuernummer ${issuer.taxNumber}` : null,
      present(issuer.vatId) ? `USt-IdNr. ${issuer.vatId}` : null,
      [issuer.registerCourt, issuer.registerNumber].filter(present).join(', ') || null,
      present(issuer.managingDirectors) ? issuer.managingDirectors : null,
    ],
    [
      present(issuer.bankName) ? issuer.bankName : null,
      present(issuer.iban) ? `IBAN ${iban(issuer.iban)}` : null,
      present(issuer.bic) ? `BIC ${issuer.bic}` : null,
    ],
  ]
    .map((column) => column.filter(present))
    .filter((column) => column.length > 0)
    .map((column) => `<div class="column">${column.map(text).join('<br>')}</div>`)
    .join('')

  // The page count gets a line of its own above the columns. Beside them it
  // took the room an IBAN needs, and an IBAN broken over two lines is one
  // somebody types wrong.
  return `<style>
    ${fontFaces([400])}
    .footer {
      font-family: ${typeface}; font-size: 7pt; line-height: 1.35; color: #5b6573;
      width: 100%; box-sizing: border-box; padding: 3mm 20mm 0;
      -webkit-print-color-adjust: exact;
    }
    .page { text-align: right; margin-bottom: 1.2mm; }
    .columns {
      display: flex; justify-content: space-between; gap: 4mm;
      border-top: 0.3pt solid #d5d9de; padding-top: 1.5mm;
    }
    .column { flex: 0 1 auto; min-width: 0; }
  </style>
  <div class="footer">
    <div class="page">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>
    <div class="columns">${columns}</div>
  </div>`
}

/**
 * The print job for a document: the page, its footer and its margins.
 *
 * A draft is marked as one, in the title and across every page, and gets no
 * number. It is what somebody looks at before issuing, and it must not be
 * mistaken for the invoice itself if it is printed and left on a desk.
 */
export function printJob(content: DocumentContent, assets: PrintAssets): Required<PrintJob> {
  // Without a number a document is a draft, unless a customer signed it: a
  // signed report is final in what it says and waits only for its number, and
  // the copy the customer takes away must not call itself a draft.
  const signed = content.signature !== null
  const draft = content.number === null && !signed
  const title =
    content.number !== null
      ? `${titles[content.kind]} ${content.number}`
      : signed
        ? titles[content.kind]
        : `${titles[content.kind]} (Entwurf)`

  const subject = present(content.subject) ? `<p class="subject">${text(content.subject)}</p>` : ''
  const notes = content.notes.length
    ? `<div class="notes">${content.notes.map((note) => `<p>${text(note)}</p>`).join('')}</div>`
    : ''
  // Above the lines and below everything else, the way a letter reads: the
  // greeting and the reason for writing first, the legal notes where the
  // figures they explain are, and the closing words at the end.
  const intro = present(content.introText)
    ? `<div class="text intro">${text(content.introText)}</div>`
    : ''
  // A cancellation says in its first sentence which invoice it takes back, and
  // that it takes all of it back: every figure below is that invoice's, turned
  // round.
  const cancels = content.corrects
    ? `<div class="text intro">Hiermit stornieren wir die ${titles[content.corrects.kind]} ` +
      `${text(content.corrects.number)} vom ${day(content.corrects.documentDate)} in voller Höhe. ` +
      'Die Beträge sind die dieser Rechnung mit umgekehrtem Vorzeichen.</div>'
    : ''
  const closing = present(content.closingText)
    ? `<div class="text closing">${text(content.closingText)}</div>`
    : ''

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${text(`${title}, ${content.issuer.name}`)}</title>
<style>
${fontFaces([400, 600])}
${pageStyle}
</style>
</head>
<body>
${draft ? '<div class="draft">ENTWURF</div>' : ''}
<section class="first">${head(content, assets)}</section>
<main>
  <h1>${text(title)}</h1>
  ${subject}
  ${cancels}
  ${intro}
  ${lines(content)}
  ${totals(content)}
  ${notes}
  ${closing}
  ${signatureOf(content)}
</main>
</body>
</html>`

  return { html, footerHtml: footer(content), margin }
}
