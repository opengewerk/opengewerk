// Numbers that run without holes: the pattern a tenant sets for a sequence,
// and the number built from it. Which sequences there are is the application's
// list; how a pattern is written and what a counter becomes in it is the same
// everywhere.

const placeholder = /\{(year|number)(?::(\d+))?\}/g

/** The longest pattern a tenant may set. A number sits in a header line, not a paragraph. */
export const patternMaxLength = 40

/** A place for the counter: `{number}`, or `{number:4}` for four digits with leading zeros. */
const counterPlace = /^number(?::(\d+))?$/

/**
 * What is wrong with a pattern a tenant wants, as a sentence for the screen,
 * or null when nothing is.
 *
 * One function for the form and the route, so that the field says what the
 * server would refuse. A pattern needs exactly one place for the counter:
 * without one everything would get the same number, with two it would be
 * printed twice. The year may stand once. Everything around the placeholders
 * is letters, digits and the separators numbers are written with, because a
 * number travels into file names and into formats other programs read, where
 * an umlaut or a space is a question somebody else has to answer.
 */
export function patternProblem(pattern: string): string | null {
  if (pattern.trim() === '') {
    return 'Das Muster ist leer.'
  }

  if (pattern.length > patternMaxLength) {
    return `Das Muster ist länger als ${String(patternMaxLength)} Zeichen.`
  }

  // The text around the placeholders first: a brace left open is what went
  // wrong in "NR-{number", and saying the counter is missing would send
  // somebody looking in the wrong place.
  const literal = pattern.replace(/\{[^{}]*\}/g, '')

  if (/[{}]/.test(literal)) {
    return 'Eine geschweifte Klammer ohne Gegenstück. Platzhalter stehen in {}, etwa {year}.'
  }

  if (!/^[A-Za-z0-9._/-]*$/.test(literal)) {
    return 'Zwischen den Platzhaltern stehen nur Buchstaben ohne Umlaute, Ziffern und . _ / -'
  }

  const places = [...pattern.matchAll(/\{([^{}]*)\}/g)].map((found) => found[1] ?? '')
  const unknown = places.find((name) => name !== 'year' && !counterPlace.test(name))

  if (unknown !== undefined) {
    return `Unbekannter Platzhalter {${unknown}}. Möglich sind {year}, {number} und {number:4}.`
  }

  const counters = places.filter((name) => counterPlace.test(name))

  if (counters.length === 0) {
    return 'Es fehlt {number}, die laufende Nummer. Ohne sie wäre jede Nummer gleich.'
  }

  if (counters.length > 1) {
    return 'Die laufende Nummer steht zweimal im Muster.'
  }

  if (places.filter((name) => name === 'year').length > 1) {
    return 'Das Jahr steht zweimal im Muster.'
  }

  const width = counterPlace.exec(counters[0] ?? '')?.[1]

  if (width !== undefined && (Number(width) < 1 || Number(width) > 10)) {
    return 'Die laufende Nummer hat 1 bis 10 Stellen, etwa {number:4}.'
  }

  return null
}

export class InvalidPatternError extends Error {}

/**
 * Builds the number from a pattern and a counter. The client shows what the
 * next number will be, the server hands out the counter and builds the same
 * string from it. One function for both, so a preview cannot differ from what
 * ends up on the record: it is the same code, not the same idea written twice.
 *
 * The counter is not part of the preview's promise. Somebody else may draw a
 * number first, and then the sequence moves on. What must hold is that a
 * counter always produces the same text.
 */
export function numberFromPattern(
  pattern: string,
  values: { readonly counter: number; readonly year: number },
): string {
  if (!pattern.includes('{number')) {
    throw new InvalidPatternError(`Pattern without a number: ${pattern}`)
  }

  if (!Number.isInteger(values.counter) || values.counter < 1) {
    throw new InvalidPatternError(`Counter is not a positive whole number: ${values.counter}`)
  }

  return pattern.replace(placeholder, (_match, name: string, width: string | undefined) => {
    if (name === 'year') {
      return String(values.year)
    }

    const digits = width === undefined ? 1 : Number.parseInt(width, 10)

    return String(values.counter).padStart(digits, '0')
  })
}
