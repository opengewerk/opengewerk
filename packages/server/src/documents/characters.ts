/**
 * The characters no document of this system carries: everything XML 1.0
 * cannot hold, which takes in the control characters other than tab, line
 * feed and carriage return, and lone surrogates.
 *
 * One definition for the PDF and the e-invoice, because both are printed
 * from the same content and have to say the same thing. The e-invoice must
 * drop them, XML cannot carry them; the PDF drops them as well, because
 * Chromium draws a control character as a visible symbol, and the two
 * packagings of one invoice would differ by it.
 */
const unwritable = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

/** A text without the characters a document cannot carry, everything else as it was. */
export function withoutUnwritable(value: string): string {
  return value.replaceAll(unwritable, '')
}
