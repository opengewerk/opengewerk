import {
  longestSignaturePath,
  signatureBox,
  signaturePathIsValid,
} from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { farEnough, pathOf, type Point, pointIn, shortestStep } from './strokes.js'

/**
 * The arithmetic under the signature pad, without a pointer in sight.
 *
 * The one promise that matters is the last one: whatever the pad draws, a
 * server that asks `signaturePathIsValid` takes. Broken, and every signature
 * given on site ends as a refusal nobody there can explain.
 */

describe('a point on the pad', () => {
  const frame = { left: 20, top: 100, width: 500, height: 200 }

  it('lands in the box whatever size the pad is shown at', () => {
    expect(pointIn(frame, 20, 100)).toEqual({ x: 0, y: 0 })
    expect(pointIn(frame, 520, 300)).toEqual({ x: signatureBox.width, y: signatureBox.height })
    expect(pointIn(frame, 270, 200)).toEqual({ x: 500, y: 200 })
  })

  it('stays inside the box when the finger slides past the edge', () => {
    expect(pointIn(frame, -40, 900)).toEqual({ x: 0, y: signatureBox.height })
  })

  it('is no point at all while the pad has no size', () => {
    expect(pointIn({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toBeNull()
    expect(pointIn({ left: 0, top: 0, width: 0, height: 200 }, 10, 10)).toBeNull()
    expect(pointIn({ left: 0, top: 0, width: 500, height: 0 }, 10, 10)).toBeNull()
  })

  it('is only kept when it moved far enough from the last one', () => {
    expect(farEnough({ x: 10, y: 10 }, { x: 11, y: 11 })).toBe(false)
    expect(farEnough({ x: 10, y: 10 }, { x: 10 + shortestStep, y: 10 })).toBe(true)
  })
})

/** A fixed sequence of numbers, so a failure here fails the same way twice. */
function sequence(seed: number): () => number {
  let state = seed

  return () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0

    return state / 2 ** 32
  }
}

describe('the path the pad writes', () => {
  it('draws a tap as a dot and not as nothing', () => {
    expect(pathOf([[{ x: 100, y: 200 }]])).toBe('M100,200L100,200')
  })

  it('writes every stroke as a move and its lines', () => {
    expect(
      pathOf([
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        [
          { x: 5, y: 6 },
          { x: 7, y: 8 },
        ],
      ]),
    ).toBe('M1,2L3,4M5,6L7,8')
  })

  it('is empty without a stroke', () => {
    expect(pathOf([])).toBe('')
  })

  it('is a path the server accepts, for any strokes inside the box', () => {
    const next = sequence(73)

    for (let round = 0; round < 200; round += 1) {
      const strokes: Point[][] = Array.from({ length: 1 + Math.floor(next() * 5) }, () =>
        Array.from({ length: 1 + Math.floor(next() * 60) }, () =>
          pointIn(
            { left: 0, top: 0, width: 375, height: 150 },
            next() * 420 - 20,
            next() * 190 - 20,
          ),
        ).filter((point): point is Point => point !== null),
      )
      const path = pathOf(strokes)

      expect(path.length).toBeLessThanOrEqual(longestSignaturePath)
      expect(signaturePathIsValid(path), path).toBe(true)
    }
  })
})
