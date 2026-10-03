import type { Operation, RecordState, SyncValue } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { newId } from '../database/identifier.js'
import { type RecordRules, recordRuleRefusal } from './record-rules.js'

/**
 * Whose mistake a broken rule is, for rules no application has: a visit ends
 * after it begins, and a shelf has a label. The rule is the application's;
 * what follows from which fields an operation sets is the same for every one.
 */

const rules: RecordRules = {
  visits: [
    {
      fields: ['startsAt', 'endsAt'],
      problem: (at) =>
        typeof at('startsAt') === 'string' &&
        typeof at('endsAt') === 'string' &&
        String(at('endsAt')) < String(at('startsAt'))
          ? 'Ein Besuch endet nicht vor seinem Beginn.'
          : null,
    },
  ],
  shelves: [
    {
      fields: ['label'],
      problem: (at) => (at('label') === '' ? 'Ein Regal braucht eine Bezeichnung.' : null),
    },
  ],
}

const refusal = recordRuleRefusal(rules)

function operation(
  entity: string,
  kind: Operation['kind'],
  patches: Readonly<Record<string, SyncValue>> = {},
): Operation {
  return {
    id: newId<'operation'>(),
    entity,
    recordId: newId<'record'>(),
    kind,
    baseVersion: null,
    patches: Object.entries(patches).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date(),
    deviceId: 'probe-phone',
  }
}

const held: RecordState = {
  startsAt: '2037-06-15T09:00',
  endsAt: '2037-06-15T11:00',
  label: 'Keller',
}

describe('a rule over the fields of one record', () => {
  it('is the mistake of the client when the operation makes the record', () => {
    const values = { startsAt: '2037-06-15T09:00', endsAt: '2037-06-15T08:00' }

    expect(refusal(operation('visits', 'create', values), values, null)).toEqual({
      kind: 'client',
      message: 'Ein Besuch endet nicht vor seinem Beginn.',
    })
  })

  it('is the mistake of the client when the operation sets every field the rule reads', () => {
    const values = { startsAt: '2037-06-15T12:00', endsAt: '2037-06-15T10:00' }

    expect(refusal(operation('visits', 'update', values), values, held)).toEqual({
      kind: 'client',
      message: 'Ein Besuch endet nicht vor seinem Beginn.',
    })
  })

  it('is a conflict about the one operation when it sets only some of them, with all the fields of the rule', () => {
    // The device moved the end and judged by the beginning it had in front
    // of it; somebody has moved the beginning since.
    const values = { endsAt: '2037-06-15T10:00' }
    const changed = { ...held, startsAt: '2037-06-15T10:30' }

    expect(refusal(operation('visits', 'update', values), values, changed)).toEqual({
      kind: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['startsAt', 'endsAt'],
    })
  })

  it('leaves a rule alone whose fields the operation does not touch', () => {
    const broken = { ...held, endsAt: '2037-06-15T08:00' }
    const values = { label: 'Dachboden' }

    expect(refusal(operation('visits', 'update', values), values, broken)).toBeNull()
  })

  it('asks nothing of a deletion, an entity without rules, or a name that is not an entity', () => {
    expect(refusal(operation('visits', 'delete'), {}, held)).toBeNull()
    expect(refusal(operation('notes', 'create', { text: '' }), { text: '' }, null)).toBeNull()
    expect(
      refusal(operation('constructor', 'create', { label: '' }), { label: '' }, null),
    ).toBeNull()
  })

  it('answers with the first rule an operation breaks', () => {
    const values = { label: '' }

    expect(refusal(operation('shelves', 'update', values), values, held)).toEqual({
      kind: 'client',
      message: 'Ein Regal braucht eine Bezeichnung.',
    })
  })
})
