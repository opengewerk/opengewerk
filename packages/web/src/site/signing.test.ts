import type { RecordState } from '@opengewerk/domain'
import { signedContentFingerprint } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { signedContentOf } from './signing.js'

/**
 * What the device signs, worked out from the records it holds.
 *
 * The one promise that matters is the first one: whatever the device signs,
 * the server works out to the same fingerprint. Broken, and every signature
 * given on site ends as a refusal nobody there can explain. The arithmetic of
 * the pad itself belongs to the foundation and is tested there (ADR 0010).
 */

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
