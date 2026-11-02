import type { FormDefinition, FormField } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { takenOver } from './protocols.js'

/**
 * What a new protocol takes over from the last one of its installation
 * (1.3), when the last one is of another form (#301): only what the new form
 * marks to take over, in the kind it has there, and of a choice only what it
 * offers. Two invented forms, so that each guard is asked on its own.
 */

function form(key: string, fields: readonly FormField[]): FormDefinition {
  return {
    key,
    version: 1,
    title: key,
    attachesTo: 'installation',
    sections: [{ key: 'general', title: 'Prüfung', fields }],
  }
}

const systems = [
  { value: 'tn_s', label: 'TN-S' },
  { value: 'tt', label: 'TT' },
]

const before = form('first', [
  { kind: 'text', key: 'tester', label: 'Prüfer', carry: true },
  { kind: 'text', key: 'note', label: 'Notiz', carry: true },
  { kind: 'text', key: 'instrument', label: 'Messgerät', carry: true },
  { kind: 'choice', key: 'earthing_system', label: 'Netzform', carry: true, options: systems },
  {
    kind: 'group',
    key: 'circuits',
    label: 'Stromkreise',
    repeat: 'circuits',
    fields: [
      { kind: 'text', key: 'cable', label: 'Leitung', carry: true },
      { kind: 'text', key: 'length', label: 'Länge', carry: true },
    ],
  },
])

const after = form('second', [
  { kind: 'text', key: 'tester', label: 'Prüfer', carry: true },
  // Known here, but not taken over: what was noted belongs to the last test.
  { kind: 'text', key: 'note', label: 'Notiz' },
  // A figure here, a text there.
  {
    kind: 'number',
    key: 'instrument',
    label: 'Messgerät',
    unit: 'piece',
    decimals: 0,
    carry: true,
  },
  {
    kind: 'choice',
    key: 'earthing_system',
    label: 'Netzform',
    carry: true,
    options: [{ value: 'tn_s', label: 'TN-S' }],
  },
  {
    kind: 'group',
    key: 'circuits',
    label: 'Stromkreise',
    repeat: 'circuits',
    fields: [
      { kind: 'text', key: 'cable', label: 'Leitung' },
      { kind: 'number', key: 'length', label: 'Länge', unit: 'metre', decimals: 0, carry: true },
    ],
  },
])

const block = (values: Record<string, string>) => ({ circuitId: 'k-1', circuit: null, values })

describe('a protocol started from one of another form', () => {
  it('takes over only what the new form marks to take over', () => {
    expect(
      takenOver(after, before, {
        tester: 'Paul Prüfer',
        note: 'Feuchte Dose',
        circuits: [block({ cable: 'NYM-J 3x1,5' })],
      }),
    ).toEqual({ tester: 'Paul Prüfer', circuits: [block({})] })
  })

  it('leaves a value of another kind behind', () => {
    expect(
      takenOver(after, before, {
        tester: 'Paul Prüfer',
        instrument: 'Benning IT 130',
        circuits: [block({ length: '12 m' })],
      }),
    ).toEqual({ tester: 'Paul Prüfer', circuits: [block({})] })
  })

  it('leaves a choice behind the new form does not offer', () => {
    expect(takenOver(after, before, { earthing_system: 'tt' })).toEqual({})
    expect(takenOver(after, before, { earthing_system: 'tn_s' })).toEqual({
      earthing_system: 'tn_s',
    })
  })
})
