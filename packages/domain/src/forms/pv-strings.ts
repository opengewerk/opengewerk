import { isBlockCircuit, type RepeatList } from '@opengewerk/platform-domain'

import type { TradeFormTerms } from './definition.js'
import type { BlockCircuit } from './values.js'

/**
 * The strings of a PV system as a list a group of a form repeats over (#305):
 * the test of the DC side measures string by string, as the first inspection
 * measures circuit by circuit. A block keeps its string in the shape of a
 * circuit, its designation and a line of what it is, without a protective
 * device; the screens and the paper draw both the same way, and a limit worked
 * out of a protective device finds none.
 */
export const pvStringList: RepeatList = {
  itemIsValid: (item) =>
    isBlockCircuit(item) &&
    (item as BlockCircuit).tripCharacteristic === null &&
    (item as BlockCircuit).ratedCurrentMilli === null &&
    (item as BlockCircuit).ratedResidualCurrentMilli === null,
  sentences: {
    blockWithoutItem: (label) => `${label}: jeder Block gehört zu einem String.`,
    itemTwice: (label) => `${label}: ein String hat zwei Blöcke.`,
  },
}

/** What a list of a group is called on the screens and on paper: one of it, and the list. */
export const repeatNouns: Readonly<
  Record<TradeFormTerms['list'], { readonly one: string; readonly many: string }>
> = {
  circuits: { one: 'Stromkreis', many: 'Stromkreise' },
  pv_strings: { one: 'String', many: 'Strings' },
}

/** A string as the PV structure has it, with its inverter and its modules. */
export interface PvStringFacts {
  readonly designation: string
  readonly mppInput: number | null
  /** The designation of the inverter it hangs on. */
  readonly inverter: string | null
  readonly modules: number
  /** Of all its modules, in watts; null where one names none. */
  readonly ratedPowerW: number | null
}

const peak = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A string as its block keeps it: "String 1" and "WR 1, Eingang 1, 12 Module, 4,80 kWp". */
export function pvStringItem(facts: PvStringFacts): BlockCircuit {
  const line = [
    facts.inverter,
    facts.mppInput === null ? null : `Eingang ${String(facts.mppInput)}`,
    facts.modules === 1 ? '1 Modul' : `${String(facts.modules)} Module`,
    facts.ratedPowerW === null ? null : `${peak.format(facts.ratedPowerW / 1000)} kWp`,
  ]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ')

  return {
    designation: facts.designation,
    consumer: line === '' ? null : line,
    tripCharacteristic: null,
    ratedCurrentMilli: null,
    ratedResidualCurrentMilli: null,
  }
}
