import { describe, expect, it } from 'vitest'

import { structureProblem, valueAfter } from './structure.js'

// What a device may not send of the structure at all (ADR 0014), asked
// without a database. Whether a section belongs to the board of its circuit
// needs one, and the tests of an application's sync hold that.

describe('what a device may not send of the structure', () => {
  it('is a kind of board nobody knows', () => {
    expect(structureProblem('distribution_boards', { kind: 'garage' }, null)).toBe(
      'Diese Art von Verteiler ist unbekannt.',
    )
    expect(structureProblem('distribution_boards', { kind: 'sub_distribution' }, null)).toBeNull()
    expect(structureProblem('distribution_boards', { designation: 'UV Küche' }, null)).toBeNull()
  })

  it('is a figure of a circuit out of bounds, judged as the circuit would stand afterwards', () => {
    const standing = {
      overcurrentDevice: 'circuit_breaker',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16000,
    }

    expect(structureProblem('circuits', { ratedCurrentMilli: 0 }, null)).not.toBeNull()
    expect(structureProblem('circuits', { ratedCurrentMilli: 20000 }, standing)).toBeNull()
    // The curve of a fuse with a breaker the patch does not touch.
    expect(structureProblem('circuits', { tripCharacteristic: 'gg' }, standing)).not.toBeNull()
  })

  it('is not a figure nobody touched: a circuit that is only renamed is let through', () => {
    const wrongAlready = { tripCharacteristic: 'gg', overcurrentDevice: 'circuit_breaker' }

    expect(structureProblem('circuits', { designation: 'F4' }, wrongAlready)).toBeNull()
  })

  it('is a figure of the PV structure out of its range', () => {
    expect(structureProblem('inverters', { ratedPowerW: 0 }, null)).not.toBeNull()
    expect(structureProblem('pv_strings', { tiltDeg: 91 }, null)).not.toBeNull()
    expect(structureProblem('pv_modules', { ratedPowerW: 400 }, null)).toBeNull()
  })

  it('is nothing for a table that is not the structure', () => {
    expect(structureProblem('equipment', { designation: '' }, null)).toBeNull()
    expect(structureProblem('labels', { kind: 'garage' }, null)).toBeNull()
  })
})

describe('the value of a field after an operation', () => {
  it('is what the operation sets, or else what the row holds, or else nothing', () => {
    const row = { id: 'c-1', designation: 'F1', consumer: null }

    expect(valueAfter('designation', { designation: 'F2' }, row)).toBe('F2')
    expect(valueAfter('designation', {}, row)).toBe('F1')
    expect(valueAfter('consumer', { consumer: null }, { ...row, consumer: 'Herd' })).toBeNull()
    expect(valueAfter('cableType', {}, null)).toBeNull()
  })
})
