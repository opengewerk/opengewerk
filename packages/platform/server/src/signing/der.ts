/**
 * DER, as far as a certificate and a CMS signature need it: writing the few
 * types they are made of, and splitting an element into its children to find
 * a part of a certificate again. Nothing beyond `node:crypto` is used for
 * signing, so this is written out here.
 */

function lengthOf(size: number): Buffer {
  if (size < 0x80) {
    return Buffer.from([size])
  }

  const bytes: number[] = []

  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256)
  }

  return Buffer.from([0x80 | bytes.length, ...bytes])
}

/** An element of this tag around these contents. */
export function element(tag: number, ...contents: readonly Buffer[]): Buffer {
  const body = Buffer.concat(contents)

  return Buffer.concat([Buffer.from([tag]), lengthOf(body.length), body])
}

export const sequence = (...contents: readonly Buffer[]): Buffer => element(0x30, ...contents)

/**
 * A SET OF: in DER its elements stand in the order of their encodings, which
 * is what a verifier that encodes the set again compares against.
 */
export const set = (...contents: readonly Buffer[]): Buffer =>
  element(0x31, ...[...contents].sort(Buffer.compare))

export const octets = (bytes: Buffer): Buffer => element(0x04, bytes)

export const bits = (bytes: Buffer, unused = 0): Buffer =>
  element(0x03, Buffer.from([unused]), bytes)

export const utf8 = (text: string): Buffer => element(0x0c, Buffer.from(text, 'utf8'))

export const boolean = (value: boolean): Buffer => element(0x01, Buffer.from([value ? 0xff : 0]))

/** A non-negative INTEGER of these bytes, with the leading zero DER asks for when the first bit is set. */
export function unsigned(bytes: Buffer): Buffer {
  let start = 0

  while (start < bytes.length - 1 && bytes[start] === 0) {
    start += 1
  }

  const trimmed = bytes.subarray(start)

  return element(
    0x02,
    (trimmed[0] ?? 0) >= 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed,
  )
}

export const integer = (value: number): Buffer => unsigned(Buffer.from([value]))

/** UTCTime up to 2049, GeneralizedTime from 2050 on, as RFC 5280 asks. */
export function time(at: Date): Buffer {
  const iso = at.toISOString()
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`

  return at.getUTCFullYear() < 2050
    ? element(0x17, Buffer.from(digits.slice(2), 'latin1'))
    : element(0x18, Buffer.from(digits, 'latin1'))
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number)
  const bytes = [(parts[0] as number) * 40 + (parts[1] as number)]

  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f]

    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128)) {
      chunk.unshift((rest & 0x7f) | 0x80)
    }

    bytes.push(...chunk)
  }

  return element(0x06, Buffer.from(bytes))
}

/** The elements inside a constructed element, each whole with its tag and length. */
export function childrenOf(whole: Buffer): readonly Buffer[] {
  const children: Buffer[] = []
  let at = headerLength(whole, 0)

  while (at < whole.length) {
    const size = headerLength(whole, at) + contentLength(whole, at)

    children.push(whole.subarray(at, at + size))
    at += size
  }

  return children
}

/** What an element holds, without its tag and length. */
export function contentsOf(whole: Buffer): Buffer {
  return whole.subarray(headerLength(whole, 0), headerLength(whole, 0) + contentLength(whole, 0))
}

function headerLength(bytes: Buffer, at: number): number {
  const first = bytes[at + 1] ?? 0

  return first < 0x80 ? 2 : 2 + (first & 0x7f)
}

function contentLength(bytes: Buffer, at: number): number {
  const first = bytes[at + 1] ?? 0

  if (first < 0x80) {
    return first
  }

  let size = 0

  for (let index = 0; index < (first & 0x7f); index += 1) {
    size = size * 256 + (bytes[at + 2 + index] ?? 0)
  }

  return size
}
