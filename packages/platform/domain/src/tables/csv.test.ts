import { describe, expect, it } from 'vitest'

import { csvRows } from './csv.js'

const lineFeed = String.fromCharCode(10)
/** The mark a file saved as Unicode begins with. */
const mark = String.fromCharCode(0xfeff)

describe('what separates the values of a file', () => {
  it('is the semicolon a German spreadsheet writes', () => {
    expect(csvRows('Raum;Etage\n101;1\n')).toEqual([
      ['Raum', 'Etage'],
      ['101', '1'],
    ])
  })

  it('is the comma an English one writes', () => {
    expect(csvRows('Raum,Etage\n101,1\n')).toEqual([
      ['Raum', 'Etage'],
      ['101', '1'],
    ])
  })

  it('is the tab of a program that exports a list', () => {
    expect(csvRows('Raum\tEtage\n101\t1\n')).toEqual([
      ['Raum', 'Etage'],
      ['101', '1'],
    ])
  })

  it('is the one that stands in every row equally often, whatever a remark is full of', () => {
    // A list divided by semicolons, with more commas than semicolons in it.
    const list = ['Raum;Ausstattung', '101;Tisch, Stuhl, Schrank', '102;Tisch, Stuhl, Regal', '']

    expect(csvRows(list.join(lineFeed))).toEqual([
      ['Raum', 'Ausstattung'],
      ['101', 'Tisch, Stuhl, Schrank'],
      ['102', 'Tisch, Stuhl, Regal'],
    ])
  })

  it('is the semicolon in a list of figures with decimal commas', () => {
    expect(csvRows('1,5;2,5;3,5')).toEqual([['1,5', '2,5', '3,5']])
  })

  it('is the tab and not the comma where only the tab stands in every row', () => {
    const tab = String.fromCharCode(9)
    const list = [`Name${tab}Wert`, `A${tab}1,5`, `B${tab}2,5`, '']

    expect(csvRows(list.join(lineFeed))).toEqual([
      ['Name', 'Wert'],
      ['A', '1,5'],
      ['B', '2,5'],
    ])
  })

  it('is the one of the three that is used most', () => {
    // Decimals with a comma in a list separated by semicolons, and the other way round.
    expect(csvRows('Raum;Fläche;Höhe\n101;12,5;2,75\n')).toEqual([
      ['Raum', 'Fläche', 'Höhe'],
      ['101', '12,5', '2,75'],
    ])
    expect(csvRows('Raum,Notiz,Etage\n101,Tür; Fenster,1\n')).toEqual([
      ['Raum', 'Notiz', 'Etage'],
      ['101', 'Tür; Fenster', '1'],
    ])
    expect(csvRows('Raum\tNotiz\tEtage\n101\tTür, Fenster; Licht\t1\n')).toEqual([
      ['Raum', 'Notiz', 'Etage'],
      ['101', 'Tür, Fenster; Licht', '1'],
    ])
  })

  it('is the semicolon where two are used as often', () => {
    expect(csvRows('Raum;Etage,Fläche\n')).toEqual([['Raum', 'Etage,Fläche']])
    expect(csvRows('Raum\tEtage;Fläche\n')).toEqual([['Raum\tEtage', 'Fläche']])
    // And the tab before the comma: a figure carries a comma, and none a tab.
    expect(csvRows('Raum\tEtage,Fläche\n')).toEqual([['Raum', 'Etage,Fläche']])
  })

  it('is counted outside of quotes only', () => {
    expect(csvRows('"Tür, Fenster, Licht, Heizung";101;1\n')).toEqual([
      ['Tür, Fenster, Licht, Heizung', '101', '1'],
    ])
    expect(csvRows('"a;b;c;d",101,1\n')).toEqual([['a;b;c;d', '101', '1']])
  })

  it('is none in a file of one column', () => {
    expect(csvRows('Raum\n101\n102\n')).toEqual([['Raum'], ['101'], ['102']])
  })
})

describe('a value in quotes', () => {
  it('holds a separator', () => {
    expect(csvRows('Raum;"Tür; Fenster";1\n')).toEqual([['Raum', 'Tür; Fenster', '1']])
  })

  it('holds a line break, of whichever kind', () => {
    expect(csvRows('101;"Zeile 1\nZeile 2";1\n102;"Zeile 1\r\nZeile 2";2\n')).toEqual([
      ['101', 'Zeile 1\nZeile 2', '1'],
      ['102', 'Zeile 1\r\nZeile 2', '2'],
    ])
  })

  it('holds a quote that is written twice', () => {
    expect(csvRows('101;"Rohr 1/2"" verzinkt";1\n')).toEqual([['101', 'Rohr 1/2" verzinkt', '1']])
    expect(csvRows('"""Büro""";""""\n')).toEqual([['"Büro"', '"']])
  })

  it('can be empty', () => {
    expect(csvRows('101;"";1\n')).toEqual([['101', '', '1']])
    expect(csvRows('""\n')).toEqual([['']])
  })

  it('keeps the spaces it holds', () => {
    expect(csvRows('" Büro ";1\n')).toEqual([[' Büro ', '1']])
  })

  it('goes on with what stands behind its closing quote', () => {
    expect(csvRows('"Büro" 1;2\n')).toEqual([['Büro 1', '2']])
  })

  it('ends with the file where its closing quote is missing', () => {
    expect(csvRows('101;"Büro;1\n102;Lager')).toEqual([['101', 'Büro;1\n102;Lager']])
  })
})

describe('a quote in the middle of a value', () => {
  it('is a character like any other', () => {
    expect(csvRows('Rohr 1/2";DN 15\n')).toEqual([['Rohr 1/2"', 'DN 15']])
    expect(csvRows('Bildschirm 24" breit;2\n')).toEqual([['Bildschirm 24" breit', '2']])
    expect(csvRows('a"b"c;d\n')).toEqual([['a"b"c', 'd']])
  })

  it('does not hide the separators behind it from the count', () => {
    expect(csvRows('Rohr 1/2",DN 15,verzinkt\n')).toEqual([['Rohr 1/2"', 'DN 15', 'verzinkt']])
    expect(csvRows('Rohr 1/2"\tDN 15\tverzinkt\nBogen\tDN 20\tschwarz\n')).toEqual([
      ['Rohr 1/2"', 'DN 15', 'verzinkt'],
      ['Bogen', 'DN 20', 'schwarz'],
    ])
  })
})

describe('the lines of a file', () => {
  it('end with a line feed, a carriage return or both', () => {
    expect(csvRows('a;b\r\nc;d\re;f\ng;h\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ])
  })

  it('include a last one without a line break at its end', () => {
    expect(csvRows('a;b\nc;d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(csvRows('a;b\nc;')).toEqual([
      ['a', 'b'],
      ['c', ''],
    ])
    expect(csvRows('a;b\n""')).toEqual([['a', 'b'], ['']])
  })

  it('do not include one more after the last line break', () => {
    expect(csvRows('a;b\n')).toEqual([['a', 'b']])
    expect(csvRows('a;b\r\n')).toEqual([['a', 'b']])
  })

  it('keep an empty one in the middle as a row, so that every row keeps its line', () => {
    expect(csvRows('a;b\n\nc;d\n')).toEqual([['a', 'b'], [''], ['c', 'd']])
    expect(csvRows('a;b\r\n\r\n\r\nc;d\r\n')).toEqual([['a', 'b'], [''], [''], ['c', 'd']])
    expect(csvRows('\na;b\n')).toEqual([[''], ['a', 'b']])
  })

  it('are as long as each of them is', () => {
    expect(csvRows('a;b;c\nd\ne;;\n')).toEqual([['a', 'b', 'c'], ['d'], ['e', '', '']])
  })

  it('are none in an empty file', () => {
    expect(csvRows('')).toEqual([])
    expect(csvRows(`${mark}`)).toEqual([])
  })
})

describe('the mark a file saved as Unicode begins with', () => {
  it('is no part of the first value', () => {
    expect(csvRows(`${mark}Raum;Etage\n101;1\n`)).toEqual([
      ['Raum', 'Etage'],
      ['101', '1'],
    ])
  })

  it('does not keep the first value from being one in quotes', () => {
    expect(csvRows(`${mark}"Raum;Nr.";Etage\n`)).toEqual([['Raum;Nr.', 'Etage']])
  })

  it('is a character like any other anywhere else', () => {
    expect(csvRows(`Raum;${mark}Etage\n`)).toEqual([['Raum', `${mark}Etage`]])
  })
})

describe('how much of a file decides what separates its values', () => {
  it('is its beginning: what comes after the first lines is not counted', () => {
    const head = 'Raum;Etage\n'.repeat(20)
    const tail = 'a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z\n'.repeat(3)
    const rows = csvRows(head + tail)

    expect(rows).toHaveLength(23)
    expect(rows[0]).toEqual(['Raum', 'Etage'])
    expect(rows[22]).toEqual(['a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z'])
  })
})
