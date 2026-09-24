import type { RecordState } from '@opengewerk/domain'
import {
  longestSignaturePath,
  signatureBox,
  signaturePathIsValid,
  signedContentFingerprint,
} from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { farEnough, pathOf, type Point, pointIn, shortestStep, signedContentOf } from './signing.js'

/**
 * The arithmetic under the signature pad, without a pointer in sight.
 *
 * The one promise that matters is the last one in each block: whatever the
 * pad draws, the server takes, and whatever the device signs, the server
 * works out to the same fingerprint. Either one broken, and every signature
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

describe('what the customer signs', () => {
  const report: RecordState = {
    id: 'd-1',
    introText: 'Zwei Leitungsschutzschalter getauscht.',
  }

  it('comes to the fingerprint the server works out from its rows', () => {
    // What the device holds: sent without a kind and without a description,
    // which the server stores as its defaults, `item` and null.
    const held: RecordState[] = [
      {
        id: 'l-2',
        position: 2,
        designation: 'LS-Schalter B16',
        quantityMilli: 2000,
        unit: 'piece',
      },
      { id: 'l-1', position: 1, designation: 'Arbeitszeit', quantityMilli: 2500, unit: 'hour' },
    ]

    const onServer = signedContentFingerprint({
      introText: 'Zwei Leitungsschutzschalter getauscht.',
      lines: [
        {
          id: 'l-1',
          position: 1,
          kind: 'item',
          designation: 'Arbeitszeit',
          description: null,
          quantityMilli: 2500,
          unit: 'hour',
        },
        {
          id: 'l-2',
          position: 2,
          kind: 'item',
          designation: 'LS-Schalter B16',
          description: null,
          quantityMilli: 2000,
          unit: 'piece',
        },
      ],
    })

    expect(signedContentFingerprint(signedContentOf(report, held))).toBe(onServer)
  })

  it('reads a report without a text as one whose text is empty, as the server does', () => {
    const blank = signedContentOf({ id: 'd-2' }, [])

    // And without fields of the business, which leaves the fingerprint as it was (#78).
    expect(blank).toEqual({ introText: null, fields: null, lines: [] })
    expect(signedContentFingerprint(blank)).toBe(
      signedContentFingerprint({ introText: null, lines: [] }),
    )
  })

  it('changes with every line the customer did not see', () => {
    const lines: RecordState[] = [
      { id: 'l-1', position: 1, designation: 'Arbeitszeit', quantityMilli: 2500, unit: 'hour' },
    ]
    const seen = signedContentFingerprint(signedContentOf(report, lines))
    const more = signedContentFingerprint(
      signedContentOf(report, [
        ...lines,
        { id: 'l-9', position: 2, designation: 'Anfahrt', quantityMilli: 1000, unit: 'flat_rate' },
      ]),
    )

    expect(more).not.toBe(seen)
  })
})
