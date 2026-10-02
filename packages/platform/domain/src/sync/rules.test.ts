import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  type FieldPatch,
  inOutboxOrder,
  type Operation,
  type OperationId,
  sameValue,
  toSyncValue,
} from './operation.js'
import { keptByTheServer, type SyncPolicy } from './policy.js'
import { probePolicies } from './probe-policies.js'
import { type RecordState, syncRules } from './rules.js'

// The rules of the sync, asked with the policies of an application that
// belongs to nobody: shelves, notes, parcels, letters and their lines, visits
// and stamps. An application that binds its own list asks the same questions
// of it in its own tests; here the mechanism is held without any of them.

const { decideMerge, entities, isSetByServer, policyFor } = syncRules(probePolicies)

function operation(over: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1' as OperationId,
    entity: 'notes',
    recordId: 'record-1',
    kind: 'update',
    baseVersion: null,
    patches: [],
    recordedAt: new Date('2026-10-02T10:00:00.000Z'),
    deviceId: 'device',
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
    const moment = new Date('2026-10-02T10:00:00.000Z')

    expect(toSyncValue(moment)).toBe('2026-10-02T10:00:00.000Z')
    expect(sameValue(moment, new Date('2026-10-02T10:00:00.000Z'))).toBe(true)
  })

  it('treats nothing and nothing at all as the same', () => {
    expect(sameValue(null, undefined)).toBe(true)
    expect(sameValue(null, '')).toBe(false)
  })

  it('refuses what a patch cannot carry', () => {
    expect(() => toSyncValue({ deep: true })).toThrow(/patch can carry/)
  })
})

describe('the outbox', () => {
  it('hands its operations over in the order they were recorded', () => {
    const later = operation({
      id: 'a' as OperationId,
      recordedAt: new Date('2026-10-02T12:00:00Z'),
    })
    const earlier = operation({
      id: 'b' as OperationId,
      recordedAt: new Date('2026-10-02T09:00:00Z'),
    })

    expect(inOutboxOrder([later, earlier]).map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('puts two from the same moment in an order that does not depend on the run', () => {
    // Without a tie breaker the order of two writes in the same millisecond
    // would come out of whichever way they happened to be collected, and two
    // edits to one record in the wrong order give a final state neither device
    // meant.
    const moment = new Date('2026-10-02T12:00:00Z')
    const one = operation({ id: 'zzz' as OperationId, recordedAt: moment })
    const two = operation({ id: 'aaa' as OperationId, recordedAt: moment })

    expect(inOutboxOrder([one, two]).map((entry) => entry.id)).toEqual(['aaa', 'zzz'])
    expect(inOutboxOrder([two, one]).map((entry) => entry.id)).toEqual(['aaa', 'zzz'])
  })
})

describe('the rules of an application', () => {
  it('name its entities in the order of its list', () => {
    expect(entities).toEqual([
      'shelves',
      'notes',
      'parcels',
      'letters',
      'letter_lines',
      'letter_seals',
      'visits',
      'stamps',
    ])
  })

  it('know the policy of an entity of the list and of no other', () => {
    expect(policyFor('letters')).toBe(probePolicies['letters'])
    expect(policyFor('invented')).toBeNull()
  })

  it('take no entity from what every object has', () => {
    // The name arrives from a device. Looked up as a property, `constructor`
    // finds a function, which is no policy and was taken for one.
    expect(policyFor('constructor')).toBeNull()
    expect(policyFor('toString')).toBeNull()
    expect(decideMerge(operation({ entity: 'constructor' }), { version: 1 })).toEqual({
      outcome: 'conflict',
      reason: 'unknown_entity',
      fields: [],
    })
  })

  it('never mix with the rules of another application in the same process', () => {
    const other = syncRules({ ledgers: { create: true, change: 'merge' } })

    expect(other.entities).toEqual(['ledgers'])
    expect(other.policyFor('notes')).toBeNull()
    expect(policyFor('ledgers')).toBeNull()
    expect(other.decideMerge(operation(), { version: 1 }).outcome).toBe('conflict')
  })
})

describe('a field only the server writes', () => {
  it('is every column the server keeps, on every entity and on none', () => {
    for (const field of keptByTheServer) {
      expect(isSetByServer('notes', field), field).toBe(true)
      expect(isSetByServer('invented', field), field).toBe(true)
    }
  })

  it('is what the policy of the entity reserves, and only on that entity', () => {
    expect(isSetByServer('letters', 'status')).toBe(true)
    expect(isSetByServer('letters', 'number')).toBe(true)
    expect(isSetByServer('parcels', 'number')).toBe(true)
    // The same name on another table is an ordinary field there.
    expect(isSetByServer('notes', 'status')).toBe(false)
    expect(isSetByServer('notes', 'number')).toBe(false)
    expect(isSetByServer('letters', 'subject')).toBe(false)
  })
})

describe('a record somebody fills in at work', () => {
  const current: RecordState = { version: 3, title: 'Shelf by the door', text: null }

  it('goes through when nobody touched the field in the meantime', () => {
    const result = decideMerge(
      operation({ patches: [patch('title', 'Shelf by the door', 'Shelf by the window')] }),
      current,
    )

    expect(result).toEqual({ outcome: 'apply', values: { title: 'Shelf by the window' } })
  })

  it('goes through when two devices wrote different fields', () => {
    // This is the merge on field level. The other device changed `text`, this
    // one changes `title`, and nothing about that needs deciding.
    const elsewhere: RecordState = { version: 4, title: 'Shelf by the door', text: 'Second row' }

    const result = decideMerge(
      operation({
        baseVersion: 3,
        patches: [patch('title', 'Shelf by the door', 'Shelf by the window')],
      }),
      elsewhere,
    )

    expect(result).toEqual({ outcome: 'apply', values: { title: 'Shelf by the window' } })
  })

  it('becomes a conflict when the same field moved on', () => {
    const elsewhere: RecordState = { version: 4, title: 'Shelf in the hall', text: null }

    const result = decideMerge(
      operation({
        baseVersion: 3,
        patches: [patch('title', 'Shelf by the door', 'Shelf by the window')],
      }),
      elsewhere,
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['title'] })
  })

  it('applies nothing at all once one of its fields collides', () => {
    // An operation is one intention. Letting half of it land would leave a
    // record that neither device ever meant, and the conflict list would be
    // missing the half that went through.
    const elsewhere: RecordState = { version: 4, title: 'Somebody else', text: null }

    const result = decideMerge(
      operation({
        baseVersion: 3,
        patches: [patch('title', 'Shelf by the door', 'New'), patch('text', null, 'Dented')],
      }),
      elsewhere,
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['title'] })
  })

  it('takes the short way when the version still matches', () => {
    const result = decideMerge(
      operation({ baseVersion: 3, patches: [patch('title', 'whatever stands here', 'New')] }),
      current,
    )

    // Nothing has happened to the record since the device read it, so there is
    // nothing to compare field by field.
    expect(result).toEqual({ outcome: 'apply', values: { title: 'New' } })
  })

  it('compares field by field when the version moved on, whatever the device claims', () => {
    const result = decideMerge(
      operation({ baseVersion: 2, patches: [patch('title', 'whatever stands here', 'New')] }),
      current,
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['title'] })
  })

  it('does nothing when the operation would change nothing', () => {
    const result = decideMerge(
      operation({ patches: [patch('title', 'Shelf by the door', 'Shelf by the door')] }),
      current,
    )

    expect(result).toEqual({ outcome: 'skip', reason: 'nothing_to_do' })
  })
})

describe('master data', () => {
  it('may be created without a network', () => {
    const result = decideMerge(
      operation({ entity: 'shelves', kind: 'create', patches: [patch('name', null, 'Hall')] }),
      null,
    )

    expect(result).toEqual({ outcome: 'apply', values: { name: 'Hall' } })
  })

  it('is not changed without one', () => {
    // Something corrected on two devices at once is a question for whoever
    // sits at a desk, and a desk has a connection.
    const result = decideMerge(
      operation({ entity: 'shelves', patches: [patch('name', 'Old', 'New')] }),
      { version: 1, name: 'Old' },
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })

  it('is not deleted without one either', () => {
    expect(
      decideMerge(operation({ entity: 'shelves', kind: 'delete', baseVersion: 1 }), {
        version: 1,
        name: 'Old',
        deletedAt: null,
      }),
    ).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })
})

describe('what only the server makes', () => {
  it('is not made on a device, whatever it sends', () => {
    const result = decideMerge(
      operation({ entity: 'stamps', kind: 'create', patches: [patch('letterId', null, 'l-1')] }),
      null,
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })

  it('is not changed on a device either', () => {
    const result = decideMerge(
      operation({ entity: 'stamps', patches: [patch('position', '1', '2')] }),
      { version: 1, position: '1' },
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })
})

describe('a record that is written until it is fixed', () => {
  it('can be written while it is a draft', () => {
    const result = decideMerge(
      operation({ entity: 'letters', patches: [patch('subject', null, 'About the hall')] }),
      { version: 1, status: 'draft', subject: null },
    )

    expect(result).toEqual({ outcome: 'apply', values: { subject: 'About the hall' } })
  })

  it('is out of reach from a device once it has left that state', () => {
    // Not because of the field, but because of what the record has become.
    // From here it is corrected, not edited, and that happens on the server.
    const result = decideMerge(
      operation({ entity: 'letters', patches: [patch('subject', null, 'Afterwards')] }),
      { version: 2, status: 'sent', subject: null },
    )

    expect(result).toEqual({ outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] })
  })

  it('cannot be deleted from a device once it has left that state', () => {
    expect(
      decideMerge(operation({ entity: 'letters', kind: 'delete', baseVersion: 2 }), {
        version: 2,
        status: 'sent',
        deletedAt: null,
      }),
    ).toEqual({ outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] })
  })

  it('cannot be fixed from a device', () => {
    // The gate above asks what the record was before, so it lets exactly this
    // through: a draft is still a draft while the patch that ends it is being
    // judged. These fields together are the fixing, and that needs the counter
    // and the clock of the server.
    const result = decideMerge(
      operation({
        entity: 'letters',
        patches: [
          patch('status', 'draft', 'sent'),
          patch('number', null, 'L-2026-0001'),
          patch('sentAt', null, '2026-10-02T08:00:00.000Z'),
        ],
      }),
      { version: 1, status: 'draft', number: null, sentAt: null },
    )

    expect(result).toEqual({
      outcome: 'conflict',
      reason: 'set_by_server',
      fields: ['status', 'number', 'sentAt'],
    })
  })

  it('cannot arrive already fixed either', () => {
    // The harder way in, because there is no previous state for the gate to
    // look at. A record created like this would never have passed the counter.
    const result = decideMerge(
      operation({
        entity: 'letters',
        kind: 'create',
        patches: [
          patch('subject', null, 'About the hall'),
          patch('status', null, 'sent'),
          patch('number', null, 'L-2026-0002'),
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

  it('is created when the device leaves those fields alone', () => {
    const result = decideMerge(
      operation({
        entity: 'letters',
        kind: 'create',
        patches: [patch('subject', null, 'About the hall')],
      }),
      null,
    )

    expect(result).toEqual({ outcome: 'apply', values: { subject: 'About the hall' } })
  })
})

describe('a record whose gate sits on another record', () => {
  const draft: RecordState = { version: 1, status: 'draft' }
  const sent: RecordState = { version: 2, status: 'sent' }
  const line: RecordState = { version: 1, letterId: 'l-1', text: 'First line', deletedAt: null }

  it('is written while its parent is in the state the gate names', () => {
    expect(
      decideMerge(
        operation({ entity: 'letter_lines', patches: [patch('text', 'First line', 'Line one')] }),
        line,
        draft,
      ),
    ).toEqual({ outcome: 'apply', values: { text: 'Line one' } })
  })

  it('is refused once its parent has left that state, changed or new', () => {
    const fixed = { outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] }

    expect(
      decideMerge(
        operation({ entity: 'letter_lines', patches: [patch('text', 'First line', 'Line one')] }),
        line,
        sent,
      ),
    ).toEqual(fixed)
    // Creating included: it would add something to what is already closed.
    expect(
      decideMerge(
        operation({
          entity: 'letter_lines',
          kind: 'create',
          patches: [patch('letterId', null, 'l-1'), patch('text', null, 'One more')],
        }),
        null,
        sent,
      ),
    ).toEqual(fixed)
  })

  it('is refused without a parent, and names the field that points nowhere', () => {
    expect(
      decideMerge(
        operation({
          entity: 'letter_lines',
          kind: 'create',
          patches: [patch('letterId', null, 'l-gone'), patch('text', null, 'One more')],
        }),
        null,
      ),
    ).toEqual({ outcome: 'conflict', reason: 'record_missing', fields: ['letterId'] })
  })

  it('asks the parent before it asks about a field the server keeps', () => {
    // Both are wrong with this operation. The answer is the one about the
    // parent: what is closed stays closed, whatever else was tried.
    expect(
      decideMerge(
        operation({ entity: 'letter_lines', patches: [patch('total', '1', '2')] }),
        line,
        sent,
      ),
    ).toEqual({ outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] })
    expect(
      decideMerge(
        operation({ entity: 'letter_lines', patches: [patch('total', '1', '2')] }),
        line,
        draft,
      ),
    ).toEqual({ outcome: 'conflict', reason: 'set_by_server', fields: ['total'] })
  })

  it('is made on a draft and never changed, where the policy says so', () => {
    const seal = operation({
      entity: 'letter_seals',
      kind: 'create',
      patches: [patch('letterId', null, 'l-1'), patch('sealedBy', null, 'Erika Berg')],
    })

    expect(decideMerge(seal, null, draft).outcome).toBe('apply')
    expect(decideMerge(seal, null, sent)).toEqual({
      outcome: 'conflict',
      reason: 'record_is_fixed',
      fields: ['status'],
    })
    expect(
      decideMerge(
        operation({
          entity: 'letter_seals',
          patches: [patch('sealedBy', 'Erika Berg', 'E. Berg')],
        }),
        { version: 1, letterId: 'l-1', sealedBy: 'Erika Berg', deletedAt: null },
        draft,
      ),
    ).toEqual({ outcome: 'conflict', reason: 'online_only', fields: [] })
  })
})

describe('an operation that arrives twice', () => {
  it('creates nothing a second time', () => {
    const create = operation({ kind: 'create', patches: [patch('title', null, 'Shelf')] })

    expect(decideMerge(create, null)).toEqual({ outcome: 'apply', values: { title: 'Shelf' } })
    // The same operation again, now that the record is there. The recorded
    // operation ids catch the ordinary repeat; this catches the half finished
    // one, where the row landed and the receipt did not.
    expect(decideMerge(create, { version: 1, title: 'Shelf' })).toEqual({
      outcome: 'skip',
      reason: 'already_there',
    })
  })

  it('does not change anything the second time round either', () => {
    const change = operation({ patches: [patch('title', 'Old', 'New')] })

    expect(decideMerge(change, { version: 1, title: 'Old' }).outcome).toBe('apply')

    // After it has been applied, `from` no longer matches, so the repeat is a
    // conflict rather than a silent second write. That is the right way for it
    // to fail: loud, and with both versions in hand.
    expect(decideMerge(change, { version: 2, title: 'New' })).toEqual({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['title'],
    })
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

  it('is a conflict for an entity nobody knows, whatever it wants', () => {
    for (const kind of ['create', 'update', 'delete'] as const) {
      expect(decideMerge(operation({ entity: 'invented', kind }), { version: 1 })).toEqual({
        outcome: 'conflict',
        reason: 'unknown_entity',
        fields: [],
      })
    }
  })
})

describe('a record that has been deleted', () => {
  const deleted: RecordState = { version: 2, title: 'Shelf', deletedAt: '2026-10-02T08:00:00.000Z' }

  it('is as good as missing for a change', () => {
    // Nothing is ever removed for real, so the row is still found. Answering
    // "applied" would put the change on a row no list shows again.
    expect(decideMerge(operation({ patches: [patch('title', 'Shelf', 'Rack')] }), deleted)).toEqual(
      { outcome: 'conflict', reason: 'record_missing', fields: [] },
    )
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
    const create = operation({ kind: 'create', patches: [patch('title', null, 'Shelf')] })

    expect(decideMerge(create, deleted)).toEqual({ outcome: 'skip', reason: 'already_there' })
  })
})

describe('deleting a record', () => {
  const current: RecordState = { version: 3, title: 'Shelf', deletedAt: null }

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
    expect(decideMerge(operation({ kind: 'delete', baseVersion: null }), current)).toEqual({
      outcome: 'apply',
      values: {},
    })
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
        fc.constantFrom('shelves', 'notes', 'letters', 'letter_lines', 'stamps', 'invented'),
        fc.constantFrom('create', 'update', 'delete'),
        fc.option(fc.dictionary(fc.string({ minLength: 1 }), value), { nil: null }),
        fc.option(fc.dictionary(fc.string({ minLength: 1 }), value), { nil: null }),
        (entity, kind, current, parent) => {
          const result = decideMerge(
            operation({
              entity,
              kind: kind as Operation['kind'],
              patches: [patch('a', null, 'b')],
            }),
            current,
            parent,
          )

          return ['apply', 'conflict', 'skip'].includes(result.outcome)
        },
      ),
    )
  })
})

describe('a list of policies that contradicts itself', () => {
  const gated: SyncPolicy = {
    create: true,
    change: 'merge',
    onlyWhile: { field: 'status', values: ['draft'] },
    reserved: ['status'],
    createdAs: { status: 'draft' },
  }

  it('is taken when it does not', () => {
    expect(() => syncRules({ letters: gated })).not.toThrow()
    // A gate on a field the device writes itself needs no start: the device
    // knows what it wrote.
    expect(() =>
      syncRules({
        notes: { create: true, change: 'merge', onlyWhile: { field: 'open', values: [true] } },
      }),
    ).not.toThrow()
    // And neither does one on a record no device creates.
    expect(() =>
      syncRules({
        stamps: {
          create: false,
          change: 'merge',
          onlyWhile: { field: 'status', values: ['draft'] },
          reserved: ['status'],
        },
      }),
    ).not.toThrow()
  })

  it('is refused when a record made on a device could not be worked on before the server has it', () => {
    // The gate asks for a state only the server sets, and nothing says what a
    // new record starts as: made in a cellar, it would refuse its own first
    // change.
    const { createdAs: _start, ...withoutStart } = gated

    expect(() => syncRules({ letters: withoutStart })).toThrow(
      /letters: its gate asks "status", which only the server writes, and createdAs names no start/,
    )
  })

  it('is refused when a record starts outside its own gate', () => {
    expect(() => syncRules({ letters: { ...gated, createdAs: { status: 'sent' } } })).toThrow(
      /letters: it starts with "status" outside its own gate/,
    )
  })

  it('is refused when it names a start for a field a device sends itself', () => {
    expect(() =>
      syncRules({ letters: { ...gated, createdAs: { status: 'draft', subject: '' } } }),
    ).toThrow(/letters: createdAs names "subject", which a device sends itself/)
  })

  it('is refused when a record hangs on an entity the list does not have', () => {
    expect(() =>
      syncRules({
        letter_lines: {
          create: true,
          change: 'merge',
          gateFrom: {
            reference: 'letterId',
            entity: 'letters',
            field: 'status',
            values: ['draft'],
          },
        },
      }),
    ).toThrow(/letter_lines: it hangs on "letters", which is not in the list/)
  })

  it('is refused when the parent a gate asks could not answer for a record made on a device', () => {
    const { createdAs: _start, onlyWhile: _gate, ...parent } = gated

    expect(() =>
      syncRules({
        letters: parent,
        letter_lines: {
          create: true,
          change: 'merge',
          gateFrom: {
            reference: 'letterId',
            entity: 'letters',
            field: 'status',
            values: ['draft'],
          },
        },
      }),
    ).toThrow(
      /letter_lines: its gate asks "letters.status", which only the server writes, and createdAs there names no start/,
    )
  })

  it('names every contradiction at once, not the first one', () => {
    const { createdAs: _start, ...withoutStart } = gated

    expect(() =>
      syncRules({
        letters: withoutStart,
        letter_lines: {
          create: true,
          change: 'merge',
          gateFrom: { reference: 'letterId', entity: 'folders', field: 'status', values: ['open'] },
        },
      }),
    ).toThrow(/letters: its gate asks.*letter_lines: it hangs on "folders"/s)
  })
})
