import { describe, expect, it } from 'vitest'

import { printedNotes } from '../rules/document-content.js'
import { decideMerge } from '../sync/merge.js'
import type { Operation, OperationId } from '@opengewerk/platform-domain'
import { showsPrices, whyFixed } from './document.js'
import {
  deviceInfoProblem,
  longestDeviceInfo,
  longestSignerName,
  type SignedContent,
  signedContentFingerprint,
  signerNameProblem,
} from './document-signature.js'

/**
 * The signature of #73: a picture, a name, a moment and the device, and the
 * rules that make a signed report stay what the customer signed. Whether the
 * picture has the shape the pad draws is a question of the foundation, and
 * tested there (ADR 0010).
 */

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
        statesCashAccounting: false,
      }),
    ).toEqual([])
    expect(
      printedNotes({
        kind: 'quote',
        taxTreatment: 'small_business',
        recipientIsBusiness: false,
        statesCashAccounting: false,
      }),
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

describe('the name under a signature', () => {
  it('is something besides spaces, and no more than the table keeps', () => {
    expect(signerNameProblem('Erika Berg')).toBeNull()
    expect(signerNameProblem(`  ${'E'.repeat(longestSignerName)}  `)).toBeNull()

    for (const nobody of ['', '   ', null, undefined]) {
      expect(signerNameProblem(nobody)).toBe('Der Name dessen, der unterschreibt.')
    }

    expect(signerNameProblem('E'.repeat(longestSignerName + 1))).toBe(
      'Der Name dessen, der unterschreibt, hat höchstens 200 Zeichen.',
    )
  })
})

describe('the device information of a signature', () => {
  it('is kept up to the length of the table, and refused beyond it', () => {
    expect(deviceInfoProblem(null)).toBeNull()
    expect(deviceInfoProblem('x'.repeat(longestDeviceInfo))).toBeNull()
    expect(deviceInfoProblem('x'.repeat(longestDeviceInfo + 1))).toBe(
      'Die Angabe zum Gerät hat höchstens 500 Zeichen.',
    )
  })
})
