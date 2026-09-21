import { describe, expect, it } from 'vitest'

import { printedNotes } from '../rules/document-content.js'
import { decideMerge } from '../sync/merge.js'
import type { Operation, OperationId } from '../sync/operation.js'
import { showsPrices, whyFixed } from './document.js'
import {
  longestSignaturePath,
  type SignedContent,
  signedContentFingerprint,
  signaturePathIsValid,
} from './document-signature.js'

/**
 * The signature of #73: a picture, a name, a moment and the device, and the
 * rules that make a signed report stay what the customer signed.
 */

describe('a signature path', () => {
  it('is moves and lines in whole units, inside the box', () => {
    expect(signaturePathIsValid('M10,20L30,40L35,42')).toBe(true)
    expect(signaturePathIsValid('M10,20L30,40M500,100L600,120')).toBe(true)
    expect(signaturePathIsValid('M0,0L1000,400')).toBe(true)
  })

  it('carries nothing else, because it goes straight into an SVG', () => {
    for (const path of [
      '',
      'M10,20L30,40"/><script>alert(1)</script>',
      'm10,20l30,40',
      'M10.5,20L30,40',
      'M-10,20L30,40',
      'L10,20',
      'M10,20 L30,40',
      'M10,20C30,40,50,60,70,80',
    ]) {
      expect(signaturePathIsValid(path)).toBe(false)
    }
  })

  it('stays inside the box and below its length', () => {
    expect(signaturePathIsValid('M1001,20L30,40')).toBe(false)
    expect(signaturePathIsValid('M10,401L30,40')).toBe(false)
    expect(signaturePathIsValid(`M1,1${'L1,1'.repeat(longestSignaturePath / 4)}`)).toBe(false)
  })
})

function report(over: Partial<SignedContent> = {}): SignedContent {
  return {
    introText: 'Unterverteilung im Keller geprüft, zwei Leitungsschutzschalter getauscht.',
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
    ...over,
  }
}

describe('the fingerprint of what was signed', () => {
  it('comes out the same for the same content, whatever order the lines arrive in', () => {
    const first = report()
    const shuffled = report({ lines: [...first.lines].reverse() })

    expect(signedContentFingerprint(shuffled)).toBe(signedContentFingerprint(first))
    expect(signedContentFingerprint(first)).toMatch(/^fnv1a32:[0-9a-f]{8}:\d+$/)
  })

  it('changes with anything the customer saw', () => {
    const signed = signedContentFingerprint(report())
    const [hours, material] = report().lines

    if (!hours || !material) {
      throw new Error('The sample report has two lines')
    }

    for (const changed of [
      report({ introText: 'Etwas anderes' }),
      report({ lines: [{ ...hours, quantityMilli: 3000 }, material] }),
      report({ lines: [hours, { ...material, designation: 'LS-Schalter B20' }] }),
      report({ lines: [hours] }),
      report({ lines: [{ ...hours, position: 3 }, material] }),
    ]) {
      expect(signedContentFingerprint(changed)).not.toBe(signed)
    }
  })

  it('does not change with the gaps between positions', () => {
    const [hours, material] = report().lines

    if (!hours || !material) {
      throw new Error('The sample report has two lines')
    }

    expect(signedContentFingerprint(report({ lines: [hours, { ...material, position: 7 }] }))).toBe(
      signedContentFingerprint(report()),
    )
  })
})

describe('a signed document', () => {
  it('says why it can no longer be changed', () => {
    expect(whyFixed({ kind: 'time_and_material_report', status: 'signed' })).toContain(
      'unterschrieben',
    )
    expect(whyFixed({ kind: 'time_and_material_report', status: 'draft' })).toBeNull()
  })

  it('is a report printed without prices, and so without a note on the tax', () => {
    expect(showsPrices('time_and_material_report')).toBe(false)
    expect(showsPrices('quote')).toBe(true)
    expect(
      printedNotes({
        kind: 'time_and_material_report',
        taxTreatment: 'small_business',
        recipientIsBusiness: false,
      }),
    ).toEqual([])
    expect(
      printedNotes({ kind: 'quote', taxTreatment: 'small_business', recipientIsBusiness: false }),
    ).toHaveLength(1)
  })
})

function signing(documentId = 'd-1'): Operation {
  return {
    id: 'op-sign' as OperationId,
    entity: 'document_signatures',
    recordId: 's-1',
    kind: 'create',
    baseVersion: null,
    patches: [
      { field: 'documentId', from: null, to: documentId },
      { field: 'signerName', from: null, to: 'Erika Berg' },
      { field: 'path', from: null, to: 'M10,20L30,40' },
    ],
    recordedAt: new Date('2026-09-21T14:32:00.000Z'),
    deviceId: 'geraet-monteur',
  }
}

describe('a signature arriving from a device', () => {
  it('lands on a draft', () => {
    expect(decideMerge(signing(), null, { id: 'd-1', status: 'draft' }).outcome).toBe('apply')
  })

  it('is refused on a document already signed or issued, so there is never a second one', () => {
    for (const status of ['signed', 'issued', 'cancelled']) {
      expect(decideMerge(signing(), null, { id: 'd-1', status })).toMatchObject({
        outcome: 'conflict',
        reason: 'record_is_fixed',
      })
    }
  })

  it('belongs to nothing without its document', () => {
    expect(decideMerge(signing(), null, null)).toMatchObject({
      outcome: 'conflict',
      reason: 'record_missing',
    })
  })

  it('is never changed afterwards, not even by the device that made it', () => {
    const change: Operation = {
      ...signing(),
      id: 'op-change' as OperationId,
      kind: 'update',
      patches: [{ field: 'signerName', from: 'Erika Berg', to: 'Jemand anderes' }],
    }

    expect(
      decideMerge(
        change,
        { id: 's-1', documentId: 'd-1', signerName: 'Erika Berg', version: 1, deletedAt: null },
        { id: 'd-1', status: 'signed' },
      ).outcome,
    ).toBe('conflict')
  })
})
