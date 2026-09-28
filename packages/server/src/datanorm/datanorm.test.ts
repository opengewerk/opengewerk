import { describe, expect, it } from 'vitest'

import { charsetOf, decodeDatanorm } from './charset.js'
import { centsOf, headerOf, recordOf } from './records.js'
import { readDelivery } from './read.js'
import { cp850, header, windows1252, zipOf } from './test-files.js'
import { unitOf } from './units.js'
import { unzip, ZipRefused } from './zip.js'

/**
 * Reading DATANORM 4 (#297): the characters, the records, the articles put
 * together from several files, and archives. The files are made up here; a
 * real one of the pilot business is checked by hand.
 */

describe('the characters of a DATANORM file', () => {
  it('finds CP850 by its umlauts and reads them as they are meant', () => {
    const bytes = cp850(['Schutzschalter für Geräte, Größe 2 × 4 mm²'])

    expect(charsetOf(bytes)).toBe('cp850')
    expect(decodeDatanorm(bytes).trimEnd()).toBe('Schutzschalter für Geräte, Größe 2 × 4 mm²')
  })

  it('finds Windows-1252 and UTF-8 the same way', () => {
    const windows = windows1252(['Kabelführung für Außenmontage'])
    const utf8 = new TextEncoder().encode('Kabelführung für Außenmontage\r\n')

    expect(charsetOf(windows)).toBe('windows-1252')
    expect(decodeDatanorm(windows).trimEnd()).toBe('Kabelführung für Außenmontage')
    expect(charsetOf(utf8)).toBe('utf-8')
    expect(decodeDatanorm(utf8).trimEnd()).toBe('Kabelführung für Außenmontage')
  })

  it('takes plain ASCII as it is, and DOS where nothing tells', () => {
    const ascii = new TextEncoder().encode('A;N;4711;00;Kabelbinder;;1;2;Stck;350;;;;')

    expect(charsetOf(ascii)).toBe('cp850')
    expect(decodeDatanorm(ascii)).toBe('A;N;4711;00;Kabelbinder;;1;2;Stck;350;;;;')
  })
})

describe('a record of DATANORM 4', () => {
  it('reads an article with its list price for 100 units', () => {
    expect(
      recordOf('A;N;5709912;00;Kabelbinder 200x4,8;schwarz UV;1;2;Stck;350;RG12;042;LT000001;', 7),
    ).toEqual({
      kind: 'article',
      line: 7,
      processing: 'new',
      number: '5709912',
      shortText1: 'Kabelbinder 200x4,8',
      shortText2: 'schwarz UV',
      price: { kind: 'list', cents: 350, priceBase: 100 },
      unit: 'Stck',
      discountGroup: 'RG12',
      mainGroup: '042',
      longTextKey: 'LT000001',
    })
  })

  it('reads a net price, each of the four price units, and fields padded with blanks', () => {
    const net = recordOf('A ; A ; 1042 ;00; Mantelleitung ;; 2 ; 3 ; m ; 54000 ;;;;', 1)

    expect(net).toMatchObject({
      processing: 'change',
      number: '1042',
      price: { kind: 'net', cents: 54000, priceBase: 1000 },
      unit: 'm',
    })

    for (const [code, base] of [
      ['0', 1],
      ['1', 10],
      ['2', 100],
      ['3', 1000],
      ['', 1],
    ] as const) {
      expect(recordOf(`A;N;1;00;Text;;1;${code};Stck;100;;;;`, 1)).toMatchObject({
        price: { priceBase: base },
      })
    }
  })

  it('reads the cents after a comma as well, and nothing else', () => {
    expect(centsOf('350')).toBe(350)
    expect(centsOf('3,5')).toBe(350)
    expect(centsOf('3.50')).toBe(350)
    expect(centsOf('')).toBeNull()
    expect(centsOf('3,505')).toBeNull()
    expect(centsOf('-3')).toBeNull()
  })

  it('names what is wrong with a line in words', () => {
    expect(recordOf('A;X;1;00;Text;;1;0;Stck;100;;;;', 3)).toEqual({
      line: 3,
      reason: 'Unbekanntes Verarbeitungskennzeichen "X".',
    })
    expect(recordOf('A;N;;00;Text;;1;0;Stck;100;;;;', 4)).toEqual({
      line: 4,
      reason: 'Ein Artikel ohne Artikelnummer.',
    })
    expect(recordOf('A;N;4711;00;Text;;1;9;Stck;100;;;;', 5)).toEqual({
      line: 5,
      reason: 'Der Preis von 4711 ist nicht zu lesen.',
    })
    expect(recordOf('A N 4711 Kabelbinder schwarz', 6)).toMatchObject({ line: 6 })
  })

  it('reads the EAN and the group of the second record', () => {
    expect(recordOf('B;N;5709912; ; ; ;;;;4006381333931; ;0420;0;0; ; ;', 2)).toEqual({
      kind: 'extra',
      line: 2,
      processing: 'new',
      number: '5709912',
      ean: '4006381333931',
      group: '0420',
    })
  })

  it('reads the lines of a text in both ways the descriptions write them', () => {
    expect(recordOf('D;N;5709912;1;F;;UV-beständig;2;F;;Beutel zu 100 Stück;', 3)).toMatchObject({
      kind: 'dimension',
      key: '5709912',
      lines: [
        { index: 1, text: 'UV-beständig' },
        { index: 2, text: 'Beutel zu 100 Stück' },
      ],
    })
    expect(recordOf('T;N;LT000001;;1;;Für Innen und Außen;2;;Halogenfrei;', 4)).toMatchObject({
      kind: 'long-text',
      key: 'LT000001',
      lines: [
        { index: 1, text: 'Für Innen und Außen' },
        { index: 2, text: 'Halogenfrei' },
      ],
    })
  })

  it('reads up to three new prices in one price record, leaving out the factory price', () => {
    expect(recordOf('P;A;4711;1;390;0;RG12;;;;;4712;2;1250;;;;;;;4713;3;999;;;;;;;', 9)).toEqual({
      kind: 'prices',
      line: 9,
      changes: [
        { number: '4711', kind: 'list', cents: 390 },
        { number: '4712', kind: 'net', cents: 1250 },
      ],
    })
  })

  it('reads main groups and groups, and counts kinds it does not take over', () => {
    expect(recordOf('S;;042;Installationsmaterial;;;', 2)).toEqual({
      kind: 'group',
      line: 2,
      mainGroup: '042',
      group: '',
      name: 'Installationsmaterial',
    })
    expect(recordOf('S;;042;;0420;Kabelbinder;', 3)).toEqual({
      kind: 'group',
      line: 3,
      mainGroup: '042',
      group: '0420',
      name: 'Kabelbinder',
    })
    expect(recordOf('Z;N;4711;1;2;3;', 4)).toEqual({ kind: 'ignored', line: 4, letter: 'Z' })
  })

  it('reads the header in its fixed columns', () => {
    expect(headerOf(header('150926'), 1)).toEqual({
      line: 1,
      date: '2026-09-15',
      info: 'Elektro-Großhandel Hansa DATANORM Export Preise in EUR',
      version: '04',
      currency: 'EUR',
    })
    expect(headerOf(header('310226'), 1).date).toBeNull()
  })
})

describe('the unit of an article', () => {
  it('knows the ways suppliers write the common ones, and says when it does not', () => {
    expect(unitOf('Stck')).toEqual({ unit: 'piece', known: true })
    expect(unitOf('St.')).toEqual({ unit: 'piece', known: true })
    expect(unitOf('STÜCK')).toEqual({ unit: 'piece', known: true })
    expect(unitOf('m')).toEqual({ unit: 'metre', known: true })
    expect(unitOf('qm')).toEqual({ unit: 'square_metre', known: true })
    expect(unitOf('Rolle')).toEqual({ unit: 'package', known: true })
    expect(unitOf('Std')).toEqual({ unit: 'hour', known: true })
    expect(unitOf('Gebinde')).toEqual({ unit: 'piece', known: false })
  })
})

/** A delivery of the made-up wholesaler: articles, prices and groups. */
function delivery() {
  const articles = cp850([
    header('010926'),
    'T;N;LT000001;;1;;Für Innen und Außen;2;;Halogenfrei;',
    'A;N;5709912;00;Kabelbinder 200 × 4,8 mm;schwarz;1;2;Stck;350;RG12;042;LT000001;',
    'B;N;5709912; ; ; ;;;;4006381333931; ;0420;0;0; ; ;',
    'D;N;5709912;1;F;;UV-beständig;2;F;;Beutel zu 100 Stück;',
    'A;N;1042;00;Mantelleitung NYM-J 3 × 1,5 mm²;;2;3;m;54000;RG01;010;;',
    'B;N;1042; ; ; ;;;;4006381333932; ;;0;0; ; ;',
    'A;N;9001;00;Abzweigdose;;1;0;Gebinde;215;;042;;',
    'A;N;9002;00;Klemme;;1;0;Stck;x1;;042;;',
    'A;L;8888;00;Ausgelaufen;;1;0;Stck;100;;042;;',
    'Z;N;1042;1;2;3;',
  ])
  const prices = cp850([header('150926'), 'P;A;5709912;1;390;0;RG12;;;;;'])
  const groups = cp850([
    header('010926'),
    'S;;042;Installationsmaterial;;;',
    'S;;042;;0420;Kabelbinder und Befestigung;',
    'S;;010;Kabel und Leitungen;;;',
  ])

  return { articles, prices, groups }
}

describe('a delivery read into a catalogue', () => {
  it('puts each article together from its records and files, the umlauts intact', () => {
    const { articles, prices, groups } = delivery()
    const { catalogue, files, skipped } = readDelivery([
      { name: 'DATANORM.WRG', bytes: groups },
      { name: 'DATPREIS.001', bytes: prices },
      { name: 'DATANORM.001', bytes: articles },
    ])

    expect(files.map(({ name, charset }) => `${name} ${charset}`)).toEqual([
      'DATANORM.001 cp850',
      'DATPREIS.001 cp850',
      'DATANORM.WRG cp850',
    ])
    expect(skipped).toEqual([])
    expect(catalogue.header).toMatchObject({ date: '2026-09-01', version: '04' })
    expect(catalogue.articles.get('5709912')).toEqual({
      number: '5709912',
      file: 'DATANORM.001',
      line: 3,
      processing: 'new',
      designation: 'Kabelbinder 200 × 4,8 mm schwarz',
      description: 'Für Innen und Außen\nHalogenfrei\nUV-beständig\nBeutel zu 100 Stück',
      unit: 'piece',
      unknownUnit: null,
      price: { kind: 'list', cents: 350, priceBase: 100 },
      discountGroup: 'RG12',
      groupOfGoods: 'Kabelbinder und Befestigung',
      ean: '4006381333931',
    })
    expect(catalogue.articles.get('1042')).toMatchObject({
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
      unit: 'metre',
      price: { kind: 'net', cents: 54000, priceBase: 1000 },
      groupOfGoods: 'Kabel und Leitungen',
      ean: null,
    })
    expect(catalogue.articles.get('9001')).toMatchObject({ unit: 'piece', unknownUnit: 'Gebinde' })
    expect(catalogue.priceChanges.get('5709912')).toEqual({
      kind: 'list',
      cents: 390,
      file: 'DATPREIS.001',
      line: 2,
    })
    expect([...catalogue.deletions]).toEqual(['8888'])
    expect(catalogue.ignored).toEqual(new Map([['Z', 1]]))
    expect(catalogue.problems).toEqual([
      { file: 'DATANORM.001', line: 9, reason: 'Der Preis von 9002 ist nicht zu lesen.' },
      {
        file: 'DATANORM.001',
        line: 7,
        reason: 'Die EAN von 1042 stimmt nicht und wird nicht übernommen.',
      },
    ])
    expect(catalogue.articles.has('9002')).toBe(false)
  })

  it('reads the same files out of a ZIP archive and leaves out what is none', () => {
    const { articles, prices, groups } = delivery()
    const archive = zipOf([
      { name: 'hansa/DATANORM.001', bytes: articles },
      { name: 'hansa/DATPREIS.001', bytes: prices },
      { name: 'hansa/DATANORM.WRG', bytes: groups },
      { name: 'hansa/liesmich.txt', bytes: new TextEncoder().encode('Viel Erfolg!') },
    ])
    const { catalogue, skipped } = readDelivery([{ name: 'hansa.zip', bytes: archive }])

    expect(skipped).toEqual(['liesmich.txt'])
    expect(catalogue.articles.get('5709912')?.designation).toBe('Kabelbinder 200 × 4,8 mm schwarz')
    expect(catalogue.priceChanges.size).toBe(1)
  })

  it('reads no line of a file in another version of DATANORM', () => {
    const { catalogue } = readDelivery([
      {
        name: 'DATANORM.001',
        bytes: cp850([header('010926', '05'), 'A;N;4711;00;Text;;1;0;Stck;100;;;;']),
      },
    ])

    expect(catalogue.articles.size).toBe(0)
    expect(catalogue.problems).toEqual([
      {
        file: 'DATANORM.001',
        line: 1,
        reason: 'Die Datei ist DATANORM 5. Gelesen wird bisher DATANORM 4.',
      },
    ])
  })

  it('names each line of a file without separators, as DATANORM 3 writes it', () => {
    const { catalogue } = readDelivery([
      { name: 'DATANORM.001', bytes: cp850([header(), 'AN4711    00Kabelbinder']) },
    ])

    expect(catalogue.problems.map((problem) => problem.reason)).toEqual([
      'Kein Trennzeichen. So schreibt DATANORM 3 oder älter, gelesen wird DATANORM 4 mit Semikolon.',
    ])
  })
})

describe('an archive', () => {
  it('refuses what is damaged or unpacks to more than it may', () => {
    const archive = zipOf([{ name: 'DATANORM.001', bytes: cp850([header()]) }])
    const damaged = archive.slice()

    // A byte of the packed data changed: the checksum no longer fits.
    damaged[44] = (damaged[44] ?? 0) ^ 0xff

    expect(() => unzip(damaged)).toThrow(ZipRefused)
    expect(() => unzip(archive, 10)).toThrow('Das Archiv entpackt sich zu mehr als 400 MB.')
    expect(() => unzip(archive.subarray(0, 30))).toThrow(
      'Die Datei ist kein vollständiges ZIP-Archiv.',
    )
  })
})
