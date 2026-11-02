import type { RecordState } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import {
  applianceFormProblem,
  applianceState,
  asAppliance,
  lastResult,
  nextToTest,
} from './appliances.js'

/**
 * How the register reads an appliance (#303): its last signed test, how it
 * stands today, the next one to test, and what its form sends.
 */

function test(
  id: string,
  performedOn: string,
  status: 'draft' | 'signed',
  values: Record<string, unknown> = {},
): RecordState {
  return {
    id,
    definitionKey: 'dguv-v3',
    definitionVersion: 1,
    applianceId: 'a-1',
    performedOn,
    status,
    values: JSON.stringify(values),
  }
}

describe('an appliance in the register', () => {
  it('is read by its last signed test, the day it names for the next and whether it found defects', () => {
    expect(
      lastResult([
        test('t-3', '2026-11-02', 'draft'),
        test('t-2', '2026-05-02', 'signed', { verdict: 'defects', next_inspection_months: 6000 }),
        test('t-1', '2025-11-02', 'signed', { verdict: 'passed', next_inspection_months: 6000 }),
      ]),
    ).toEqual({ performedOn: '2026-05-02', defects: true, nextOn: '2026-11-02' })
    expect(lastResult([test('t-1', '2026-11-02', 'draft')])).toBeNull()
  })

  it('stands as tested today, a draft of today, due, tested earlier or never', () => {
    const passed = { verdict: 'passed', next_inspection_months: 12_000 }

    expect(applianceState([test('t-1', '2026-11-02', 'signed', passed)], '2026-11-02')).toEqual({
      kind: 'today',
      defects: false,
    })
    expect(
      applianceState(
        [test('t-2', '2026-11-02', 'draft'), test('t-1', '2025-10-01', 'signed', passed)],
        '2026-11-02',
      ),
    ).toEqual({ kind: 'draft', id: 't-2' })
    expect(applianceState([test('t-1', '2025-10-01', 'signed', passed)], '2026-11-02')).toEqual({
      kind: 'due',
      on: '2026-10-01',
    })
    expect(applianceState([test('t-1', '2026-03-01', 'signed', passed)], '2026-11-02')).toEqual({
      kind: 'tested',
      on: '2026-03-01',
      nextOn: '2027-03-01',
    })
    expect(applianceState(undefined, '2026-11-02')).toEqual({ kind: 'untested' })
  })

  it('names as next the one after it in the list that is not tested today, then the first before it', () => {
    const passedToday = test('t-1', '2026-11-02', 'signed', { verdict: 'passed' })
    const appliances = ['a-1', 'a-2', 'a-3', 'a-4'].map((id) => ({ id }))
    const tests = new Map([['a-3', [passedToday]]])

    expect(nextToTest(appliances, tests, 'a-2', '2026-11-02')?.['id']).toBe('a-4')
    expect(nextToTest(appliances, tests, 'a-4', '2026-11-02')?.['id']).toBe('a-1')
    expect(
      nextToTest(
        appliances,
        new Map(appliances.map((a) => [String(a.id), [passedToday]])),
        'a-1',
        '2026-11-02',
      ),
    ).toBeNull()
  })

  it('sends the length of its lead in millimetres, and refuses one that is no figure', () => {
    expect(
      asAppliance({
        designation: ' Kabeltrommel 50 m ',
        inventoryNumber: '008',
        protectionClass: 'I',
        mobility: 'portable',
        cordLength: '50',
        location: '',
      }),
    ).toMatchObject({
      designation: 'Kabeltrommel 50 m',
      inventoryNumber: '008',
      cordLengthMilli: 50_000,
      location: null,
    })
    expect(asAppliance({ designation: 'Bohrhammer', cordLength: '' }).cordLengthMilli).toBeNull()
    expect(applianceFormProblem({ designation: 'Bohrhammer', cordLength: 'lang' })).toBe(
      'Die Länge der Anschlussleitung ist eine Zahl in Metern, etwa 1,5.',
    )
    expect(applianceFormProblem({ designation: ' ', cordLength: '' })).toBe(
      'Ein Gerät braucht eine Bezeichnung.',
    )
    expect(applianceFormProblem({ designation: 'Bohrhammer', cordLength: '1,5' })).toBeNull()
  })
})
