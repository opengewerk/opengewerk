/**
 * The characters no document of this system carries: everything XML 1.0
 * cannot hold, which takes in the control characters other than tab, line
 * feed and carriage return, and lone surrogates.
 *
 * One definition for a PDF and for any XML printed from the same content,
 * because both have to say the same thing. The XML must drop them, it cannot
 * carry them; the PDF drops them as well, because Chromium draws a control
 * character as a visible symbol, and the two packagings of one record would
 * differ by it.
 */
const unwritable = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

/** A text without the characters a document cannot carry, everything else as it was. */
export function withoutUnwritable(value: string): string {
  return value.replaceAll(unwritable, '')
}
