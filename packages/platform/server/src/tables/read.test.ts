import {
  columnLetters,
  type TableFile,
  tableLimits,
  tooManyColumns,
  tooManyRows,
  tooMuch,
} from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { packedOf, type ProbeZipEntry, zipOf } from '../files/probe-zip.js'
import { TableRefused } from './limits.js'
import { tableFileOf, tableFileTooLarge } from './read.js'

/**
 * A file somebody chose, read as the table it is. The workbooks are written
 * here, part by part, the way a spreadsheet writes them: what is held is what
 * the reader makes of the XML a program really saves, and of everything a
 * file can be that is no table or more than is read.
 */

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packaging = 'http://schemas.openxmlformats.org/package/2006/relationships'
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

interface ProbeSheet {
  readonly name: string
  /** What stands in `sheetData`: the rows of the sheet as XML. */
  readonly rows: string
  readonly state?: 'visible' | 'hidden' | 'veryHidden'
  /** Where the workbook says the sheet lies; `worksheets/sheet<n>.xml` where nothing is said. */
  readonly target?: string
  /** Where the part lies in the archive, where that cannot be read off `target` as it stands. */
  readonly path?: string
  /** The part itself, in place of the one that is written from `rows`. */
  readonly part?: ProbeZipEntry['bytes']
}

interface ProbeWorkbook {
  readonly sheets: readonly ProbeSheet[]
  /** The strings the cells share, each as what stands inside its `si`. */
  readonly strings?: readonly string[]
  /**
   * The formats of the cells, in the order a cell names them with `s`: the
   * number of one a spreadsheet has built in, or the code of one somebody wrote.
   */
  readonly formats?: readonly (number | string)[]
  /** The formats as a whole part, in place of the one that is written from `formats`. */
  readonly styles?: string
  readonly from1904?: boolean
  /** Entries beside the parts of the table: pictures, charts, whatever else. */
  readonly further?: readonly ProbeZipEntry[]
  /** How the packer wrote every part, where it did not deflate them with their sizes in front. */
  readonly packing?: Pick<ProbeZipEntry, 'stored' | 'streamed'>
}

const attribute = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

function sheetXml(rows: string): string {
  return (
    `${declaration}<worksheet xmlns="${main}" xmlns:r="${office}">` +
    '<dimension ref="A1"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' +
    `<sheetFormatPr baseColWidth="10" defaultRowHeight="15"/><sheetData>${rows}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.78" bottom="0.78" header="0.3" footer="0.3"/></worksheet>'
  )
}

function stylesXml(formats: readonly (number | string)[]): string {
  const written = formats.filter((format) => typeof format === 'string')
  const idOf = (format: number | string) =>
    typeof format === 'number' ? format : 164 + written.indexOf(format)

  return (
    `${declaration}<styleSheet xmlns="${main}">` +
    (written.length > 0
      ? `<numFmts count="${written.length}">${written
          .map(
            (code, index) => `<numFmt numFmtId="${164 + index}" formatCode="${attribute(code)}"/>`,
          )
          .join('')}</numFmts>`
      : '') +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${formats.length}">${formats
      .map(
        (format) =>
          `<xf numFmtId="${idOf(format)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
      )
      .join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  )
}

/** A workbook as a spreadsheet saves it: the parts of the table, and around them what every such file carries. */
function workbookOf(workbook: ProbeWorkbook): Uint8Array {
  const targets = workbook.sheets.map(
    (sheet, index) => sheet.target ?? `worksheets/sheet${index + 1}.xml`,
  )
  const paths = targets.map(
    (target, index) =>
      workbook.sheets[index]?.path ?? (target.startsWith('/') ? target.slice(1) : `xl/${target}`),
  )
  const strings = workbook.strings ?? []
  const sheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
  const entries: ProbeZipEntry[] = [
    {
      path: '[Content_Types].xml',
      bytes:
        `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        paths.map((path) => `<Override PartName="/${path}" ContentType="${sheetType}"/>`).join('') +
        '</Types>',
    },
    {
      path: '_rels/.rels',
      bytes:
        `${declaration}<Relationships xmlns="${packaging}">` +
        `<Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    },
    {
      path: 'xl/workbook.xml',
      bytes:
        `${declaration}<workbook xmlns="${main}" xmlns:r="${office}">` +
        '<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/>' +
        `<workbookPr${workbook.from1904 ? ' date1904="1"' : ''} defaultThemeVersion="166925"/>` +
        '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews>' +
        `<sheets>${workbook.sheets
          .map(
            (sheet, index) =>
              `<sheet name="${attribute(sheet.name)}" sheetId="${index + 1}"` +
              (sheet.state ? ` state="${sheet.state}"` : '') +
              ` r:id="rId${index + 1}"/>`,
          )
          .join('')}</sheets><calcPr calcId="191029"/></workbook>`,
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      bytes:
        `${declaration}<Relationships xmlns="${packaging}">` +
        targets
          .map(
            (target, index) =>
              `<Relationship Id="rId${index + 1}" Type="${office}/worksheet" Target="${target}"/>`,
          )
          .join('') +
        `<Relationship Id="rId${targets.length + 1}" Type="${office}/theme" Target="theme/theme1.xml"/>` +
        `<Relationship Id="rId${targets.length + 2}" Type="${office}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId${targets.length + 3}" Type="${office}/sharedStrings" Target="sharedStrings.xml"/>` +
        '</Relationships>',
    },
    { path: 'xl/theme/theme1.xml', bytes: `${declaration}<a:theme xmlns:a="urn:theme"/>` },
    {
      path: 'xl/styles.xml',
      bytes: workbook.styles ?? stylesXml(workbook.formats ?? [0]),
    },
    {
      path: 'xl/sharedStrings.xml',
      bytes:
        `${declaration}<sst xmlns="${main}" count="${strings.length}" uniqueCount="${strings.length}">` +
        strings.map((string) => (string === '' ? '<si/>' : `<si>${string}</si>`)).join('') +
        '</sst>',
    },
    ...workbook.sheets.map((sheet, index) => ({
      path: paths[index] ?? '',
      bytes: sheet.part ?? sheetXml(sheet.rows),
    })),
  ]

  return zipOf([
    ...entries.map((entry) => ({ ...entry, ...workbook.packing })),
    ...(workbook.further ?? []),
  ])
}

const read = (workbook: ProbeWorkbook): TableFile => tableFileOf(workbookOf(workbook), 'Liste.xlsx')

/** The rows of a workbook with one sheet. */
const rowsOf = (rows: string, more: Partial<ProbeWorkbook> = {}) =>
  read({ sheets: [{ name: 'Tabelle1', rows }], ...more }).sheets[0]?.rows

/** The cells of the first row of a workbook with one sheet. */
const cellsOf = (cells: string, more: Partial<ProbeWorkbook> = {}) =>
  rowsOf(`<row r="1">${cells}</row>`, more)?.[0]

/** What a number shows under a format, built in or written. */
const shown = (value: string, format: number | string, more: Partial<ProbeWorkbook> = {}) =>
  cellsOf(`<c r="A1" s="1"><v>${value}</v></c>`, { formats: [0, format], ...more })?.[0]

/** The sentence a file is refused with, or null where it is read. */
function refusalOf(readFile: () => unknown): string | null {
  try {
    readFile()

    return null
  } catch (error) {
    if (!(error instanceof TableRefused)) {
      throw error
    }

    return error.message
  }
}

const bytesOf = (text: string) => new TextEncoder().encode(text)

const megabyte = 1_000_000

describe('a workbook as a spreadsheet saves it', () => {
  it('is read as its sheet: the rows of cells, each as the text somebody reads in it', () => {
    const file = tableFileOf(
      workbookOf({
        strings: ['<t>Raum-Nr.</t>', '<t>Bezeichnung</t>', '<t>Fläche</t>', '<t>Büro</t>'],
        formats: [0, 14],
        sheets: [
          {
            name: 'Räume',
            rows:
              '<row r="1" spans="1:4"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Geprüft am</t></is></c></row>' +
              '<row r="2" spans="1:4"><c r="A2"><v>101</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>12.5</v></c><c r="D2" s="1"><v>46297</v></c></row>',
          },
        ],
      }),
      'Raumliste 2026.xlsx',
    )

    expect(file).toEqual({
      name: 'Raumliste 2026.xlsx',
      sheets: [
        {
          name: 'Räume',
          rows: [
            ['Raum-Nr.', 'Bezeichnung', 'Fläche', 'Geprüft am'],
            ['101', 'Büro', '12,5', '02.10.2026'],
          ],
        },
      ],
    })
  })

  it('is read whether its parts are deflated, stored or written with their sizes behind them', () => {
    const workbook: ProbeWorkbook = {
      sheets: [{ name: 'Tabelle1', rows: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }],
      strings: ['<t>Raum</t>'],
    }

    for (const packing of [
      {},
      { stored: true },
      { streamed: true },
      { stored: true, streamed: true },
    ]) {
      expect(tableFileOf(workbookOf({ ...workbook, packing }), 'a.xlsx').sheets).toEqual([
        { name: 'Tabelle1', rows: [['Raum']] },
      ])
    }
  })
})

describe('a text in a cell of a workbook', () => {
  it('is the string the cell points to among those the cells share', () => {
    expect(
      cellsOf(
        '<c r="A1" t="s"><v>2</v></c><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c>',
        {
          strings: ['<t>Büro</t>', '<t>Lager</t>', '<t>Flur</t>'],
        },
      ),
    ).toEqual(['Flur', 'Büro', 'Flur'])
  })

  it('is the runs of a string one after the other, whatever each looks like', () => {
    expect(
      cellsOf('<c r="A1" t="s"><v>0</v></c>', {
        strings: [
          '<r><rPr><b/><sz val="11"/><rFont val="Calibri"/></rPr><t>Bü</t></r><r><t xml:space="preserve">ro </t></r><r><rPr><i/></rPr><t>Nord</t></r>',
        ],
      }),
    ).toEqual(['Büro Nord'])
  })

  it('is without the reading aid a string carries beside itself', () => {
    expect(
      cellsOf('<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>', {
        strings: [
          '<t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh><phoneticPr fontId="1"/>',
          '<r><t>課</t></r><rPh sb="0" eb="1"><t>カ</t></rPh><r><t>長</t></r>',
        ],
      }),
    ).toEqual(['東京', '課長'])
  })

  it('keeps its place among the shared strings where one of them is empty', () => {
    const strings = workbookOf({
      sheets: [
        {
          name: 'Tabelle1',
          rows: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
        },
      ],
      strings: ['<t>a</t>', '<t/>', '<t>c</t>'],
    })

    expect(tableFileOf(strings, 'a.xlsx').sheets[0]?.rows).toEqual([['a', '', 'c']])
    // The same where the empty string is written as an element that ends at once.
    expect(
      rowsOf(
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
        { strings: ['<t>a</t>', '', '<t>c</t>'] },
      ),
    ).toEqual([['a', '', 'c']])
  })

  it('is empty where the cell points to no string, and never the first of them', () => {
    expect(
      cellsOf(
        '<c r="A1" t="s"><v></v></c><c r="B1" t="s"><v/></c><c r="C1" t="s"/><c r="D1" t="s"><v>7</v></c><c r="E1" t="s"><v>1</v></c>',
        { strings: ['<t>Büro</t>', '<t>Lager</t>'] },
      ),
    ).toEqual(['', '', '', '', 'Lager'])
  })

  it('is the string written into the cell itself, in one piece or in runs', () => {
    expect(
      cellsOf(
        '<c r="A1" t="inlineStr"><is><t>Büro</t></is></c>' +
          '<c r="B1" t="inlineStr"><is><r><rPr><b/></rPr><t>La</t></r><r><t>ger</t></r></is></c>' +
          '<c r="C1" t="inlineStr"><is><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></is></c>',
      ),
    ).toEqual(['Büro', 'Lager', '東京'])
  })

  it('has the characters a program wrote as a code put back', () => {
    expect(
      cellsOf(
        '<c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Raum_x0041_</t></is></c><c r="C1" t="str"><f>A1&amp;B1</f><v>Zeile 1_x000D_\nZeile 2</v></c><c r="D1" t="s"><v>1</v></c>',
        { strings: ['<t>Zeile 1_x000D_\nZeile 2</t>', '<t>Typ_x005F_x0041_</t>'] },
      ),
    ).toEqual(['Zeile 1 Zeile 2', 'RaumA', 'Zeile 1 Zeile 2', 'Typ_x0041_'])
  })

  it('has its entities resolved', () => {
    expect(
      cellsOf(
        '<c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>R&#228;ume &lt; 10 m&#xB2;</t></is></c>',
        { strings: ['<t>Müller &amp; S&#246;hne &quot;Nord&quot;</t>'] },
      ),
    ).toEqual(['Müller & Söhne "Nord"', 'Räume < 10 m²'])
  })

  it('is one line without the spaces around it', () => {
    expect(
      cellsOf('<c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t> Büro </t></is></c>', {
        strings: ['<t xml:space="preserve">  Zeile 1\r\nZeile 2\n\nZeile 3  </t>'],
      }),
    ).toEqual(['Zeile 1 Zeile 2 Zeile 3', 'Büro'])
  })

  it('is cut and marked where it is longer than a cell is read', () => {
    const [cell] =
      cellsOf(
        `<c r="A1" t="inlineStr"><is><t>${'x'.repeat(tableLimits.cellLength + 50)}</t></is></c>`,
      ) ?? []

    expect(cell).toBe(`${'x'.repeat(tableLimits.cellLength)}…`)
  })
})

describe('a value in a cell of a workbook', () => {
  it('is a whole number as it stands', () => {
    expect(
      cellsOf(
        '<c r="A1"><v>42</v></c><c r="B1"><v>-7</v></c><c r="C1" t="n"><v>0</v></c><c r="D1"><v>4012345678901</v></c><c r="E1"><v>1E3</v></c>',
      ),
    ).toEqual(['42', '-7', '0', '4012345678901', '1000'])
  })

  it('is a number with a decimal comma', () => {
    expect(
      cellsOf(
        '<c r="A1"><v>12.5</v></c><c r="B1"><v>-0.25</v></c><c r="C1"><v>1234567.891</v></c><c r="D1"><v>1.2E-2</v></c>',
      ),
    ).toEqual(['12,5', '-0,25', '1234567,891', '0,012'])
  })

  it('is without the digits that only a binary fraction has', () => {
    expect(
      cellsOf(
        '<c r="A1"><v>0.30000000000000004</v></c><c r="B1"><v>1.1000000000000001</v></c><c r="C1"><v>2.2999999999999998</v></c><c r="D1"><v>12.499999999999998</v></c>',
      ),
    ).toEqual(['0,3', '1,1', '2,3', '12,5'])
  })

  it('is ja or nein for yes and no', () => {
    expect(cellsOf('<c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c>')).toEqual([
      'ja',
      'nein',
    ])
  })

  it('is nothing where a formula failed', () => {
    expect(
      cellsOf(
        '<c r="A1" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="B1" t="e"><v>#N/A</v></c><c r="C1"><v>1</v></c>',
      ),
    ).toEqual(['', '', '1'])
  })

  it('is what a formula came to when the file was saved, and never the formula', () => {
    expect(
      cellsOf(
        '<c r="A1"><f>SUM(B1:C1)</f><v>3.5</v></c><c r="B1" t="str"><f>"Raum "&amp;A1</f><v>Raum 3,5</v></c><c r="C1" t="b"><f>A1&gt;1</f><v>1</v></c><c r="D1"><f>A1</f></c>',
      ),
    ).toEqual(['3,5', 'Raum 3,5', 'ja'])
  })

  it('is what stands there where it is no number after all', () => {
    expect(cellsOf('<c r="A1"><v>101a</v></c>')).toEqual(['101a'])
  })
})

describe('a number that counts a day', () => {
  it('is written as a day under the format a spreadsheet has built in for one', () => {
    // The anchors of the count: the first day, the days around a 29 February
    // 1900 that never was and is counted all the same, and two New Year's Days.
    expect(shown('1', 14)).toBe('01.01.1900')
    expect(shown('59', 14)).toBe('28.02.1900')
    expect(shown('61', 14)).toBe('01.03.1900')
    expect(shown('25569', 14)).toBe('01.01.1970')
    expect(shown('45658', 14)).toBe('01.01.2025')
    // 639 days on: the 365 of 2025 and the 274 before the 2 October.
    expect(shown('46297', 14)).toBe('02.10.2026')
    // A leap day that was one.
    expect(shown('45351', 14)).toBe('29.02.2024')
  })

  it('is written as a day under every format built in for a day', () => {
    for (const format of [14, 15, 16, 17, 22]) {
      expect(shown('46297', format)).toBe('02.10.2026')
    }
  })

  it('is written as a day under a format somebody wrote for one', () => {
    for (const code of [
      'dd/mm/yyyy',
      'DD.MM.YYYY',
      '[$-407]dd.mm.yyyy',
      '[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy',
      'yyyy\\-mm\\-dd',
      'd/m/yy;@',
      'mmm\\ yy',
    ]) {
      expect(shown('46297', code), code).toBe('02.10.2026')
    }
  })

  it('stays a number under a format that only reads like one for a day', () => {
    for (const code of [
      '0.00 "m"',
      '0 "Stück"',
      '#,##0.00\\ "h"',
      '0.00;[Red]\\-0.00',
      '0\\ \\m\\m',
      '#,##0.00_d',
      '_-* #,##0.00\\ "€"_-;\\-* #,##0.00\\ "€"_-;_-* "-"??\\ "€"_-;_-@_-',
      '0 "%"',
      'General',
      '@',
    ]) {
      expect(shown('12.5', code), code).toBe('12,5')
    }
  })

  it('stays a number under the formats built in for numbers', () => {
    for (const format of [0, 1, 2, 3, 4, 11, 12, 13, 37, 38, 39, 40, 44, 48, 49]) {
      expect(shown('46297', format), String(format)).toBe('46297')
    }
  })

  it('is so many of a hundred under a format for a share, as the sheet shows it', () => {
    expect(shown('0.19', 9)).toBe('19 %')
    expect(shown('0.125', 10)).toBe('12,5 %')
    expect(shown('0.07', '0.0%')).toBe('7 %')
    expect(shown('1', '0%')).toBe('100 %')
    // A percent sign that is written behind the number as text divides nothing.
    expect(shown('19', '0 "%"')).toBe('19')
  })

  it('is a time alone where it counts no whole day', () => {
    expect(shown('0.5', 20)).toBe('12:00')
    expect(shown('0.604166666666667', 20)).toBe('14:30')
    expect(shown('0.604178240740741', 21)).toBe('14:30:01')
    expect(shown('0.999988425925926', 'hh:mm:ss')).toBe('23:59:59')
    expect(shown('0', 20)).toBe('00:00')
  })

  it('is a day with its time where it counts both', () => {
    expect(shown('46297.604166666664', 22)).toBe('02.10.2026 14:30')
    expect(shown('46297.25', 'dd/mm/yyyy\\ hh:mm')).toBe('02.10.2026 06:00')
    expect(shown('46297.604178240741', 'dd/mm/yyyy\\ hh:mm:ss')).toBe('02.10.2026 14:30:01')
  })

  it('is the next day where its time is a breath before midnight, and never an hour 24', () => {
    expect(shown('46296.999999999', 22)).toBe('02.10.2026')
    expect(shown('0.999999999', 22)).toBe('01.01.1900')
  })

  it('is counted from 1904 in a workbook that says so', () => {
    // The two counts lie 1462 days apart.
    expect(shown('44835', 14, { from1904: true })).toBe('02.10.2026')
    expect(shown('0', 14, { from1904: true })).toBe('01.01.1904')
    expect(shown('1', 14, { from1904: true })).toBe('02.01.1904')
    expect(shown('44835.5', 22, { from1904: true })).toBe('02.10.2026 12:00')
    expect(shown('0.5', 20, { from1904: true })).toBe('12:00')
  })

  it('is a day by the format of its own cell and of no other', () => {
    expect(
      cellsOf(
        '<c r="A1"><v>46297</v></c><c r="B1" s="0"><v>46297</v></c><c r="C1" s="1"><v>46297</v></c><c r="D1" s="2"><v>46297</v></c><c r="E1" s="7"><v>46297</v></c>',
        { formats: [0, 14, '0.00'] },
      ),
    ).toEqual(['46297', '46297', '02.10.2026', '46297', '46297'])
  })

  it('is a day by the formats of the cells, not by those of the styles they are based on', () => {
    const styles =
      `${declaration}<styleSheet xmlns="${main}">` +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.00\\ &quot;m&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
      '<cellStyleXfs count="2"><xf numFmtId="14"/><xf numFmtId="165"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" xfId="0"/><xf numFmtId="164" xfId="1"/><xf numFmtId="165" xfId="0"/></cellXfs>' +
      '</styleSheet>'

    expect(
      cellsOf(
        '<c r="A1" s="0"><v>46297</v></c><c r="B1" s="1"><v>46297</v></c><c r="C1" s="2"><v>46297</v></c>',
        { styles },
      ),
    ).toEqual(['46297', '46297', '02.10.2026'])
  })

  it('is a text all the same where the cell holds one under a format for a day', () => {
    expect(
      cellsOf(
        '<c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="inlineStr"><is><t>offen</t></is></c><c r="C1" s="1"><v>bald</v></c><c r="D1" s="1"><v></v></c>',
        { formats: [0, 14], strings: ['<t>46297</t>'] },
      ),
    ).toEqual(['46297', 'offen', 'bald'])
  })

  it('is read where a program wrote the day out instead of counting it', () => {
    expect(
      cellsOf(
        '<c r="A1" t="d"><v>2026-10-02T00:00:00</v></c><c r="B1" t="d"><v>2026-10-02</v></c><c r="C1" t="d"><v>2026-10-02T14:30:00Z</v></c><c r="D1" t="d"><v>irgendwann</v></c>',
      ),
    ).toEqual(['02.10.2026', '02.10.2026', '02.10.2026 14:30', 'irgendwann'])
  })
})

describe('where a cell of a workbook stands', () => {
  it('is said by its reference, with nothing in the cells and rows that are left out', () => {
    expect(
      rowsOf(
        '<row r="2"><c r="B2"><v>1</v></c><c r="E2"><v>2</v></c></row>' +
          '<row r="5"><c r="A5"><v>3</v></c><c r="AA5"><v>4</v></c></row>',
      ),
    ).toEqual([[], ['', '1', '', '', '2'], [], [], ['3', ...new Array<string>(25).fill(''), '4']])
  })

  it('is the next in its row and the next row where nothing says it', () => {
    expect(
      rowsOf(
        '<row><c><v>1</v></c><c><v>2</v></c></row><row><c t="inlineStr"><is><t>drei</t></is></c></row>',
      ),
    ).toEqual([['1', '2'], ['drei']])
  })

  it('goes on from the last that was said', () => {
    expect(
      rowsOf(
        '<row r="3"><c r="C3"><v>1</v></c><c><v>2</v></c></row><row><c><v>3</v></c><c r="C4"><v>4</v></c><c><v>5</v></c></row>',
      ),
    ).toEqual([[], [], ['', '', '1', '2'], ['3', '', '4', '5']])
  })

  it('is read the same where the elements stand under a prefix', () => {
    const part =
      `${declaration}<x:worksheet xmlns:x="${main}"><x:sheetData>` +
      '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Raum</x:t></x:is></x:c><x:c r="B1" t="s"><x:v>0</x:v></x:c></x:row>' +
      '<x:row r="2"><x:c r="A2"><x:v>101</x:v></x:c><x:c r="B2" s="1"><x:v>46297</x:v></x:c></x:row>' +
      '</x:sheetData></x:worksheet>'

    expect(
      rowsOf('', {
        sheets: [{ name: 'Tabelle1', rows: '', part }],
        strings: ['<t>Geprüft am</t>'],
        formats: [0, 14],
      }),
    ).toEqual([
      ['Raum', 'Geprüft am'],
      ['101', '02.10.2026'],
    ])
  })

  it('ends a row at its last cell that holds anything, and the sheet at its last such row', () => {
    expect(
      rowsOf(
        '<row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1"/><c r="C1" t="inlineStr"><is><t> </t></is></c><c r="D1"><v></v></c></row>' +
          '<row r="2"><c r="A2" s="1"/></row><row r="3"><c r="A3" t="s"><v>0</v></c></row>',
        { strings: ['<t/>'], formats: [0, 14] },
      ),
    ).toEqual([['1']])
  })
})

describe('the sheets of a workbook', () => {
  const one = (text: string) =>
    `<row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row>`

  it('come in the order of the workbook, under the names somebody gave them', () => {
    const file = read({
      sheets: [
        { name: 'Räume & Flure', rows: one('erstes') },
        { name: 'Übersicht "Süd"', rows: one('zweites') },
        { name: 'Größen <10 m²', rows: one('drittes') },
      ],
    })

    expect(file.sheets).toEqual([
      { name: 'Räume & Flure', rows: [['erstes']] },
      { name: 'Übersicht "Süd"', rows: [['zweites']] },
      { name: 'Größen <10 m²', rows: [['drittes']] },
    ])
  })

  it('are the ones somebody sees: a hidden one is not read', () => {
    const file = read({
      sheets: [
        { name: 'Verborgen', rows: one('nein'), state: 'hidden' },
        { name: 'Sichtbar', rows: one('ja'), state: 'visible' },
        { name: 'Ganz verborgen', rows: one('nein'), state: 'veryHidden' },
        { name: 'Auch sichtbar', rows: one('ja') },
      ],
    })

    expect(file.sheets.map((sheet) => sheet.name)).toEqual(['Sichtbar', 'Auch sichtbar'])
  })

  it('are the ones that hold anything: an empty one is left out', () => {
    const file = read({
      sheets: [
        { name: 'Leer', rows: '' },
        { name: 'Räume', rows: one('Raum') },
        { name: 'Nur Formate', rows: '<row r="1" s="1" customFormat="1"><c r="A1" s="1"/></row>' },
      ],
    })

    expect(file.sheets).toEqual([{ name: 'Räume', rows: [['Raum']] }])
  })

  it('lie where the workbook says, from its own folder or from the root of the file', () => {
    const file = read({
      sheets: [
        { name: 'Neben', rows: one('neben'), target: 'worksheets/sheet1.xml' },
        { name: 'Wurzel', rows: one('wurzel'), target: '/xl/worksheets/sheet2.xml' },
        { name: 'Woanders', rows: one('woanders'), target: '/tabellen/drei.xml' },
        {
          name: 'Umweg',
          rows: one('umweg'),
          target: './blatt/../blatt/vier.xml',
          path: 'xl/blatt/vier.xml',
        },
        { name: 'Hinauf', rows: one('hinauf'), target: '../xl/fünf.xml', path: 'xl/fünf.xml' },
      ],
    })

    expect(file.sheets.map((sheet) => [sheet.name, sheet.rows[0]?.[0]])).toEqual([
      ['Neben', 'neben'],
      ['Wurzel', 'wurzel'],
      ['Woanders', 'woanders'],
      ['Umweg', 'umweg'],
      ['Hinauf', 'hinauf'],
    ])
  })

  it('find their strings and their formats where the workbook says, not under a fixed name', () => {
    const strict = 'http://purl.oclc.org/ooxml/officeDocument/relationships'
    const workbook = zipOf([
      {
        path: 'xl/workbook.xml',
        bytes: `<x:workbook xmlns:x="${main}" xmlns:rel="${strict}"><x:sheets><x:sheet name="Räume" sheetId="1" rel:id="blatt"/></x:sheets></x:workbook>`,
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        bytes:
          `<Relationships xmlns="${packaging}">` +
          `<Relationship Id="texte" Type="${strict}/sharedStrings" Target="texte.xml"/>` +
          `<Relationship Id="formate" Type="${strict}/styles" Target="/formate.xml"/>` +
          `<Relationship Id="blatt" Type="${strict}/worksheet" Target="blatt.xml"/>` +
          `<Relationship Id="fern" Type="${strict}/worksheet" Target="file:///C:/fern.xml" TargetMode="External"/>` +
          '</Relationships>',
      },
      { path: 'xl/texte.xml', bytes: `<sst xmlns="${main}"><si><t>Geprüft am</t></si></sst>` },
      // Under the names most programs use lie parts that are not the workbook's.
      { path: 'xl/sharedStrings.xml', bytes: `<sst xmlns="${main}"><si><t>falsch</t></si></sst>` },
      { path: 'xl/styles.xml', bytes: stylesXml([0, 0]) },
      { path: 'formate.xml', bytes: stylesXml([0, 14]) },
      {
        path: 'xl/blatt.xml',
        bytes: sheetXml(
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>46297</v></c></row>',
        ),
      },
    ])

    expect(tableFileOf(workbook, 'a.xlsx').sheets).toEqual([
      { name: 'Räume', rows: [['Geprüft am', '02.10.2026']] },
    ])
  })

  it('are read without strings and formats where the workbook has none', () => {
    const workbook = zipOf([
      {
        path: 'xl/workbook.xml',
        bytes: `<workbook xmlns="${main}" xmlns:r="${office}"><sheets><sheet name="Räume" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        bytes: `<Relationships xmlns="${packaging}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      },
      {
        path: 'xl/worksheets/sheet1.xml',
        bytes: sheetXml(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>Raum</t></is></c><c r="B1" s="3"><v>46297</v></c><c r="C1" t="s"><v>0</v></c></row>',
        ),
      },
    ])

    expect(tableFileOf(workbook, 'a.xlsx').sheets).toEqual([
      { name: 'Räume', rows: [['Raum', '46297']] },
    ])
  })

  it('are only the ones that are tables: a sheet of a chart and one the workbook does not find are left out', () => {
    const workbook = zipOf([
      {
        path: 'xl/workbook.xml',
        bytes:
          `<workbook xmlns="${main}" xmlns:r="${office}"><sheets>` +
          '<sheet name="Diagramm" sheetId="1" r:id="rId1"/><sheet name="Räume" sheetId="2" r:id="rId2"/>' +
          '<sheet name="Verloren" sheetId="3" r:id="rId9"/><sheet name="Ohne Teil" sheetId="4" r:id="rId3"/>' +
          '</sheets></workbook>',
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        bytes:
          `<Relationships xmlns="${packaging}">` +
          `<Relationship Id="rId1" Type="${office}/chartsheet" Target="chartsheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId3" Type="${office}/worksheet" Target="worksheets/sheet7.xml"/>` +
          '</Relationships>',
      },
      { path: 'xl/chartsheets/sheet1.xml', bytes: `<chartsheet xmlns="${main}"/>` },
      { path: 'xl/worksheets/sheet1.xml', bytes: sheetXml(one('Raum')) },
    ])

    expect(tableFileOf(workbook, 'a.xlsx').sheets).toEqual([{ name: 'Räume', rows: [['Raum']] }])
  })

  it('are no more than are read, counted without the hidden ones', () => {
    const many = (visible: number, hidden: number): ProbeWorkbook => ({
      sheets: [
        ...Array.from({ length: hidden }, (_, index) => ({
          name: `Verborgen ${index + 1}`,
          rows: one('nein'),
          state: 'hidden' as const,
        })),
        ...Array.from({ length: visible }, (_, index) => ({
          name: `Blatt ${index + 1}`,
          rows: one(String(index + 1)),
        })),
      ],
    })

    expect(read(many(tableLimits.sheets, 5)).sheets).toHaveLength(tableLimits.sheets)
    expect(refusalOf(() => read(many(tableLimits.sheets + 1, 0)))).toBe(
      'Die Arbeitsmappe hat mehr als 50 Blätter. Speichern Sie die Blätter, die übernommen werden, in eine eigene Datei.',
    )
  })
})

describe('how much of a workbook is read', () => {
  const lastLine = 1_048_576
  const filled = (reference: string) => `<c r="${reference}" t="inlineStr"><is><t>x</t></is></c>`

  it('does not count rows that are formatted and empty, down to the last line of a sheet', () => {
    const rows =
      `<row r="1">${filled('A1')}</row>` +
      `<row r="5000" s="1" customFormat="1"><c r="A5000" s="1"/><c r="XFD5000" s="1"/></row>` +
      `<row r="${lastLine}" s="1" customFormat="1"><c r="A${lastLine}" s="1"/><c r="B${lastLine}" s="1"><v></v></c><c r="XFD${lastLine}" t="inlineStr"><is><t> </t></is></c></row>`

    expect(rowsOf(rows, { formats: [0, 14] })).toEqual([['x']])
  })

  it('reads the last line that may hold anything, and refuses the file for one more', () => {
    const last = rowsOf(`<row r="${tableLimits.rows}">${filled(`A${tableLimits.rows}`)}</row>`)

    expect(last).toHaveLength(tableLimits.rows)
    expect(last?.at(-1)).toEqual(['x'])
    expect(
      refusalOf(() =>
        rowsOf(
          `<row r="1">${filled('A1')}</row><row r="${tableLimits.rows + 1}">${filled(`A${tableLimits.rows + 1}`)}</row>`,
        ),
      ),
    ).toBe(tooManyRows)
    expect(tooManyRows).toContain('10.000 Zeilen')
  })

  it('refuses a file with rows beyond the last line that are not numbered as well', () => {
    expect(refusalOf(() => rowsOf('<row><c><v>1</v></c></row>'.repeat(tableLimits.rows + 1)))).toBe(
      tooManyRows,
    )
  })

  it('reads the last column that may hold anything, and refuses the file for one more', () => {
    const lastColumn = columnLetters(tableLimits.columns - 1)
    const beyond = columnLetters(tableLimits.columns)

    expect(lastColumn).toBe('CV')
    expect(cellsOf(filled(`${lastColumn}1`))).toHaveLength(tableLimits.columns)
    expect(refusalOf(() => cellsOf(filled('A1') + filled(`${beyond}1`)))).toBe(tooManyColumns)
    expect(refusalOf(() => cellsOf('<c><v>1</v></c>'.repeat(tableLimits.columns + 1)))).toBe(
      tooManyColumns,
    )
    expect(tooManyColumns).toContain('100 Spalten')
  })

  it('refuses a file that holds more cells than are read at once, counted over all its sheets', () => {
    const row = `<row>${'<c><v>1</v></c>'.repeat(tableLimits.columns)}</row>`
    const half = tableLimits.cells / tableLimits.columns / 2
    const sheets = (rows: number) => [
      { name: 'Erstes', rows: row.repeat(half) },
      { name: 'Zweites', rows: row.repeat(rows) },
    ]

    expect(read({ sheets: sheets(half) }).sheets.map((sheet) => sheet.rows.length)).toEqual([
      half,
      half,
    ])
    expect(refusalOf(() => read({ sheets: sheets(half + 1) }))).toBe(tooMuch)
  })

  it('refuses a file that holds more characters than are read at once', () => {
    const cell = `<c t="inlineStr"><is><t>${'x'.repeat(tableLimits.cellLength)}</t></is></c>`
    const full = tableLimits.characters / tableLimits.cellLength

    expect(
      rowsOf(`<row>${cell.repeat(tableLimits.columns)}</row>`.repeat(full / tableLimits.columns)),
    ).toHaveLength(full / tableLimits.columns)
    expect(
      refusalOf(() =>
        rowsOf(
          `<row>${cell.repeat(tableLimits.columns)}</row>`.repeat(full / tableLimits.columns) +
            '<row><c><v>1</v></c></row>',
        ),
      ),
    ).toBe(tooMuch)
  })

  /**
   * The workbook that kept a reader busy for a minute and a gigabyte
   * (opengewerk-haustechnik#100): a file of a few kilobytes whose sheet
   * unpacks to more than is read. It is refused by what its directory says,
   * before a byte of it is unpacked.
   */
  it('refuses a sheet that unpacks to more than is read, at once', () => {
    const sheet = sheetXml(`<row r="1">${filled('A1')}</row>`)
    const cut = sheet.indexOf('</sheetData>')
    const padding = { piece: ' '.repeat(megabyte), times: tableLimits.unpackedBytes / megabyte + 1 }
    const bomb = workbookOf({
      sheets: [
        {
          name: 'Tabelle1',
          rows: '',
          part: packedOf(sheet.slice(0, cut), padding, sheet.slice(cut)),
        },
      ],
    })
    const started = performance.now()

    expect(bomb.length).toBeLessThan(megabyte)
    expect(refusalOf(() => tableFileOf(bomb, 'Liste.xlsx'))).toBe(
      'Die Arbeitsmappe entpackt sich zu mehr als 60 MB. Teilen Sie die Tabelle in mehrere Dateien.',
    )
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('refuses sheets that unpack to more than is read together', () => {
    const sheet = sheetXml(`<row r="1">${filled('A1')}</row>`)
    const cut = sheet.indexOf('</sheetData>')
    const half = { piece: ' '.repeat(megabyte), times: tableLimits.unpackedBytes / megabyte / 2 }
    const part = packedOf(sheet.slice(0, cut), half, sheet.slice(cut))

    expect(
      refusalOf(() =>
        read({
          sheets: [
            { name: 'Erstes', rows: '', part },
            { name: 'Zweites', rows: '', part },
          ],
        }),
      ),
    ).toBe(
      'Die Arbeitsmappe entpackt sich zu mehr als 60 MB. Teilen Sie die Tabelle in mehrere Dateien.',
    )
  })

  it('refuses a sheet that says it is small and unpacks to a gigabyte, at once', () => {
    // What the directory says of the sheet is a few kilobytes, and its checksum is not asked yet.
    const part = { ...packedOf({ piece: ' '.repeat(megabyte), times: 1024 }), size: 4000 }
    const bomb = workbookOf({ sheets: [{ name: 'Tabelle1', rows: '', part }] })
    const started = performance.now()

    expect(bomb.length).toBeLessThan(2 * megabyte)
    expect(refusalOf(() => tableFileOf(bomb, 'Liste.xlsx'))).toBe(
      'xl/worksheets/sheet1.xml ist im Archiv beschädigt.',
    )
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('does not unpack what is no part of the table, however large it is', () => {
    const large = packedOf({ piece: new Uint8Array(megabyte), times: 200 })
    const file = read({
      sheets: [
        { name: 'Räume', rows: `<row r="1">${filled('A1')}</row>` },
        { name: 'Verborgen', rows: '', state: 'hidden', part: large },
      ],
      further: [
        { path: 'xl/media/image1.png', bytes: large },
        { path: 'xl/drawings/drawing1.xml', bytes: large, says: { checksum: 1 } },
        { path: 'xl/worksheets/sheet9.xml', bytes: large },
        { path: 'docProps/app.xml', bytes: 'x', says: { method: 99 } },
      ],
    })

    expect(file.sheets).toEqual([{ name: 'Räume', rows: [['x']] }])
  })
})

describe('a file that is no table', () => {
  it('is an archive that is no workbook', () => {
    const notAWorkbook =
      'Die Datei ist ein ZIP-Archiv, aber keine Arbeitsmappe (.xlsx). Speichern Sie die Tabelle als .xlsx oder .csv.'

    expect(
      refusalOf(() =>
        tableFileOf(zipOf([{ path: 'Raumliste.csv', bytes: 'Raum;Etage\n101;1\n' }]), 'Liste.zip'),
      ),
    ).toBe(notAWorkbook)
    // A text document is an archive of parts as well, and so is a workbook without its relations.
    expect(
      refusalOf(() =>
        tableFileOf(
          zipOf([
            { path: '[Content_Types].xml', bytes: '<Types/>' },
            { path: 'word/document.xml', bytes: '<w:document/>' },
          ]),
          'Liste.docx',
        ),
      ),
    ).toBe(notAWorkbook)
    expect(
      refusalOf(() =>
        tableFileOf(zipOf([{ path: 'xl/workbook.xml', bytes: '<workbook/>' }]), 'Liste.xlsx'),
      ),
    ).toBe(notAWorkbook)
  })

  it('is a workbook in the old format or with a password, whatever it is called', () => {
    const old = new Uint8Array(4096)

    old.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

    expect(refusalOf(() => tableFileOf(old, 'Liste.xlsx'))).toBe(
      'Die Datei ist im alten Format (.xls) oder mit einem Kennwort geschützt. Speichern Sie die Tabelle als .xlsx ohne Kennwort oder als .csv.',
    )
  })

  it('is a picture, a PDF and any other file that is not text', () => {
    const neither =
      'Die Datei ist weder eine Arbeitsmappe (.xlsx) noch eine Tabelle als Text (.csv). Speichern Sie die Tabelle in einem der beiden Formate.'
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )

    expect(refusalOf(() => tableFileOf(png, 'Liste.csv'))).toBe(neither)
    expect(refusalOf(() => tableFileOf(bytesOf('Raum;Etage\n101;\u0000\n'), 'Liste.csv'))).toBe(
      neither,
    )
    expect(refusalOf(() => tableFileOf(new Uint8Array(100), 'Liste.csv'))).toBe(neither)
  })

  it('is an empty file', () => {
    expect(refusalOf(() => tableFileOf(new Uint8Array(0), 'Liste.csv'))).toBe('Die Datei ist leer.')
  })

  it('is a file in which nothing stands', () => {
    const nothing = 'In der Datei steht keine Zeile.'

    expect(refusalOf(() => tableFileOf(bytesOf('\r\n\r\n'), 'Liste.csv'))).toBe(nothing)
    expect(refusalOf(() => tableFileOf(bytesOf(' ;;\n;\t;\n'), 'Liste.csv'))).toBe(nothing)
    expect(
      refusalOf(() =>
        read({
          sheets: [
            { name: 'Tabelle1', rows: '' },
            { name: 'Tabelle2', rows: '<row r="1" s="1"><c r="A1" s="1"/></row>' },
          ],
        }),
      ),
    ).toBe(nothing)
    // A workbook of hidden sheets holds nothing somebody sees.
    expect(
      refusalOf(() =>
        read({
          sheets: [{ name: 'Verborgen', rows: '<row><c><v>1</v></c></row>', state: 'hidden' }],
        }),
      ),
    ).toBe(nothing)
  })

  it('is a file over the limit, and one of exactly the limit is read', () => {
    const full = new Uint8Array(tableLimits.fileBytes).fill(0x20)

    full.set(bytesOf('Raum;Etage\n101;1\n'))

    expect(tableFileOf(full, 'Liste.csv').sheets[0]?.rows).toEqual([
      ['Raum', 'Etage'],
      ['101', '1'],
    ])

    const over = new Uint8Array(tableLimits.fileBytes + 1).fill(0x20)

    over.set(bytesOf('Raum;Etage\n101;1\n'))

    expect(refusalOf(() => tableFileOf(over, 'Liste.csv'))).toBe(
      'Die Datei hat mehr als 10 MB. Teilen Sie die Tabelle in mehrere Dateien.',
    )
    expect(tableFileTooLarge).toBe(
      'Die Datei hat mehr als 10 MB. Teilen Sie die Tabelle in mehrere Dateien.',
    )
  })

  it('is a workbook that is damaged, said as of a table and not as of an archive', () => {
    const workbook = workbookOf({
      sheets: [{ name: 'Tabelle1', rows: '<row><c><v>1</v></c></row>' }],
    })
    const damaged = workbookOf({
      sheets: [
        {
          name: 'Tabelle1',
          rows: '',
          part: { ...packedOf(sheetXml('<row><c><v>1</v></c></row>')), checksum: 1 },
        },
      ],
    })

    expect(refusalOf(() => tableFileOf(workbook.subarray(0, workbook.length - 30), 'a.xlsx'))).toBe(
      'Die Datei ist kein vollständiges ZIP-Archiv.',
    )
    expect(refusalOf(() => tableFileOf(damaged, 'a.xlsx'))).toBe(
      'xl/worksheets/sheet1.xml ist im Archiv beschädigt.',
    )
  })
})

describe('a file of separated values', () => {
  const list = 'Raum;Größe;Preis\n101;12,5 m²;40 €\n'
  const rows = [
    ['Raum', 'Größe', 'Preis'],
    ['101', '12,5 m²', '40 €'],
  ]

  it('is one sheet without a name', () => {
    expect(tableFileOf(bytesOf(list), 'Räume.csv')).toEqual({
      name: 'Räume.csv',
      sheets: [{ name: '', rows }],
    })
  })

  it('is read as UTF-8 where it reads as that, with or without the mark at its beginning', () => {
    const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf(list)])

    expect(tableFileOf(bytesOf(list), 'a.csv').sheets[0]?.rows).toEqual(rows)
    expect(tableFileOf(marked, 'a.csv').sheets[0]?.rows).toEqual(rows)
  })

  it('is read in the Western encoding of Windows where it is no UTF-8', () => {
    // As a German spreadsheet saves "CSV": ö is F6, ß is DF, ² is B2 and the euro sign 80.
    const western = Uint8Array.from(
      [...list].map((character) => (character === '€' ? 0x80 : character.charCodeAt(0))),
    )

    expect([...western]).toEqual(expect.arrayContaining([0xf6, 0xdf, 0xb2, 0x80]))
    expect(tableFileOf(western, 'a.csv').sheets[0]?.rows).toEqual(rows)
  })

  it('is read as the Unicode a spreadsheet saves, in either order of its bytes', () => {
    const tabbed = list.replaceAll(';', '\t')
    const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tabbed, 'utf16le')])
    const big = Buffer.from(little).swap16()

    expect(tableFileOf(little, 'a.txt').sheets[0]?.rows).toEqual(rows)
    expect(tableFileOf(big, 'a.txt').sheets[0]?.rows).toEqual(rows)
  })

  it('has every cell as one line without the spaces around it, and a row as long as its last cell', () => {
    expect(
      tableFileOf(bytesOf('  Raum ;"Zeile 1\nZeile 2";;\n101;" x ";  ;\n'), 'a.csv').sheets[0]
        ?.rows,
    ).toEqual([
      ['Raum', 'Zeile 1 Zeile 2'],
      ['101', 'x'],
    ])
  })

  it('keeps every row on its line, and ends at the last one that holds anything', () => {
    expect(
      tableFileOf(bytesOf('\nRaum;Etage\n\n;;\n101;1\n\n\n'), 'a.csv').sheets[0]?.rows,
    ).toEqual([[], ['Raum', 'Etage'], [], [], ['101', '1']])
  })

  it('is cut and marked where a cell is longer than a cell is read', () => {
    const long = 'x'.repeat(tableLimits.cellLength + 50)

    expect(tableFileOf(bytesOf(`Raum;${long}\n`), 'a.csv').sheets[0]?.rows).toEqual([
      ['Raum', `${'x'.repeat(tableLimits.cellLength)}…`],
    ])
  })

  it('is held to the limits of a table as a workbook is', () => {
    const line = `${'x;'.repeat(tableLimits.columns - 1)}x\n`

    expect(
      tableFileOf(bytesOf('x\n'.repeat(tableLimits.rows)), 'a.csv').sheets[0]?.rows,
    ).toHaveLength(tableLimits.rows)
    expect(refusalOf(() => tableFileOf(bytesOf('x\n'.repeat(tableLimits.rows + 1)), 'a.csv'))).toBe(
      tooManyRows,
    )
    expect(tableFileOf(bytesOf(line), 'a.csv').sheets[0]?.rows[0]).toHaveLength(tableLimits.columns)
    expect(refusalOf(() => tableFileOf(bytesOf(`x;${line}`), 'a.csv'))).toBe(tooManyColumns)
    expect(
      tableFileOf(bytesOf(line.repeat(tableLimits.cells / tableLimits.columns)), 'a.csv').sheets[0]
        ?.rows,
    ).toHaveLength(tableLimits.cells / tableLimits.columns)
    expect(
      refusalOf(() =>
        tableFileOf(bytesOf(line.repeat(tableLimits.cells / tableLimits.columns + 1)), 'a.csv'),
      ),
    ).toBe(tooMuch)
  })

  it('is refused for more characters than are read at once', () => {
    const cell = 'x'.repeat(tableLimits.cellLength)
    const line = `${`${cell};`.repeat(tableLimits.columns - 1)}${cell}\n`
    const full = tableLimits.characters / (tableLimits.cellLength * tableLimits.columns)

    expect(tableFileOf(bytesOf(line.repeat(full)), 'a.csv').sheets[0]?.rows).toHaveLength(full)
    expect(refusalOf(() => tableFileOf(bytesOf(`${line.repeat(full)}x\n`), 'a.csv'))).toBe(tooMuch)
  })
})

describe('the name of a file that was read', () => {
  it('is one line without the spaces around it', () => {
    expect(tableFileOf(bytesOf('Raum\n'), '  Räume\r\n 2026.csv ').name).toBe('Räume 2026.csv')
  })

  it('is no longer than a name is kept', () => {
    expect(tableFileOf(bytesOf('Raum\n'), `${'ä'.repeat(300)}.csv`).name).toBe(
      'ä'.repeat(tableLimits.fileName),
    )
    expect(tableLimits.fileName).toBe(200)
  })

  it('never decides what the file is read as', () => {
    const workbook = workbookOf({
      sheets: [{ name: 'Tabelle1', rows: '<row><c><v>1</v></c></row>' }],
    })

    expect(tableFileOf(workbook, 'Liste.csv').sheets).toEqual([{ name: 'Tabelle1', rows: [['1']] }])
    expect(tableFileOf(bytesOf('Raum;Etage\n'), 'Liste.xlsx').sheets).toEqual([
      { name: '', rows: [['Raum', 'Etage']] },
    ])
    expect(tableFileOf(bytesOf('Raum\n'), '').name).toBe('')
  })
})
