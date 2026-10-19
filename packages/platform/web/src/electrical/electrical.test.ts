import type { RecordState } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  boardTitle,
  circuitsInWords,
  circuitSummary,
  nextPosition,
  ordered,
  readFigure,
} from './electrical.js'
import { inModules, stringsInWords } from './photovoltaic.js'

// The parts of the structure both entries of an application build their
// screens from (ADR 0014), asked without a screen. The screens themselves
// are the application's, and so are their tests.

const part = (id: string, designation: string, position: number): RecordState =>
  ({ id, designation, position }) as unknown as RecordState

describe('a figure somebody typed', () => {
  it('is read the way it is typed in Germany, in thousandths', () => {
    expect(readFigure('16', 3)).toEqual({ value: 16000 })
    expect(readFigure('1,5', 3)).toEqual({ value: 1500 })
    expect(readFigure('  ', 3)).toEqual({ value: null })
  })

  it('may carry the unit of its field, and only that one, only at the end', () => {
    expect(readFigure('16 A', 3, ['A'])).toEqual({ value: 16000 })
    expect(readFigure('16 mA', 3, ['A'])).toEqual({ problem: 'Das ist keine Zahl.' })
  })

  it('says whether it is no number or one with too many places', () => {
    expect(readFigure('sechzehn', 3)).toEqual({ problem: 'Das ist keine Zahl.' })
    expect(readFigure('1,2345', 3)).toEqual({
      problem: 'Das ist keine Zahl mit höchstens 3 Nachkommastellen.',
    })
    expect(readFigure('2,5', 0)).toEqual({ problem: 'Das ist keine ganze Zahl.' })
  })
})

describe('the parts of one level', () => {
  it('stand in the order somebody put them, F2 before F10 where they did not', () => {
    const parts = [part('c', 'F10', 0), part('a', 'F2', 0), part('b', 'F1', 1)]

    expect(ordered(parts).map((one) => one['id'])).toEqual(['a', 'c', 'b'])
  })

  it('take a new one at the end', () => {
    expect(nextPosition([])).toBe(0)
    expect(nextPosition([part('a', 'F1', 0), part('b', 'F2', 4)])).toBe(5)
  })

  it('keep the modules of a string where they were put, having no name to sort by', () => {
    const modules = [part('c', '', 1), part('b', '', 0), part('a', '', 1)]

    expect(inModules(modules).map((one) => one['id'])).toEqual(['b', 'a', 'c'])
  })
})

describe('the words for a part', () => {
  it('head a board with its kind, the way the chart does', () => {
    expect(boardTitle({ ...part('a', 'UV Küche', 0), kind: 'sub_distribution' })).toBe(
      'Unterverteilung UV Küche',
    )
  })

  it('sum up a circuit in one line, or say nothing where nothing is known', () => {
    const circuit = {
      ...part('a', 'F1', 0),
      overcurrentDevice: 'circuit_breaker',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16000,
    } as unknown as RecordState

    expect(circuitSummary(circuit)).toContain('16 A')
    expect(circuitSummary(part('b', 'F2', 1))).toBeNull()
  })

  it('count circuits and strings the same way on both entries', () => {
    expect([0, 1, 3].map(circuitsInWords)).toEqual([
      'kein Stromkreis',
      '1 Stromkreis',
      '3 Stromkreise',
    ])
    expect(stringsInWords(2)).toContain('2')
  })
})
