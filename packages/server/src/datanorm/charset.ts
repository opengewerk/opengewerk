/**
 * The characters of a DATANORM file (#297). DATANORM predates UTF-8: a file
 * from an older system comes in a DOS code page, CP850 or CP437, a newer one
 * in Windows-1252 or UTF-8, and the file says nothing about which. The German
 * letters sit at different bytes in each, so the bytes themselves decide:
 * a file that is valid UTF-8 with more than ASCII in it is UTF-8, and
 * otherwise the code page whose umlauts turn up more often wins.
 *
 * CP437 and CP850 agree on every letter German needs, ä ö ü Ä Ö Ü ß and é, so
 * one table serves both. The tables hold code points rather than characters:
 * a few of them are dashes and typographic quotes, which the source of this
 * project does not carry as characters.
 */

export type DatanormCharset = 'utf-8' | 'cp850' | 'windows-1252'

/** The upper half of CP850, byte 0x80 onwards, as code points. */
const cp850 = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, 0x00ea, 0x00eb, 0x00e8, 0x00ef,
  0x00ee, 0x00ec, 0x00c4, 0x00c5, 0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
  0x00ff, 0x00d6, 0x00dc, 0x00f8, 0x00a3, 0x00d8, 0x00d7, 0x0192, 0x00e1, 0x00ed, 0x00f3, 0x00fa,
  0x00f1, 0x00d1, 0x00aa, 0x00ba, 0x00bf, 0x00ae, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x00c1, 0x00c2, 0x00c0, 0x00a9, 0x2563, 0x2551, 0x2557,
  0x255d, 0x00a2, 0x00a5, 0x2510, 0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x00e3, 0x00c3,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x00a4, 0x00f0, 0x00d0, 0x00ca, 0x00cb,
  0x00c8, 0x0131, 0x00cd, 0x00ce, 0x00cf, 0x2518, 0x250c, 0x2588, 0x2584, 0x00a6, 0x00cc, 0x2580,
  0x00d3, 0x00df, 0x00d4, 0x00d2, 0x00f5, 0x00d5, 0x00b5, 0x00fe, 0x00de, 0x00da, 0x00db, 0x00d9,
  0x00fd, 0x00dd, 0x00af, 0x00b4, 0x00ad, 0x00b1, 0x2017, 0x00be, 0x00b6, 0x00a7, 0x00f7, 0x00b8,
  0x00b0, 0x00a8, 0x00b7, 0x00b9, 0x00b3, 0x00b2, 0x25a0, 0x00a0,
]

/**
 * Bytes 0x80 to 0x9f of Windows-1252, as code points; the five it leaves
 * undefined become the replacement character. From 0xa0 on it is Latin-1,
 * where the byte is the code point.
 */
const windows1252Low = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
]

/** The bytes of ä ö ü Ä Ö Ü ß in CP850, and in Windows-1252. */
const umlautsCp850 = new Set([0x84, 0x94, 0x81, 0x8e, 0x99, 0x9a, 0xe1])
const umlauts1252 = new Set([0xe4, 0xf6, 0xfc, 0xc4, 0xd6, 0xdc, 0xdf])

/**
 * Whether the bytes are UTF-8 with at least one character beyond ASCII. Plain
 * ASCII reads the same in every one of the three, and a byte of a code page
 * almost never forms a valid sequence, least of all a whole file of them.
 */
function isUtf8(bytes: Uint8Array): boolean {
  let beyondAscii = false
  let index = 0

  while (index < bytes.length) {
    const first = bytes[index] ?? 0

    if (first < 0x80) {
      index += 1
      continue
    }

    const length = first >= 0xf0 && first <= 0xf4 ? 4 : first >= 0xe0 ? 3 : first >= 0xc2 ? 2 : 0

    if (length === 0 || first > 0xf4 || index + length > bytes.length) {
      return false
    }

    for (let next = 1; next < length; next += 1) {
      if (((bytes[index + next] ?? 0) & 0xc0) !== 0x80) {
        return false
      }
    }

    beyondAscii = true
    index += length
  }

  return beyondAscii
}

/** Which of the three the bytes are written in. */
export function charsetOf(bytes: Uint8Array): DatanormCharset {
  if (isUtf8(bytes)) {
    return 'utf-8'
  }

  let dos = 0
  let windows = 0

  for (const byte of bytes) {
    if (umlautsCp850.has(byte)) {
      dos += 1
    } else if (umlauts1252.has(byte)) {
      windows += 1
    }
  }

  // Even, and mostly because there is nothing beyond ASCII: DOS, where
  // DATANORM comes from.
  return windows > dos ? 'windows-1252' : 'cp850'
}

/** The text of the bytes in the given charset, or in the one they are found to be in. */
export function decodeDatanorm(
  bytes: Uint8Array,
  charset: DatanormCharset = charsetOf(bytes),
): string {
  if (charset === 'utf-8') {
    return new TextDecoder('utf-8').decode(bytes)
  }

  const high = charset === 'cp850' ? cp850 : null
  let text = ''
  // In pieces, since String.fromCharCode takes its arguments on the stack.
  const piece: number[] = []

  for (const byte of bytes) {
    piece.push(
      byte < 0x80
        ? byte
        : high
          ? (high[byte - 0x80] ?? 0xfffd)
          : byte < 0xa0
            ? (windows1252Low[byte - 0x80] ?? 0xfffd)
            : byte,
    )

    if (piece.length === 8192) {
      text += String.fromCharCode(...piece)
      piece.length = 0
    }
  }

  return text + String.fromCharCode(...piece)
}
