import { describe, expect, it } from 'vitest'

import { readXml, xmlText } from './xml.js'

type Event =
  | readonly ['open' | 'empty', string, Readonly<Record<string, string>>]
  | readonly ['close', string]
  | readonly ['text', string]

/** What a reader is told about a text, one after the other. */
function eventsOf(xml: string): Event[] {
  const events: Event[] = []

  readXml(xml, {
    open(name, attributes, closed) {
      events.push([closed ? 'empty' : 'open', name, attributes])
    },
    close(name) {
      events.push(['close', name])
    },
    text(text) {
      events.push(['text', text])
    },
  })

  return events
}

describe('the text of XML', () => {
  it('has the five entities XML knows resolved', () => {
    expect(xmlText('M&amp;S &lt;1&gt; &quot;Büro&quot; &apos;Lager&apos;')).toBe(
      'M&S <1> "Büro" \'Lager\'',
    )
  })

  it('has the numbered ones resolved, counted in tens or in sixteens', () => {
    expect(xmlText('R&#228;ume')).toBe('Räume')
    expect(xmlText('R&#xE4;ume &#xe4; &#x20AC;')).toBe('Räume ä €')
    expect(xmlText('&#10;')).toBe('\n')
    expect(xmlText('&#x1F600;')).toBe('\u{1F600}')
  })

  it('resolves each once: what an entity leaves behind is not read again', () => {
    expect(xmlText('&amp;lt;')).toBe('&lt;')
    expect(xmlText('&amp;#228;')).toBe('&#228;')
  })

  it('keeps any other as it is written, an entity of the document itself included', () => {
    expect(xmlText('&nbsp;')).toBe('&nbsp;')
    expect(xmlText('&lol;')).toBe('&lol;')
    expect(xmlText('&lol2;')).toBe('&lol2;')
    expect(xmlText('&AMP;')).toBe('&AMP;')
    expect(xmlText('&#0;')).toBe('&#0;')
    expect(xmlText('&#x110000;')).toBe('&#x110000;')
    expect(xmlText('Müller & Söhne')).toBe('Müller & Söhne')
    expect(xmlText('&amp')).toBe('&amp')
  })

  it('is the text itself where it holds no entity', () => {
    expect(xmlText('Raum 101')).toBe('Raum 101')
    expect(xmlText('')).toBe('')
  })
})

describe('the elements of XML', () => {
  it('are reported one after the other, with their attributes and the text between them', () => {
    expect(eventsOf('<row r="1" spans=\'1:2\'><c r="A1"><v>42</v></c><c r="B1"/></row>')).toEqual([
      ['open', 'row', { r: '1', spans: '1:2' }],
      ['open', 'c', { r: 'A1' }],
      ['open', 'v', {}],
      ['text', '42'],
      ['close', 'v'],
      ['close', 'c'],
      ['empty', 'c', { r: 'B1' }],
      ['close', 'row'],
    ])
  })

  it('say that they end at once, with or without a space before the slash, and no close follows', () => {
    expect(eventsOf('<a><b/><c /><d x="1" /></a>')).toEqual([
      ['open', 'a', {}],
      ['empty', 'b', {}],
      ['empty', 'c', {}],
      ['empty', 'd', { x: '1' }],
      ['close', 'a'],
    ])
  })

  it('come without their prefix, while an attribute keeps its own', () => {
    expect(
      eventsOf('<x:sheets xmlns:x="urn:main"><x:sheet name="Räume" r:id="rId1"/></x:sheets>'),
    ).toEqual([
      ['open', 'sheets', { 'xmlns:x': 'urn:main' }],
      ['empty', 'sheet', { name: 'Räume', 'r:id': 'rId1' }],
      ['close', 'sheets'],
    ])
  })

  it('have the entities of their attributes and of their text resolved', () => {
    expect(eventsOf('<sheet name="R&#228;ume &amp; Flure">M&amp;S &lt;1&gt;</sheet>')).toEqual([
      ['open', 'sheet', { name: 'Räume & Flure' }],
      ['text', 'M&S <1>'],
      ['close', 'sheet'],
    ])
  })

  it('may hold the end of a tag and a slash inside the value of an attribute', () => {
    expect(
      eventsOf('<f t="a>b" u=\'c>"d\'>x</f><numFmt formatCode="dd/mm/"><g/></numFmt>'),
    ).toEqual([
      ['open', 'f', { t: 'a>b', u: 'c>"d' }],
      ['text', 'x'],
      ['close', 'f'],
      ['open', 'numFmt', { formatCode: 'dd/mm/' }],
      ['empty', 'g', {}],
      ['close', 'numFmt'],
    ])
  })

  it('may spread their attributes over lines, with spaces around the equals sign', () => {
    expect(eventsOf('<c\n  r = "A1"\r\n\tt="s"\n/>')).toEqual([['empty', 'c', { r: 'A1', t: 's' }]])
  })

  it('report the whitespace between them as it stands', () => {
    expect(eventsOf('<a>\n  <b> x </b>\n</a>')).toEqual([
      ['open', 'a', {}],
      ['text', '\n  '],
      ['open', 'b', {}],
      ['text', ' x '],
      ['close', 'b'],
      ['text', '\n'],
      ['close', 'a'],
    ])
  })

  it('may have a space before the end of their closing tag', () => {
    expect(eventsOf('<a>x</a >')).toEqual([
      ['open', 'a', {}],
      ['text', 'x'],
      ['close', 'a'],
    ])
  })
})

describe('what a reader of XML passes over', () => {
  it('is the declaration, every instruction and every comment', () => {
    expect(
      eventsOf(
        '<?xml version="1.0" encoding="UTF-8"?><!-- <c>no cell</c> --><a><?mso-application progid="x"?><b/><!-- > --></a>',
      ),
    ).toEqual([
      ['open', 'a', {}],
      ['empty', 'b', {}],
      ['close', 'a'],
    ])
  })

  it('is a document type as a whole, with the entities it declares: none of them is ever unfolded', () => {
    const laughs =
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
      '<!ENTITY file SYSTEM "file:///etc/passwd">]><lolz a="&lol2;">&lol2;&file;</lolz>'

    expect(eventsOf(laughs)).toEqual([
      ['open', 'lolz', { a: '&lol2;' }],
      ['text', '&lol2;&file;'],
      ['close', 'lolz'],
    ])
  })

  it('is a document type without declarations of its own, whatever brackets follow later', () => {
    expect(eventsOf('<!DOCTYPE a SYSTEM "a.dtd"><a>[x]></a>')).toEqual([
      ['open', 'a', {}],
      ['text', '[x]>'],
      ['close', 'a'],
    ])
  })
})

describe('text that stands as it is written', () => {
  it('is reported without anything in it being read as an element or an entity', () => {
    expect(eventsOf('<t><![CDATA[a < b &amp; <c>]]></t>')).toEqual([
      ['open', 't', {}],
      ['text', 'a < b &amp; <c>'],
      ['close', 't'],
    ])
  })

  it('goes to the end where its end is missing', () => {
    expect(eventsOf('<t><![CDATA[offen')).toEqual([
      ['open', 't', {}],
      ['text', 'offen'],
    ])
  })
})

describe('a text that is no XML to its end', () => {
  it('ends the reading where a tag does not end', () => {
    expect(eventsOf('<a><b r="1')).toEqual([['open', 'a', {}]])
    expect(eventsOf('<a><b r="1>')).toEqual([['open', 'a', {}]])
  })

  it('ends the reading where a comment or an instruction does not end', () => {
    expect(eventsOf('<a><!-- offen <b/>')).toEqual([['open', 'a', {}]])
    expect(eventsOf('<a><?offen <b/>')).toEqual([['open', 'a', {}]])
  })

  it('reports nothing for a text without any element', () => {
    expect(eventsOf('Raum;Etage')).toEqual([])
    expect(eventsOf('')).toEqual([])
  })

  it('does not report what stands behind the last tag', () => {
    expect(eventsOf('<a/>Rest')).toEqual([['empty', 'a', {}]])
  })
})

describe('a reader of XML', () => {
  it('is told only what it asks for', () => {
    const names: string[] = []

    readXml('<a><b>x</b></a>', {
      open(name) {
        names.push(name)
      },
    })
    readXml('<a><b>x</b></a>', {})

    expect(names).toEqual(['a', 'b'])
  })
})
