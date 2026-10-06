/**
 * The elements of an XML text, one after the other, for the parts of a
 * workbook.
 *
 * Those parts are written by programs and hold elements, attributes and
 * text; that is what is read here, and nothing a document could use to grow:
 * no entity of its own is ever unfolded, so a file cannot make a megabyte
 * out of a line, and a document type is passed over as a whole. Comments,
 * instructions and the like are passed over too.
 *
 * Names come without their prefix. The parts are written with the namespace
 * of the spreadsheet as the default one by most programs and under a prefix
 * by a few, and `x:row` is a row either way.
 */
export interface XmlReader {
  /** An element begins. `closed` says it ends at once, as `<c/>` does, and no `close` follows. */
  open?(name: string, attributes: Readonly<Record<string, string>>, closed: boolean): void
  close?(name: string): void
  /** Text between elements, its entities resolved; whitespace between elements comes as it stands. */
  text?(text: string): void
}

const named: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Text with the five entities XML knows and the numbered ones resolved; any other stays as written. */
export function xmlText(raw: string): string {
  if (!raw.includes('&')) {
    return raw
  }

  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const point = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)

      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
    }

    return named[body] ?? whole
  })
}

const local = (name: string) => {
  const colon = name.indexOf(':')

  return colon < 0 ? name : name.slice(colon + 1)
}

const attribute = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Reads `xml` from its beginning to its end and reports what it holds. Text that is no XML ends the reading. */
export function readXml(xml: string, reader: XmlReader): void {
  let at = 0

  while (at < xml.length) {
    const tag = xml.indexOf('<', at)

    if (tag < 0) {
      break
    }

    if (tag > at) {
      reader.text?.(xmlText(xml.slice(at, tag)))
    }

    if (xml.startsWith('<!--', tag)) {
      at = endAfter(xml, '-->', tag + 4)
    } else if (xml.startsWith('<![CDATA[', tag)) {
      const end = xml.indexOf(']]>', tag + 9)

      reader.text?.(xml.slice(tag + 9, end < 0 ? xml.length : end))
      at = end < 0 ? xml.length : end + 3
    } else if (xml.startsWith('<?', tag)) {
      at = endAfter(xml, '?>', tag + 2)
    } else if (xml.startsWith('<!', tag)) {
      // A document type may hold declarations between brackets, with `>` inside them.
      const bracket = xml.indexOf('[', tag)
      const plain = xml.indexOf('>', tag)

      at =
        bracket >= 0 && bracket < plain ? endAfter(xml, ']>', bracket) : endAfter(xml, '>', tag + 2)
    } else {
      const end = tagEnd(xml, tag)

      if (end < 0) {
        break
      }

      if (xml[tag + 1] === '/') {
        reader.close?.(local(xml.slice(tag + 2, end).trim()))
      } else {
        const closed = xml[end - 1] === '/'
        const inner = xml.slice(tag + 1, closed ? end - 1 : end)
        const space = inner.search(/\s/)
        // Without a prototype: the names come out of a file, and none of them is to mean anything but itself.
        const attributes = Object.create(null) as Record<string, string>

        if (space >= 0) {
          attribute.lastIndex = 0

          for (let found = attribute.exec(inner); found !== null; found = attribute.exec(inner)) {
            attributes[found[1] ?? ''] = xmlText(found[2] ?? found[3] ?? '')
          }
        }

        reader.open?.(local(space < 0 ? inner : inner.slice(0, space)), attributes, closed)
      }

      at = end + 1
    }
  }
}

/**
 * Where the tag that begins at `from` ends, or -1. A `>` inside the value of
 * an attribute is allowed and is not the end: the one that is stands behind
 * quotes that have all been closed.
 */
function tagEnd(xml: string, from: number): number {
  let quote = ''

  for (let at = from + 1; at < xml.length; at += 1) {
    const character = xml[at]

    if (quote !== '') {
      quote = character === quote ? '' : quote
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return at
    }
  }

  return -1
}

function endAfter(xml: string, mark: string, from: number): number {
  const end = xml.indexOf(mark, from)

  return end < 0 ? xml.length : end + mark.length
}
