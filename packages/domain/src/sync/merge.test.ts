import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { decideMerge, type RecordState } from './merge.js'
import {
  type FieldPatch,
  inOutboxOrder,
  type Operation,
  type OperationId,
  sameValue,
  toSyncValue,
} from './operation.js'

function operation(over: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1' as OperationId,
    entity: 'installations',
    recordId: 'record-1',
    kind: 'update',
    baseVersion: null,
    patches: [],
    recordedAt: new Date('2026-09-18T10:00:00.000Z'),
    deviceId: 'geraet-monteur',
    ...over,
  }
}

function patch(field: string, from: string | null, to: string | null): FieldPatch {
  return { field, from, to }
}

describe('a value on its way to the server', () => {
  it('turns a date into the one form both sides can compare', () => {
    // Two Date objects for the same moment are not equal to each other, and a
    // merge that hangs on equality cannot be built on that.
    const moment = new Date('2026-09-18T10:00:00.000Z')

    expect(toSyncValue(moment)).toBe('2026-09-18T10:00:00.000Z')
    expect(sameValue(moment, new Date('2026-09-18T10:00:00.000Z'))).toBe(true)
  })

  it('treats nothing and nothing at all as the same', () => {
    expect(sameValue(null, undefined)).toBe(true)
  })

  it('refuses what a patch cannot carry', () => {
    expect(() => toSyncValue({ deep: true })).toThrow(/patch can carry/)
  })
})

describe('the outbox', () => {
  it('hands its operations over in the order they were recorded', () => {
    const later = operation({
      id: 'a' as OperationId,
      recordedAt: new Date('2026-09-18T12:00:00Z'),
    })
    const earlier = operation({
      id: 'b' as OperationId,
      recordedAt: new Date('2026-09-18T09:00:00Z'),
    })

    expect(inOutboxOrder([later, earlier]).map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('puts two from the same moment in an order that does not depend on the run', () => {
    // Without a tie breaker the order of two writes in the same millisecond
    // would come out of whichever way they happened to be collected, and two
    // edits to one record in the wrong order give a final state neither device
    // meant.
    const moment = new Date('2026-09-18T12:00:00Z')
    const one = operation({ id: 'zzz' as OperationId, recordedAt: moment })
    const two = operation({ id: 'aaa' as OperationId, recordedAt: moment })

    expect(inOutboxOrder([one, two]).map((entry) => entry.id)).toEqual(['aaa', 'zzz'])
    expect(inOutboxOrder([two, one]).map((entry) => entry.id)).toEqual(['aaa', 'zzz'])
  })
})

describe('a record a technician fills in', () => {
  const current: RecordState = { version: 3, designation: 'UV Keller', notes: null }

  it('goes through when nobody touched the field in the meantime', () => {
    const result = decideMerge(
      operation({ patches: [patch('designation', 'UV Keller', 'UV Keller links')] }),
      current,
    )

    expect(result).toEqual({ outcome: 'apply', values: { designation: 'UV Keller links' } })
  })

  it('goes through when two devices wrote different fields', () => {
    // This is the merge on field level. The other device changed `notes`, this
    // one changes `designation`, and nothing about that needs deciding.
    const elsewhere: RecordState = { version: 4, designation: 'UV Keller', notes: 'Zählerplatz' }

    const result = decideMerge(
      operation({
        baseVersion: 3,
        patches: [patch('designation', 'UV Keller', 'UV Keller links')],
      }),
      elsewhere,
    )

    expect(result.outcome).toBe('apply')
  })

  it('becomes a conflict when the same field moved on', () => {
    const elsewhere: RecordState = { version: 4, designation: 'UV Keller rechts', notes: null }

    const result = decideMerge(
      operation({
        baseVersion: 3,
        patches: [patch('designation', 'UV Keller', 'UV Keller links')],
      }),
      elsewhere,
    )

    expect(result).toEqual({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['designation'],
    })
  })

  it('applies nothing at all once one of its fields collides', () => {
    // An operation is one intention. Letting half of it land would leave a
    // record that neither device ever meant, and the conflict list would be
    // missing the half that went through.
    const elsewhere: RecordState = { version: 4, designation: 'Fremd', notes: null }

    const result = decideMerge(
      operation({
        baseVersion: 3,
        patches: [patch('designation', 'UV Keller', 'Neu'), patch('notes', null, 'Mangel')],
      }),
      elsewhere,
    )

    expect(result.outcome).toBe('conflict')
  })

  it('takes the short way when the version still matches', () => {
    const result = decideMerge(
      operation({ baseVersion: 3, patches: [patch('designation', 'egal was hier steht', 'Neu')] }),
      current,
    )

    // Nothing has happened to the record since the device read it, so there is
    // nothing to compare field by field.
    expect(result.outcome).toBe('apply')
  })

  it('does nothing when the operation would change nothing', () => {
    const result = decideMerge(
      operation({ patches: [patch('designation', 'UV Keller', 'UV Keller')] }),
      current,
    )

    expect(result).toEqual({ outcome: 'skip', reason: 'nothing_to_do' })
  })
})

describe('master data', () => {
  it('may be created without a network', () => {
    const result = decideMerge(
      operation({
        entity: 'customers',
        kind: 'create',
        patches: [patch('name', null, 'Neu entdeckter Bauherr')],
      }),
      null,
    )

    expect(result.outcome).toBe('apply')
  })

  it('is not changed without one', () => {
    // An address corrected on two devices at once is a question for the
    // office, and the office has a connection.
    const result = decideMerge(
      operation({ entity: 'customers', patches: [patch('name', 'Alt', 'Neu')] }),
      { version: 1, name: 'Alt' },
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })
})

describe('what only the server makes', () => {
  it('is not made on a device, whatever it sends (#135)', () => {
    const result = decideMerge(
      operation({
        entity: 'document_sources',
        kind: 'create',
        patches: [
          patch('documentId', null, 'invoice-1'),
          patch('sourceDocumentId', null, 'report-1'),
        ],
      }),
      null,
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })

  it('is not changed on a device either', () => {
    const result = decideMerge(
      operation({ entity: 'document_sources', patches: [patch('position', '1', '2')] }),
      { version: 1, position: '1' },
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })
})

describe('a document', () => {
  it('can be written while it is a draft', () => {
    const result = decideMerge(
      operation({ entity: 'documents', patches: [patch('subject', null, 'Störung Küche')] }),
      { version: 1, status: 'draft', subject: null },
    )

    expect(result.outcome).toBe('apply')
  })

  it('is out of reach from a device once it has been issued', () => {
    // Not because of the field, but because of what the record has become.
    // From here it is corrected, not edited, and that happens on the server.
    const result = decideMerge(
      operation({ entity: 'documents', patches: [patch('subject', null, 'Nachträglich')] }),
      { version: 2, status: 'issued', subject: null },
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] })
  })

  it('cannot be issued from a device', () => {
    // The gate above asks what the record was before, so it lets exactly this
    // through: a draft is still a draft while the patch that ends it is being
    // judged. These three fields together are the issuing, and issuing needs
    // the counter and the server clock.
    const result = decideMerge(
      operation({
        entity: 'documents',
        patches: [
          patch('status', 'draft', 'issued'),
          patch('number', null, 'RE-2026-0001'),
          patch('issuedAt', null, '2026-09-19T08:00:00.000Z'),
        ],
      }),
      { version: 1, status: 'draft', number: null, issuedAt: null },
    )

    expect(result).toEqual({
      outcome: 'conflict',
      reason: 'set_by_server',
      fields: ['status', 'number', 'issuedAt'],
    })
  })

  it('cannot arrive already issued either', () => {
    // The harder way in, because there is no previous state for the gate to
    // look at. A document created like this would never have passed the
    // counter.
    const result = decideMerge(
      operation({
        entity: 'documents',
        kind: 'create',
        patches: [
          patch('kind', null, 'final_invoice'),
          patch('status', null, 'issued'),
          patch('number', null, 'RE-2026-0002'),
        ],
      }),
      null,
    )

    expect(result).toEqual({
      outcome: 'conflict',
      reason: 'set_by_server',
      fields: ['status', 'number'],
    })
  })

  it('cannot name its predecessor, which only the route that makes a successor does', () => {
    // A device that could name a predecessor could branch the chain (#129): a
    // final invoice next to a progress invoice deducts nothing of it.
    const result = decideMerge(
      operation({
        entity: 'documents',
        kind: 'create',
        patches: [
          patch('kind', null, 'final_invoice'),
          patch('predecessorDocumentId', null, 'd-quote'),
        ],
      }),
      null,
    )

    expect(result).toEqual({
      outcome: 'conflict',
      reason: 'set_by_server',
      fields: ['predecessorDocumentId'],
    })
  })

  it('is created as a draft when the device leaves those fields alone', () => {
    const result = decideMerge(
      operation({
        entity: 'documents',
        kind: 'create',
        patches: [patch('kind', null, 'final_invoice'), patch('subject', null, 'Störung Küche')],
      }),
      null,
    )

    expect(result.outcome).toBe('apply')
  })
})

describe('an operation that arrives twice', () => {
  it('creates nothing a second time', () => {
    const create = operation({ kind: 'create', patches: [patch('designation', null, 'UV Keller')] })

    expect(decideMerge(create, null).outcome).toBe('apply')
    // The same operation again, now that the record is there. The recorded
    // operation ids catch the ordinary repeat; this catches the half finished
    // one, where the row landed and the receipt did not.
    expect(decideMerge(create, { version: 1, designation: 'UV Keller' })).toEqual({
      outcome: 'skip',
      reason: 'already_there',
    })
  })

  it('does not change anything the second time round either', () => {
    const change = operation({ patches: [patch('designation', 'Alt', 'Neu')] })
    const before: RecordState = { version: 1, designation: 'Alt' }

    expect(decideMerge(change, before).outcome).toBe('apply')

    // After it has been applied, `from` no longer matches, so the repeat is a
    // conflict rather than a silent second write. That is the right way for it
    // to fail: loud, and with both versions in hand.
    expect(decideMerge(change, { version: 2, designation: 'Neu' }).outcome).toBe('conflict')
  })
})

describe('an operation on something that is not there', () => {
  it('is a conflict, not a quiet insert', () => {
    expect(decideMerge(operation({ patches: [patch('x', 'a', 'b')] }), null)).toEqual({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: [],
    })
  })

  it('is a conflict for an entity nobody knows either', () => {
    expect(decideMerge(operation({ entity: 'erfunden' }), { version: 1 }).outcome).toBe('conflict')
  })
})

describe('a record that has been deleted', () => {
  const deleted: RecordState = {
    version: 2,
    designation: 'UV Keller',
    deletedAt: '2026-09-19T08:00:00.000Z',
  }

  it('is as good as missing for a change', () => {
    // Nothing is ever removed for real, so the row is still found. Answering
    // "applied" would put the change on a row no list shows again.
    expect(
      decideMerge(operation({ patches: [patch('designation', 'UV Keller', 'UV Bad')] }), deleted),
    ).toEqual({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: [],
    })
  })

  it('is not deleted a second time', () => {
    // A queue that arrives twice did exactly what it said the first time.
    // A conflict here would ask a person to decide about nothing.
    expect(decideMerge(operation({ kind: 'delete' }), deleted)).toEqual({
      outcome: 'skip',
      reason: 'nothing_to_do',
    })
  })

  it('is still found when the same create arrives again', () => {
    // The reason the query behind this keeps deleted rows. Hiding them would
    // send a repeated create into the insert and onto a primary key collision.
    const create = operation({ kind: 'create', patches: [patch('designation', null, 'UV Keller')] })

    expect(decideMerge(create, deleted)).toEqual({ outcome: 'skip', reason: 'already_there' })
  })
})

describe('deleting a record', () => {
  const current: RecordState = { version: 3, designation: 'UV Keller', deletedAt: null }

  it('collides with a change made while the device was away', () => {
    // A delete carries no patches, so there is no field to compare. It touches
    // every field at once, which is why any change in the meantime collides.
    expect(decideMerge(operation({ kind: 'delete', baseVersion: 2 }), current)).toEqual({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: [],
    })
  })

  it('goes through when nothing happened since the device read it', () => {
    expect(decideMerge(operation({ kind: 'delete', baseVersion: 3 }), current)).toEqual({
      outcome: 'apply',
      values: {},
    })
  })

  it('goes through when the device claims nothing about the version', () => {
    expect(decideMerge(operation({ kind: 'delete', baseVersion: null }), current).outcome).toBe(
      'apply',
    )
  })
})

describe('whatever the device sends', () => {
  const value = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))

  it('never applies a change to a field somebody else has moved', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        value,
        value,
        value,
        (field, seen, wanted, actual) => {
          fc.pre(!Object.is(seen, actual))

          const result = decideMerge(
            operation({ baseVersion: 1, patches: [{ field, from: seen, to: wanted }] }),
            { version: 2, [field]: actual },
          )

          // The whole promise of the merge in one line: a field the device did
          // not see the current value of is never overwritten silently.
          return result.outcome === 'conflict'
        },
      ),
    )
  })

  it('never decides anything other than apply, conflict or skip', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('customers', 'installations', 'documents', 'erfunden'),
        fc.constantFrom('create', 'update', 'delete'),
        fc.option(fc.dictionary(fc.string({ minLength: 1 }), value), { nil: null }),
        (entity, kind, current) => {
          const result = decideMerge(
            operation({
              entity,
              kind: kind as Operation['kind'],
              patches: [patch('a', null, 'b')],
            }),
            current,
          )

          return ['apply', 'conflict', 'skip'].includes(result.outcome)
        },
      ),
    )
  })
})
