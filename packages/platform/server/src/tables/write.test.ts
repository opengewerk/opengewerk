import { BadRequestException, UnprocessableEntityException } from '@nestjs/common'
import { outgoingTableRows, tooLongForATable } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { unzip, zipped } from '../files/zip.js'
import { tableFileOf } from './read.js'
import {
  type OutgoingTable,
  readAsFormula,
  tableAnswer,
  tableAsCsv,
  tableAsWorkbook,
  tableFormatOf,
} from './write.js'

const megabyte = 1_000_000
/** The bytes as text, the mark of UTF-8 at their beginning kept, where the decoder would drop it. */
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
const mark = String.fromCharCode(0xfeff)

/** A list of an office as the route of a list hands it in: text, numbers, a day and an empty cell. */
const list: OutgoingTable = {
  name: 'Anlagen',
  columns: ['Nummer', 'Anlage', 'Prüfungen', 'Anteil', 'Fällig am', 'Bemerkung'],
  rows: [
    ['AN-00012', 'Lüftung Großküche', 3, 0.5, { day: '2026-10-02' }, null],
    ['AN-00013', 'Aufzug "Nord"; Haus A', 0, -1.25, { day: '1999-12-31' }, 'Zwei\nZeilen'],
  ],
}

/** Values a spreadsheet would run as a formula if they were written as they are. */
const formulas = ['=1+1', '+49 621 000', '-5 Grad', '@SUMME(A1)', '\t=1+1', '\r=1+1']

/** The sheet the reader of this foundation makes of the bytes, as an import would see it. */
const readBack = (bytes: Uint8Array, name: string) => tableFileOf(bytes, name).sheets

/** The parts of a written workbook, by their path. */
function partsOf(workbook: Uint8Array): Map<string, string> {
  return new Map(unzip(workbook, 10 * megabyte).map((entry) => [entry.path, text(entry.bytes)]))
}

describe('an archive that is written', () => {
  it('holds its files in their order, byte for byte, read by the reader of this foundation', () => {
    const files = [
      { path: 'xl/worksheets/sheet1.xml', bytes: new TextEncoder().encode('<a>Größe</a>') },
      { path: '[Content_Types].xml', bytes: new TextEncoder().encode('') },
      { path: 'leer/ä.bin', bytes: new Uint8Array([0, 1, 2, 255]) },
    ]

    expect(unzip(zipped(files), megabyte)).toEqual(files)
  })

  it('is the same bytes for the same files', () => {
    const files = [{ path: 'a.txt', bytes: new TextEncoder().encode('a') }]

    expect(zipped(files)).toEqual(zipped(files))
  })
})

describe('a list as a workbook', () => {
  it('reads back as what the list shows: umlauts, numbers with a comma, days as written', () => {
    expect(readBack(tableAsWorkbook(list), 'Anlagen.xlsx')).toEqual([
      {
        name: 'Anlagen',
        rows: [
          ['Nummer', 'Anlage', 'Prüfungen', 'Anteil', 'Fällig am', 'Bemerkung'],
          ['AN-00012', 'Lüftung Großküche', '3', '0,5', '02.10.2026'],
          ['AN-00013', 'Aufzug "Nord"; Haus A', '0', '-1,25', '31.12.1999', 'Zwei Zeilen'],
        ],
      },
    ])
  })

  it('writes a day as a day the spreadsheet counts, shown as 02.10.2026', () => {
    const parts = partsOf(tableAsWorkbook(list))

    // 46297 is the 2nd of October 2026 as Excel and LibreOffice count it.
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('<c r="E2" s="3"><v>46297</v></c>')
    expect(parts.get('xl/styles.xml')).toContain(
      '<numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/>',
    )
    expect(parts.get('xl/styles.xml')).toContain(
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
    )
  })

  it('writes a value that begins like a formula as text, never as a formula', () => {
    const sheet = partsOf(
      tableAsWorkbook({ name: 'Liste', columns: ['Wert'], rows: formulas.map((value) => [value]) }),
    ).get('xl/worksheets/sheet1.xml')

    expect(sheet).not.toContain('<f>')
    expect(sheet).not.toContain('<f ')

    for (const [index, value] of formulas.entries()) {
      expect(sheet).toContain(
        `<c r="A${String(index + 2)}" s="2" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`,
      )
    }
  })

  it('marks its text to stay text when somebody edits a cell', () => {
    const styles = partsOf(tableAsWorkbook(list)).get('xl/styles.xml') ?? ''
    const formats = [...styles.matchAll(/<xf [^>]*\/>/g)].map(([format]) => format).slice(1)

    // The formats of the cells, after the one of the cell styles: plain, header, text, day.
    expect(formats[2]).toContain('quotePrefix="1"')
    expect(formats[1]).toContain('quotePrefix="1"')
  })

  it('escapes what XML holds for itself and leaves out what it may not hold', () => {
    const parts = partsOf(
      tableAsWorkbook({
        name: 'A/B: [Liste]',
        columns: ['<Name>'],
        rows: [['Müller & Söhne <GmbH>\u0001']],
      }),
    )

    expect(parts.get('xl/worksheets/sheet1.xml')).toContain(
      '<t xml:space="preserve">Müller &amp; Söhne &lt;GmbH&gt;</t>',
    )
    expect(parts.get('xl/workbook.xml')).toContain(
      '<sheet name="A B Liste" sheetId="1" r:id="rId1"/>',
    )
  })

  it('names its sheet without an apostrophe at either end, and "Tabelle" where nothing is left', () => {
    const sheetName = (name: string) =>
      /<sheet name="([^"]*)"/.exec(
        partsOf(tableAsWorkbook({ ...list, name })).get('xl/workbook.xml') ?? '',
      )?.[1]

    expect(sheetName("'Mängel' ")).toBe('Mängel')
    expect(sheetName("'".repeat(50_000))).toBe('Tabelle')
    expect(sheetName('Eine Liste mit einem sehr langen Namen, länger als ein Blatt')).toBe(
      'Eine Liste mit einem sehr lange',
    )
  })

  it('holds the header in place, with a filter over every column', () => {
    const parts = partsOf(tableAsWorkbook(list))

    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('state="frozen"')
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('<autoFilter ref="A1:F3"/>')
    expect(parts.get('xl/workbook.xml')).toContain("'Anlagen'!$A$1:$F$3")
  })

  it('is a workbook with nothing but its header where the list is empty', () => {
    expect(readBack(tableAsWorkbook({ ...list, rows: [] }), 'Anlagen.xlsx')).toEqual([
      { name: 'Anlagen', rows: [list.columns] },
    ])
  })
})

describe('a list as text with separated values', () => {
  it('reads back as what the list shows: umlauts, numbers with a comma, days as written', () => {
    expect(readBack(tableAsCsv(list), 'Anlagen.csv')).toEqual([
      {
        name: '',
        rows: [
          ['Nummer', 'Anlage', 'Prüfungen', 'Anteil', 'Fällig am', 'Bemerkung'],
          ['AN-00012', 'Lüftung Großküche', '3', '0,5', '02.10.2026'],
          ['AN-00013', 'Aufzug "Nord"; Haus A', '0', '-1,25', '31.12.1999', 'Zwei Zeilen'],
        ],
      },
    ])
  })

  it('begins with the mark of UTF-8 and divides by semicolons, with line breaks of Windows', () => {
    const written = text(tableAsCsv(list))

    expect(
      written.startsWith(`${mark}Nummer;Anlage;Prüfungen;Anteil;Fällig am;Bemerkung\r\n`),
    ).toBe(true)
    expect(written).toContain(
      '\r\nAN-00013;"Aufzug ""Nord""; Haus A";0;-1,25;31.12.1999;"Zwei\nZeilen"\r\n',
    )
    expect(written.endsWith('\r\n')).toBe(true)
  })

  it('puts an apostrophe in front of a value that begins like a formula', () => {
    const written = text(
      tableAsCsv({ name: 'Liste', columns: ['=Wert'], rows: formulas.map((value) => [value]) }),
    )

    expect(written.split('\r\n')).toEqual([
      `${mark}'=Wert`,
      "'=1+1",
      "'+49 621 000",
      "'-5 Grad",
      "'@SUMME(A1)",
      `"'\t=1+1"`,
      `"'\r=1+1"`,
      '',
    ])
  })

  /**
   * Only the semicolon this file is divided by was quoted for. A program that
   * takes the comma or the tab for the separator began a cell in the middle
   * of such a value, and a formula standing there was no longer behind an
   * apostrophe.
   */
  it('quotes a value with a comma or a tab, so that no other separator splits it', () => {
    const table: OutgoingTable = {
      name: 'Liste',
      columns: ['Notiz'],
      rows: [['Halle,=HYPERLINK("x")'], ['Hof\t+1']],
    }

    expect(text(tableAsCsv(table))).toBe(
      `${mark}Notiz\r\n"Halle,=HYPERLINK(""x"")"\r\n"Hof\t+1"\r\n`,
    )
    expect(readBack(tableAsCsv(table), 'Liste.csv')[0]?.rows).toEqual([
      ['Notiz'],
      ['Halle,=HYPERLINK("x")'],
      ['Hof +1'],
    ])
  })

  it('quotes a value with a semicolon, so that it stays one value', () => {
    const table: OutgoingTable = {
      name: 'Liste',
      columns: ['Ort', 'Art'],
      rows: [['Halle 1; Hof', 'Lager']],
    }

    expect(text(tableAsCsv(table))).toBe(`${mark}Ort;Art\r\n"Halle 1; Hof";Lager\r\n`)
    expect(readBack(tableAsCsv(table), 'Liste.csv')[0]?.rows).toEqual([
      ['Ort', 'Art'],
      ['Halle 1; Hof', 'Lager'],
    ])
  })

  it('writes a negative number as a number, not as text with an apostrophe', () => {
    expect(text(tableAsCsv({ name: 'Liste', columns: ['Zahl'], rows: [[-3]] }))).toBe(
      `${mark}Zahl\r\n-3\r\n`,
    )
  })
})

describe('what begins like a formula', () => {
  it('is a value that begins with =, +, -, @, a tab or a carriage return', () => {
    expect(formulas.map(readAsFormula)).toEqual(formulas.map(() => true))
  })

  it('is no other value', () => {
    expect(['Aufzug', ' =1', '1-2', 'a@b.de', '', "'=1"].map(readAsFormula)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('the format a table is asked for in', () => {
  it('is xlsx or csv', () => {
    expect(tableFormatOf({ format: 'xlsx' })).toBe('xlsx')
    expect(tableFormatOf({ format: 'csv' })).toBe('csv')
  })

  it('is refused in words where it is another one or none', () => {
    for (const query of [{}, { format: 'xls' }, { format: ['csv', 'xlsx'] }, { format: '' }]) {
      expect(() => tableFormatOf(query)).toThrow(BadRequestException)
    }

    expect(() => tableFormatOf({ format: 'pdf' })).toThrow(
      'Eine Tabelle gibt es als xlsx oder als csv.',
    )
  })
})

describe('the answer with a table', () => {
  it('is a file to save, named after the list and the day', () => {
    const answer = tableAnswer(list, 'xlsx', '2026-10-11')
    const headers = answer.getHeaders()

    expect(headers.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(headers.disposition).toBe(
      `attachment; filename="Anlagen 2026-10-11.xlsx"; filename*=UTF-8''Anlagen%202026-10-11.xlsx`,
    )
  })

  it('names the text of separated values as UTF-8, and a list with a slash in its name for every system', () => {
    const headers = tableAnswer({ ...list, name: 'Mängel/offen' }, 'csv', '2026-10-11').getHeaders()

    expect(headers.type).toBe('text/csv; charset=utf-8')
    expect(headers.disposition).toBe(
      `attachment; filename="M_ngel offen 2026-10-11.csv"; filename*=UTF-8''M%C3%A4ngel%20offen%202026-10-11.csv`,
    )
  })

  it('is refused in words for a list longer than a table goes out with, and never cut', () => {
    const rowsOf = (count: number) => Array.from({ length: count }, () => ['AN-00012'])
    const longest = tableAnswer(
      { name: 'Anlagen', columns: ['Nummer'], rows: rowsOf(outgoingTableRows) },
      'csv',
      '2026-10-11',
    )

    expect(longest.getHeaders().length).toBeGreaterThan(outgoingTableRows)
    expect(() =>
      tableAnswer(
        { name: 'Anlagen', columns: ['Nummer'], rows: rowsOf(outgoingTableRows + 1) },
        'csv',
        '2026-10-11',
      ),
    ).toThrow(new UnprocessableEntityException(tooLongForATable))
    expect(tooLongForATable).toBe(
      'Die Liste hat mehr als 50.000 Zeilen. Grenzen Sie sie mit dem Filter ein.',
    )
  })
})
