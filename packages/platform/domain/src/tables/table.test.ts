import { describe, expect, it } from 'vitest'

import {
  cellText,
  columnLetters,
  columnMappingProblem,
  columnName,
  dayOfCell,
  fieldOfColumn,
  fieldsWithoutColumn,
  headerIndex,
  lineWords,
  suggestedMapping,
  tableColumns,
  type TableField,
  tableLimits,
  tableLineCount,
  tableNameKey,
  tableRecords,
  type TableSheet,
  tableSheetProblem,
  tooManyColumns,
  tooManyRows,
  tooMuch,
  wholeNumberOfCell,
  withColumn,
} from './table.js'

const sheetOf = (rows: readonly (readonly string[])[], name = ''): TableSheet => ({ name, rows })

/** A list of rooms as somebody keeps it, with a title above the names and a blank line in it. */
const rooms = sheetOf([
  [],
  ['Raumliste Nord'],
  ['Raum-Nr.', 'Bezeichnung', '', 'Fläche'],
  ['101', 'Büro', 'x', '12,5'],
  ['', '', '', ''],
  ['102', 'Lager'],
])

describe('the text of a cell', () => {
  it('is one line without the spaces around it', () => {
    expect(cellText('  Büro  ')).toBe('Büro')
    expect(cellText('Zeile 1\nZeile 2')).toBe('Zeile 1 Zeile 2')
    expect(cellText('Zeile 1\r\n\t Zeile 2')).toBe('Zeile 1 Zeile 2')
    expect(cellText('a   b')).toBe('a b')
    expect(cellText(' \n ')).toBe('')
    expect(cellText('')).toBe('')
  })

  it('stays as it is up to the limit', () => {
    const full = 'x'.repeat(tableLimits.cellLength)

    expect(cellText(full)).toBe(full)
  })

  it('keeps its beginning and one mark more when it is longer, so that it is still too long', () => {
    const cut = cellText('x'.repeat(tableLimits.cellLength) + 'yz')

    expect(cut).toHaveLength(tableLimits.cellLength + 1)
    expect(cut.slice(0, tableLimits.cellLength)).toBe('x'.repeat(tableLimits.cellLength))
    expect(cut.at(-1)).toBe('…')
    expect(cellText('x'.repeat(50_000))).toBe(cut)
  })

  it('is measured after the spaces went, not before', () => {
    expect(cellText(`a${' '.repeat(tableLimits.cellLength * 2)}b`)).toBe('a b')
  })
})

describe('what two names are compared by', () => {
  it('is their letters and digits in lower case', () => {
    expect(tableNameKey('Raum-Nr.')).toBe('raumnr')
    expect(tableNameKey('Raum-Nr.')).toBe(tableNameKey('raum nr'))
    expect(tableNameKey('  RAUM_NR  ')).toBe(tableNameKey('Raum-Nr.'))
    expect(tableNameKey('Etage 2')).toBe('etage2')
  })

  it('keeps an umlaut an umlaut: nothing is written another way', () => {
    expect(tableNameKey('Größe')).toBe('größe')
    expect(tableNameKey('Größe')).not.toBe(tableNameKey('Grosse'))
    expect(tableNameKey('Größe')).not.toBe(tableNameKey('Groesse'))
    expect(tableNameKey('Fläche (m²)')).toBe(tableNameKey('fläche m²'))
  })

  it('is empty for a name without a letter or a digit', () => {
    expect(tableNameKey(' - / . ')).toBe('')
    expect(tableNameKey('')).toBe('')
  })
})

describe('the letters of a column', () => {
  it('go from A to Z and on with two and three letters', () => {
    expect(columnLetters(0)).toBe('A')
    expect(columnLetters(1)).toBe('B')
    expect(columnLetters(25)).toBe('Z')
    expect(columnLetters(26)).toBe('AA')
    expect(columnLetters(27)).toBe('AB')
    expect(columnLetters(51)).toBe('AZ')
    expect(columnLetters(52)).toBe('BA')
    expect(columnLetters(701)).toBe('ZZ')
    expect(columnLetters(702)).toBe('AAA')
  })
})

describe('where a sheet begins', () => {
  it('is the first row that holds anything', () => {
    expect(headerIndex(sheetOf([['Raum', 'Etage'], ['101']]))).toBe(0)
    expect(headerIndex(rooms)).toBe(1)
    expect(headerIndex(sheetOf([[], ['', ''], ['', 'Raum']]))).toBe(2)
  })

  it('is nowhere in a sheet that holds nothing', () => {
    expect(headerIndex(sheetOf([]))).toBe(-1)
    expect(headerIndex(sheetOf([[], ['', '']]))).toBe(-1)
  })

  it('has as many lines as rows below the names hold anything', () => {
    expect(tableLineCount(sheetOf([['Raum'], ['101'], [''], [], ['', '102']]))).toBe(2)
    // The title is the header here, and the names below it count as a line.
    expect(tableLineCount(rooms)).toBe(3)
    expect(tableLineCount(sheetOf([['Raum']]))).toBe(0)
    expect(tableLineCount(sheetOf([]))).toBe(0)
    expect(tableLineCount(sheetOf([[], ['']]))).toBe(0)
  })
})

describe('the columns of a sheet', () => {
  it('are the ones with a name or a value, each with the first thing that stands in it', () => {
    const sheet = sheetOf([
      [],
      ['Raum', 'Etage', '', 'Leer', ''],
      ['', '', '', '', ''],
      ['101', '', 'ohne Namen', '', ''],
      ['102', '2', 'noch eins', '', ''],
    ])

    expect(tableColumns(sheet)).toEqual([
      { index: 0, name: 'Raum', sample: '101' },
      // The sample is the first cell below the names that holds anything, not the first cell.
      { index: 1, name: 'Etage', sample: '2' },
      // Values under no name are still a column somebody can choose.
      { index: 2, name: '', sample: 'ohne Namen' },
      // A name over nothing is one as well.
      { index: 3, name: 'Leer', sample: '' },
      // The fifth has neither and is left out.
    ])
  })

  it('reach as far as the longest row, not as far as the names', () => {
    expect(tableColumns(sheetOf([['Raum'], ['101', '', 'weit rechts']]))).toEqual([
      { index: 0, name: 'Raum', sample: '101' },
      { index: 2, name: '', sample: 'weit rechts' },
    ])
  })

  it('never take the sample from the row of the names or from above it', () => {
    expect(tableColumns(sheetOf([[], ['Raum', 'Etage']]))).toEqual([
      { index: 0, name: 'Raum', sample: '' },
      { index: 1, name: 'Etage', sample: '' },
    ])
  })

  it('are none in a sheet that holds nothing', () => {
    expect(tableColumns(sheetOf([]))).toEqual([])
    expect(tableColumns(sheetOf([[''], []]))).toEqual([])
  })

  it('are called by their name, or by their letters where they have none', () => {
    expect(columnName({ index: 0, name: 'Raum' })).toBe('Raum')
    expect(columnName({ index: 2, name: '' })).toBe('Spalte C')
    expect(columnName({ index: 27, name: '' })).toBe('Spalte AB')
  })
})

const fields: readonly TableField[] = [
  { key: 'number', label: 'Raumnummer', names: ['Raum-Nr.', 'Raum'], required: true },
  { key: 'title', label: 'Bezeichnung', required: true },
  { key: 'area', label: 'Fläche', names: ['Größe', 'qm'] },
  { key: 'level', label: 'Etage' },
]

const columnsOf = (...names: string[]) =>
  names.map((name, index) => ({ index, name, sample: name === '' ? 'x' : '' }))

describe('the choice a page starts with', () => {
  it('gives a field the column that is called what the field is called', () => {
    expect(suggestedMapping(columnsOf('Etage', 'Bezeichnung'), fields)).toEqual({
      level: 0,
      title: 1,
    })
  })

  it('knows a column by the other names a field goes by as well', () => {
    expect(suggestedMapping(columnsOf('Größe', 'Raum-Nr.'), fields)).toEqual({ area: 0, number: 1 })
  })

  it('compares the names as somebody reads them, whatever stands between the letters', () => {
    expect(suggestedMapping(columnsOf('RAUM NR', ' bezeichnung: ', 'Q.M.'), fields)).toEqual({
      number: 0,
      title: 1,
      area: 2,
    })
  })

  it('never guesses by likeness', () => {
    expect(
      suggestedMapping(
        columnsOf('Raumnummern', 'Bezeichnungen', 'Flaeche', 'Grosse', 'Etagen', 'Nummer'),
        fields,
      ),
    ).toEqual({})
  })

  it('gives every column once, to the first field that is called so', () => {
    const twice: readonly TableField[] = [
      { key: 'number', label: 'Nummer', names: ['Nr.'] },
      { key: 'room', label: 'Raum', names: ['Nr'] },
    ]

    expect(suggestedMapping(columnsOf('Nr.'), twice)).toEqual({ number: 0 })
    // And the second field takes the next column that is called so.
    expect(suggestedMapping(columnsOf('Nr.', 'NR'), twice)).toEqual({ number: 0, room: 1 })
  })

  it('takes the first of two columns with one name', () => {
    expect(suggestedMapping(columnsOf('Notiz', 'Etage', 'Etage'), fields)).toEqual({ level: 1 })
  })

  it('never suggests a column without a name', () => {
    const unnamed: readonly TableField[] = [{ key: 'mark', label: '-', names: [''] }]

    expect(suggestedMapping(columnsOf('', 'Etage'), unnamed)).toEqual({})
  })

  it('keeps the place of a column in the sheet, not its place among the columns', () => {
    expect(suggestedMapping([{ index: 7, name: 'Etage', sample: '' }], fields)).toEqual({
      level: 7,
    })
  })
})

describe('a choice of columns', () => {
  it('lacks every field that needs a column and has none', () => {
    expect(fieldsWithoutColumn({}, fields).map((field) => field.key)).toEqual(['number', 'title'])
    expect(fieldsWithoutColumn({ number: 0, level: 1 }, fields).map((field) => field.key)).toEqual([
      'title',
    ])
    expect(fieldsWithoutColumn({ number: 0, title: 3 }, fields)).toEqual([])
  })

  it('says which field a column is given', () => {
    expect(fieldOfColumn({ number: 0, title: 3 }, 3)).toBe('title')
    expect(fieldOfColumn({ number: 0, title: 3 }, 0)).toBe('number')
    expect(fieldOfColumn({ number: 0, title: 3 }, 1)).toBeNull()
    expect(fieldOfColumn({}, 0)).toBeNull()
  })

  it('gives a free column a field', () => {
    expect(withColumn({ number: 0 }, 2, 'title')).toEqual({ number: 0, title: 2 })
  })

  it('moves a field: it leaves the column it had', () => {
    const moved = withColumn({ number: 0, title: 1 }, 2, 'number')

    expect(moved).toEqual({ number: 2, title: 1 })
    expect(fieldOfColumn(moved, 0)).toBeNull()
  })

  it('takes the field a column had away from it', () => {
    expect(withColumn({ number: 0, title: 1 }, 1, 'area')).toEqual({ number: 0, area: 1 })
    // Both at once: the field comes from another column to one that was taken.
    expect(withColumn({ number: 0, title: 1 }, 1, 'number')).toEqual({ number: 1 })
  })

  it('takes a column out with null', () => {
    expect(withColumn({ number: 0, title: 1 }, 0, null)).toEqual({ title: 1 })
    expect(withColumn({ number: 0, title: 1 }, 5, null)).toEqual({ number: 0, title: 1 })
  })

  it('leaves the choice it was handed as it was', () => {
    const before = { number: 0, title: 1 }

    withColumn(before, 1, 'number')

    expect(before).toEqual({ number: 0, title: 1 })
  })
})

describe('a sheet that came over the wire', () => {
  const shape = 'Die Tabelle steht als Blatt mit einem Namen und Zeilen aus Zellen.'

  it('is one with a name and rows of cells', () => {
    expect(tableSheetProblem({ name: 'Räume', rows: [['Raum'], [], ['101', '']] })).toBeNull()
    expect(tableSheetProblem({ name: '', rows: [] })).toBeNull()
  })

  it('is none in any other shape', () => {
    expect(tableSheetProblem(null)).toBe(shape)
    expect(tableSheetProblem(undefined)).toBe(shape)
    expect(tableSheetProblem('Raum;Etage')).toBe(shape)
    expect(tableSheetProblem([['Raum']])).toBe(shape)
    expect(tableSheetProblem({ rows: [['Raum']] })).toBe(shape)
    expect(tableSheetProblem({ name: 7, rows: [['Raum']] })).toBe(shape)
    expect(tableSheetProblem({ name: 'Räume' })).toBe(shape)
    expect(tableSheetProblem({ name: 'Räume', rows: 'Raum' })).toBe(shape)
    expect(tableSheetProblem({ name: 'Räume', rows: ['Raum'] })).toBe(shape)
    expect(tableSheetProblem({ name: 'Räume', rows: [['Raum', 101]] })).toBe(shape)
    expect(tableSheetProblem({ name: 'Räume', rows: [['Raum', null]] })).toBe(shape)
    expect(tableSheetProblem({ name: 'Räume', rows: [['Raum'], { 0: '101' }] })).toBe(shape)
  })

  it('has no more rows than are read', () => {
    const row = ['101']

    expect(
      tableSheetProblem({ name: '', rows: new Array<string[]>(tableLimits.rows).fill(row) }),
    ).toBeNull()
    expect(
      tableSheetProblem({ name: '', rows: new Array<string[]>(tableLimits.rows + 1).fill(row) }),
    ).toBe(tooManyRows)
    // Rows that hold nothing are rows of the sheet that was sent all the same.
    expect(
      tableSheetProblem({ name: '', rows: new Array<string[]>(tableLimits.rows + 1).fill([]) }),
    ).toBe(tooManyRows)
  })

  it('has no more columns than are read', () => {
    expect(
      tableSheetProblem({ name: '', rows: [new Array<string>(tableLimits.columns).fill('x')] }),
    ).toBeNull()
    expect(
      tableSheetProblem({
        name: '',
        rows: [['Raum'], new Array<string>(tableLimits.columns + 1).fill('')],
      }),
    ).toBe(tooManyColumns)
  })

  it('has no cell longer than a cell that was cut', () => {
    const cut = cellText('x'.repeat(tableLimits.cellLength + 500))

    expect(tableSheetProblem({ name: '', rows: [[cut]] })).toBeNull()
    expect(tableSheetProblem({ name: '', rows: [[`${cut}x`]] })).toBe(
      'Eine Zelle hat mehr als 2.000 Zeichen.',
    )
  })

  it('holds no more cells than are read at once', () => {
    const row = new Array<string>(tableLimits.columns).fill('x')
    const full = tableLimits.cells / tableLimits.columns

    expect(tableSheetProblem({ name: '', rows: new Array<string[]>(full).fill(row) })).toBeNull()
    expect(tableSheetProblem({ name: '', rows: new Array<string[]>(full + 1).fill(row) })).toBe(
      tooMuch,
    )
  })

  it('counts only the cells that hold anything', () => {
    const row = new Array<string>(tableLimits.columns).fill('')

    expect(
      tableSheetProblem({ name: '', rows: new Array<string[]>(tableLimits.rows).fill(row) }),
    ).toBeNull()
  })

  it('holds no more characters than are read at once', () => {
    const cell = 'x'.repeat(tableLimits.cellLength)
    const row = new Array<string>(tableLimits.columns).fill(cell)
    const full = tableLimits.characters / (tableLimits.cellLength * tableLimits.columns)

    expect(tableSheetProblem({ name: '', rows: new Array<string[]>(full).fill(row) })).toBeNull()
    expect(
      tableSheetProblem({ name: '', rows: [...new Array<string[]>(full).fill(row), ['x']] }),
    ).toBe(tooMuch)
  })

  it('says each limit in words, with its figure', () => {
    expect(tooManyRows).toBe(
      'Die Tabelle hat mehr als 10.000 Zeilen. Teilen Sie sie in mehrere Dateien.',
    )
    expect(tooManyColumns).toBe(
      'Die Tabelle hat mehr als 100 Spalten. Lassen Sie weg, was nicht übernommen wird.',
    )
    expect(tooMuch).toBe(
      'Die Tabelle hält mehr, als auf einmal gelesen wird. Teilen Sie sie in mehrere Dateien.',
    )
  })
})

describe('a choice that came over the wire', () => {
  const sheet = sheetOf([
    ['Raum-Nr.', 'Bezeichnung', '', 'Fläche', ''],
    ['101', 'Büro', 'x', '12,5', ''],
  ])

  it('can be worked with when every field that needs a column has one of the sheet', () => {
    expect(columnMappingProblem({ number: 0, title: 1 }, fields, sheet)).toBeNull()
    expect(
      columnMappingProblem({ number: 0, title: 1, area: 3, level: 2 }, fields, sheet),
    ).toBeNull()
  })

  it('has to be a choice at all', () => {
    const shape = 'Die Zuordnung der Spalten steht als Feld mit seiner Spalte.'

    expect(columnMappingProblem(null, fields, sheet)).toBe(shape)
    expect(columnMappingProblem(undefined, fields, sheet)).toBe(shape)
    expect(columnMappingProblem('number=0', fields, sheet)).toBe(shape)
    expect(columnMappingProblem(0, fields, sheet)).toBe(shape)
    expect(columnMappingProblem([0, 1], fields, sheet)).toBe(shape)
  })

  it('names only fields of this table', () => {
    expect(columnMappingProblem({ number: 0, title: 1, owner: 3 }, fields, sheet)).toBe(
      'Das Feld owner gibt es in dieser Tabelle nicht.',
    )
  })

  it('names only columns of this sheet', () => {
    const missing = 'Die Spalte für „Fläche“ gibt es in der Datei nicht.'

    // Beyond the sheet, and a column of the sheet that holds nothing anywhere.
    expect(columnMappingProblem({ number: 0, title: 1, area: 9 }, fields, sheet)).toBe(missing)
    expect(columnMappingProblem({ number: 0, title: 1, area: 4 }, fields, sheet)).toBe(missing)
    expect(columnMappingProblem({ number: 0, title: 1, area: -1 }, fields, sheet)).toBe(missing)
    expect(columnMappingProblem({ number: 0, title: 1, area: 0.5 }, fields, sheet)).toBe(missing)
    // And nothing that is not a number, even where it reads like one.
    expect(columnMappingProblem({ number: 0, title: 1, area: '3' }, fields, sheet)).toBe(missing)
    expect(columnMappingProblem({ number: 0, title: 1, area: null }, fields, sheet)).toBe(missing)
    expect(columnMappingProblem({ number: 0, title: 1, area: [3] }, fields, sheet)).toBe(missing)
  })

  it('gives a column to one field only', () => {
    expect(columnMappingProblem({ number: 0, title: 1, area: 1 }, fields, sheet)).toBe(
      'Die Spalte B ist zwei Feldern zugeordnet.',
    )
  })

  it('has a column for every field that needs one', () => {
    expect(columnMappingProblem({ number: 0, area: 3 }, fields, sheet)).toBe(
      'Für „Bezeichnung“ ist keine Spalte gewählt.',
    )
    // The first that is missing, in the order of the fields.
    expect(columnMappingProblem({}, fields, sheet)).toBe(
      'Für „Raumnummer“ ist keine Spalte gewählt.',
    )
  })

  it('needs nothing where no field does', () => {
    expect(columnMappingProblem({}, [{ key: 'level', label: 'Etage' }], sheet)).toBeNull()
  })
})

describe('the rows of a sheet as records', () => {
  it('are the rows below the names, each with what stands in the columns of its fields', () => {
    const sheet = sheetOf([
      ['Raum-Nr.', 'Bezeichnung', 'Fläche'],
      ['101', 'Büro', '12,5'],
      ['102', 'Lager', '40'],
    ])

    expect(tableRecords(sheet, { number: 0, title: 1 })).toEqual([
      { line: 2, values: { number: '101', title: 'Büro' } },
      { line: 3, values: { number: '102', title: 'Lager' } },
    ])
  })

  it('keep the line of the file, counted from one, wherever the names stand', () => {
    expect(tableRecords(rooms, { number: 0, title: 1 })).toEqual([
      // The title is the first row that holds anything, so the names below it are a row.
      { line: 3, values: { number: 'Raum-Nr.', title: 'Bezeichnung' } },
      { line: 4, values: { number: '101', title: 'Büro' } },
      { line: 6, values: { number: '102', title: 'Lager' } },
    ])
  })

  it('leave out a row in which no chosen column holds anything, whatever the others hold', () => {
    const sheet = sheetOf([
      [],
      [],
      ['Raum', 'Etage', 'Summe'],
      ['101', '1', '12,5'],
      ['', '', ''],
      [],
      ['', '', '52,5'],
      ['102', '', ''],
    ])

    expect(tableRecords(sheet, { number: 0, level: 1 })).toEqual([
      { line: 4, values: { number: '101', level: '1' } },
      { line: 8, values: { number: '102', level: '' } },
    ])
    // The line of sums is a record to whoever takes the column it stands in.
    expect(tableRecords(sheet, { total: 2 }).map((record) => record.line)).toEqual([4, 7])
  })

  it('hold an empty text for a chosen cell that is empty or beyond the end of its row', () => {
    const sheet = sheetOf([['Raum', 'Etage', 'Notiz'], ['101'], ['', '2']])

    expect(tableRecords(sheet, { number: 0, level: 1, note: 2 })).toEqual([
      { line: 2, values: { number: '101', level: '', note: '' } },
      { line: 3, values: { number: '', level: '2', note: '' } },
    ])
  })

  it('are none without a choice, and none in a sheet that holds nothing', () => {
    expect(tableRecords(sheetOf([['Raum'], ['101']]), {})).toEqual([])
    expect(tableRecords(sheetOf([]), { number: 0 })).toEqual([])
    expect(tableRecords(sheetOf([[], ['']]), { number: 0 })).toEqual([])
    expect(tableRecords(sheetOf([['Raum']]), { number: 0 })).toEqual([])
  })
})

describe('lines as somebody would name them', () => {
  it('are one number, or two with a comma', () => {
    expect(lineWords([301])).toBe('301')
    expect(lineWords([88, 89])).toBe('88, 89')
    expect(lineWords([88, 90])).toBe('88, 90')
    expect(lineWords([])).toBe('')
  })

  it('are a range from three in a row on', () => {
    expect(lineWords([13, 14, 15])).toBe('13 bis 15')
    expect(lineWords([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26])).toBe('13 bis 26')
  })

  it('are ranges and single lines side by side', () => {
    expect(lineWords([2, 3, 7, 8, 9, 12, 20, 21, 22, 23, 30, 31])).toBe(
      '2, 3, 7 bis 9, 12, 20 bis 23, 30, 31',
    )
  })

  it('are put in order first, by their value and not by their digits', () => {
    expect(lineWords([10, 9, 100, 8, 2])).toBe('2, 8 bis 10, 100')
  })

  it('are named once however often they come', () => {
    expect(lineWords([5, 5, 6, 6])).toBe('5, 6')
    expect(lineWords([7, 5, 6, 5, 7])).toBe('5 bis 7')
  })
})

describe('the day a cell names', () => {
  it('is read as a list writes it and as a program does', () => {
    expect(dayOfCell('02.10.2026')).toBe('2026-10-02')
    expect(dayOfCell('2.10.2026')).toBe('2026-10-02')
    expect(dayOfCell('2.1.2026')).toBe('2026-01-02')
    expect(dayOfCell('2026-10-02')).toBe('2026-10-02')
    expect(dayOfCell('31.12.1999')).toBe('1999-12-31')
    expect(dayOfCell('01.01.0900')).toBe('0900-01-01')
  })

  it('is a 29 February only in a leap year', () => {
    expect(dayOfCell('29.02.2024')).toBe('2024-02-29')
    expect(dayOfCell('2024-02-29')).toBe('2024-02-29')
    expect(dayOfCell('29.02.2000')).toBe('2000-02-29')
    expect(dayOfCell('29.02.2023')).toBeNull()
    expect(dayOfCell('2023-02-29')).toBeNull()
    expect(dayOfCell('29.02.1900')).toBeNull()
    expect(dayOfCell('30.02.2024')).toBeNull()
    expect(dayOfCell('31.02.2024')).toBeNull()
  })

  it('is none where the calendar has no such day', () => {
    expect(dayOfCell('31.04.2026')).toBeNull()
    expect(dayOfCell('31.06.2026')).toBeNull()
    expect(dayOfCell('32.01.2026')).toBeNull()
    expect(dayOfCell('00.10.2026')).toBeNull()
    expect(dayOfCell('02.13.2026')).toBeNull()
    expect(dayOfCell('02.00.2026')).toBeNull()
    expect(dayOfCell('2026-13-02')).toBeNull()
    expect(dayOfCell('2026-10-32')).toBeNull()
    expect(dayOfCell('02.10.0000')).toBeNull()
    // The last day of each month is one.
    expect(dayOfCell('30.04.2026')).toBe('2026-04-30')
    expect(dayOfCell('31.01.2026')).toBe('2026-01-31')
    expect(dayOfCell('28.02.2023')).toBe('2023-02-28')
  })

  it('is none with a year of two digits: which century it means is a guess', () => {
    expect(dayOfCell('02.10.26')).toBeNull()
    expect(dayOfCell('26-10-02')).toBeNull()
  })

  it('is none with anything around it', () => {
    expect(dayOfCell('02.10.2026 14:30')).toBeNull()
    expect(dayOfCell('2026-10-02T14:30')).toBeNull()
    expect(dayOfCell(' 02.10.2026')).toBeNull()
    expect(dayOfCell('02.10.2026\n')).toBeNull()
    expect(dayOfCell('am 02.10.2026')).toBeNull()
    expect(dayOfCell('02.10.20261')).toBeNull()
  })

  it('is none in any other writing, and none in an empty cell', () => {
    expect(dayOfCell('')).toBeNull()
    expect(dayOfCell('02/10/2026')).toBeNull()
    expect(dayOfCell('2026-10-2')).toBeNull()
    expect(dayOfCell('2026.10.02')).toBeNull()
    expect(dayOfCell('46297')).toBeNull()
    expect(dayOfCell('Oktober 2026')).toBeNull()
  })
})

describe('the whole number a cell holds', () => {
  it('is its digits and nothing else', () => {
    expect(wholeNumberOfCell('2026')).toBe(2026)
    expect(wholeNumberOfCell('0')).toBe(0)
    expect(wholeNumberOfCell('-3')).toBe(-3)
    expect(wholeNumberOfCell('007')).toBe(7)
    expect(wholeNumberOfCell('999999999999999')).toBe(999_999_999_999_999)
  })

  it('is none for anything that is not one', () => {
    expect(wholeNumberOfCell('')).toBeNull()
    expect(wholeNumberOfCell('-')).toBeNull()
    expect(wholeNumberOfCell('12,5')).toBeNull()
    expect(wholeNumberOfCell('12.5')).toBeNull()
    expect(wholeNumberOfCell('1.000')).toBeNull()
    expect(wholeNumberOfCell('+3')).toBeNull()
    expect(wholeNumberOfCell('1e3')).toBeNull()
    expect(wholeNumberOfCell('0x10')).toBeNull()
    expect(wholeNumberOfCell(' 12')).toBeNull()
    expect(wholeNumberOfCell('12 ')).toBeNull()
    expect(wholeNumberOfCell('12\n')).toBeNull()
    expect(wholeNumberOfCell('2. OG')).toBeNull()
    // Sixteen digits are more than a number holds exactly.
    expect(wholeNumberOfCell('1000000000000000')).toBeNull()
  })
})

describe('what no name holds on purpose', () => {
  it('is a space in a cell: a control character between two words', () => {
    const bell = String.fromCharCode(7)
    const unit = String.fromCharCode(31)

    expect(cellText(`Heizraum${bell}Nord`)).toBe('Heizraum Nord')
    expect(cellText(`${unit}E.14${unit}${unit}`)).toBe('E.14')
  })

  it('is called like nothing: a column of nothing but punctuation is given to no field', () => {
    const columns = [
      { index: 0, name: '#', sample: '1' },
      { index: 1, name: 'Anteil', sample: '19 %' },
    ]

    expect(suggestedMapping(columns, [{ key: 'share', label: '%', names: ['Anteil'] }])).toEqual({
      share: 1,
    })
    expect(suggestedMapping(columns, [{ key: 'count', label: '%' }])).toEqual({})
  })
})
