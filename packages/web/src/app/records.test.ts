import { describe, expect, it } from 'vitest'

import { records } from './records.js'

/**
 * What this application hands the screens of the conflicts (ADR 0010): the
 * values of a document line as the document screen writes them, the
 * signature no version settles, and the new draft for an issued document.
 */

describe('the words of this application for a record', () => {
  it('write the values of a line as the document screen does', () => {
    expect(records.valueText('quantityMilli', 1500)).toBe('1,5')
    // With the space that does not break, as every amount of this application.
    expect(records.valueText('unitPriceCents', 4850)).toBe('48,50 €')
    expect(records.valueText('priceBase', 100)).toBe('je 100')
    expect(records.valueText('unit', 'metre')).toBe('Meter')
    expect(records.valueText('vatRate', 'reduced')).toBe('Ermäßigt')
  })

  it('leave everything else to the foundation, a value of a kind they do not know included', () => {
    expect(records.valueText('unit', 'quatsch')).toBeNull()
    expect(records.valueText('vatRate', 'toString')).toBeNull()
    expect(records.valueText('unit', 3)).toBeNull()
    expect(records.valueText('quantityMilli', '1500')).toBeNull()
    expect(records.valueText('designation', 'Arbeitszeit')).toBeNull()
  })

  it('name kinds, fields and records in German, and fall back to the raw name', () => {
    expect(records.entityLabel('document_lines')).toBe('Belegposition')
    expect(records.entityLabel('tickets')).toBe('tickets')
    expect(records.fieldLabel('quantityMilli')).toBe('Menge')
    expect(records.fieldLabel('somethingNew')).toBe('somethingNew')
    expect(records.titleOf('jobs', { designation: 'Zähler prüfen' })).toBe('Zähler prüfen')
    expect(records.titleOf('jobs', null)).toBe('Auftrag ohne Bezeichnung')
  })

  it('settle a signature by a sentence, since no version of it may win', () => {
    expect(records.settledElsewhere['document_signatures']).toMatch(/^Die Unterschrift gilt nicht/)
    expect(Object.keys(records.settledElsewhere)).toEqual(['document_signatures'])
  })

  it('show what the device wrote to an issued document in the order of the document screen', () => {
    expect(
      records.otherWay?.fields({
        kind: 'item',
        unit: 'hour',
        vatRate: 'standard',
        position: 3,
        documentId: 'd-1',
        designation: 'Kabel nachgezogen',
        somethingNew: 1,
        quantityMilli: 1500,
        unitPriceCents: 6500,
      }),
    ).toEqual(['designation', 'quantityMilli', 'unit', 'unitPriceCents', 'vatRate', 'somethingNew'])
    expect(records.otherWay?.fields({ introText: 'x', subject: 'y', serviceUntil: 'z' })).toEqual([
      'subject',
      'introText',
      'serviceUntil',
    ])
  })

  it('offer a new draft in the words of a document', () => {
    expect(records.otherWay?.action).toBe('Als neuen Entwurf anlegen')
    expect(records.otherWay?.madeLabel).toBe('Als neuer Entwurf angelegt')
    expect(records.otherWay?.made('Nachtrag zu Regiebericht RB-2026-0001')).toBe(
      'Entwurf angelegt: Nachtrag zu Regiebericht RB-2026-0001. Er gehört zum selben Kunden und ' +
        'Auftrag wie der festgeschriebene Beleg.',
    )
    expect(records.otherWay?.explanation).toMatch(/^Der Beleg ist inzwischen festgeschrieben/)
    expect(records.otherWay?.stillOpen).toMatch(/^Der Entwurf ist angelegt\./)
  })
})
