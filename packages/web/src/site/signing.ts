import type { RecordState, SignedContent } from '@opengewerk/domain'
import { signatureBox } from '@opengewerk/domain'

import { lineKindOf, lineUnitOf } from '../app/labels.js'
import { count } from '../sync/fields.js'

/** A point in the box a signature is drawn in, in whole units. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** Where on the screen the pad sits, as `getBoundingClientRect` reports it. */
export interface Frame {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The shortest step a stroke takes, in units of the box.
 *
 * A finger reports a position many times a second, and most of those are a
 * pixel from the last one. Keeping all of them makes the path long without
 * making the signature any more recognisable; dropping the ones closer than
 * this keeps a signature to a few hundred points.
 */
export const shortestStep = 4

function within(value: number, largest: number): number {
  return Math.min(largest, Math.max(0, Math.round(value)))
}

/**
 * A position on the screen, turned into a point in the box.
 *
 * Null when the pad has no size, which is what a hidden element reports. A
 * division by that would put `NaN` into the path, and the server would refuse
 * the signature for a reason nobody on site could see.
 */
export function pointIn(frame: Frame, clientX: number, clientY: number): Point | null {
  if (frame.width <= 0 || frame.height <= 0) {
    return null
  }

  return {
    x: within(((clientX - frame.left) / frame.width) * signatureBox.width, signatureBox.width),
    y: within(((clientY - frame.top) / frame.height) * signatureBox.height, signatureBox.height),
  }
}

/** Whether a point is far enough from the last one to be worth keeping. */
export function farEnough(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= shortestStep
}

/**
 * The strokes as one path, in the shape `signaturePathIsValid` accepts: a move
 * to where each stroke starts and a line to every point after it.
 *
 * A stroke of a single point is a tap, the dot on an i. It gets a line to
 * itself, which draws a dot with round caps; a move alone draws nothing, and
 * the dot would be on the record and missing from every picture of it.
 */
export function pathOf(strokes: readonly (readonly Point[])[]): string {
  return strokes
    .map((stroke) => {
      const [first, ...rest] = stroke

      if (!first) {
        return ''
      }

      const onwards = rest.length > 0 ? rest : [first]

      return `M${String(first.x)},${String(first.y)}${onwards
        .map((point) => `L${String(point.x)},${String(point.y)}`)
        .join('')}`
    })
    .join('')
}

/**
 * What the customer is shown and signs, read off the records as this device
 * holds them.
 *
 * The fallbacks are the server's own defaults and nothing else. The server
 * works the fingerprint out again from its rows, and a field the device never
 * sent is on the server with its default; reading it here as anything else
 * would make every signature on such a line a conflict. `kind` is the one of
 * these fields with a default in the table, and `lineKindOf` falls back to
 * that same `item`.
 */
export function signedContentOf(report: RecordState, lines: readonly RecordState[]): SignedContent {
  const introText = report['introText']

  return {
    introText: typeof introText === 'string' ? introText : null,
    lines: lines.map((line) => {
      const designation = line['designation']
      const description = line['description']

      return {
        id: String(line['id']),
        position: count(line, 'position'),
        kind: lineKindOf(line),
        designation: typeof designation === 'string' ? designation : '',
        description: typeof description === 'string' ? description : null,
        quantityMilli: count(line, 'quantityMilli'),
        unit: lineUnitOf(line),
      }
    }),
  }
}
