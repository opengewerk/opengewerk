/**
 * A signature drawn with a finger or a pen, kept as the path of its strokes.
 *
 * What a signature is about, who gave it and what makes it stick are the
 * application's business. What every one of them shares is the picture: the
 * box it is drawn in and the shape of a path that is nothing but strokes.
 */

/**
 * The box a signature is drawn in, in units of its own. The pad on a device
 * keeps this aspect ratio whatever the screen, and every point is stored in
 * these units, so a signature drawn on a phone and one drawn on a tablet print
 * at the same size.
 */
export const signatureBox = { width: 1000, height: 400 } as const

/** Long enough for a signature drawn slowly, short enough for one transmission. */
export const longestSignaturePath = 40_000

/**
 * The name typed in under a signature, as long as an application keeps it. A
 * table that stores signatures holds the same length in a check of its own.
 */
export const longestSignerName = 200

/**
 * What is wrong with the name typed in under a signature, or null when
 * nothing is: something besides spaces, and no more than a table keeps. A
 * form asks before the signature is queued, the sync again before it lands.
 */
export function signerNameProblem(name: unknown): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : ''

  if (trimmed === '') {
    return 'Der Name dessen, der unterschreibt.'
  }

  return trimmed.length > longestSignerName
    ? `Der Name dessen, der unterschreibt, hat höchstens ${String(longestSignerName)} Zeichen.`
    : null
}

/**
 * Moves and lines in whole units: `M12,40L15,41L19,43M300,80L...`. Every group
 * starts with its own letter, so the pattern cannot backtrack its way into
 * trouble on a long string.
 */
const pathShape = /^(M\d{1,4},\d{1,4}(L\d{1,4},\d{1,4})*)+$/

/**
 * Whether a string is a signature as the pad draws one: moves and lines in
 * whole units, inside the box, and nothing else.
 *
 * The strictness is the security of it. The path goes into an SVG on a screen
 * and into a page that is printed, and a string that can only hold M, L,
 * digits and commas cannot carry anything else into either. An application
 * that stores signatures holds the same pattern in a check of its table.
 */
export function signaturePathIsValid(path: string): boolean {
  if (path.length === 0 || path.length > longestSignaturePath || !pathShape.test(path)) {
    return false
  }

  for (const point of path.matchAll(/(\d+),(\d+)/g)) {
    if (Number(point[1]) > signatureBox.width || Number(point[2]) > signatureBox.height) {
      return false
    }
  }

  return true
}
