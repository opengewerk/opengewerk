import { formEngine } from '@opengewerk/platform-domain'

import { circuitList, loopImpedance, residualTripCurrent } from './circuits.js'
import type { TradeFormTerms } from './definition.js'
import { formUnits } from './units.js'

/**
 * The kinds of field the screens of this application show and its protocols
 * print, beside the signature and the group. Check points and readings, which
 * the foundation knows as well, are not among them. Here and not beside the
 * terms, because the definitions import the engine and a value read while
 * that import is still running would not be there yet.
 */
export const tradeFieldKinds = [
  'text',
  'number',
  'measurement',
  'choice',
  'yes_no',
  'photo',
] as const

/**
 * The form engine of the foundation (ADR 0010, opengewerk-haustechnik#28),
 * bound to the forms of this application: its units, the circuits a group
 * repeats over, the two limits worked out of a circuit, the kinds of field its
 * screens show, and its sentences. A field of its forms is about nothing but
 * what the form hangs on, so it names no records.
 *
 * A block keeps its circuit under `circuitId` and `circuit`, the keys every
 * protocol has been written with since #79. Signed protocols never change, and
 * a draft waiting in the outbox of a device is compared character for
 * character, so the keys stay as they are.
 */
export const tradeForms = formEngine<TradeFormTerms>({
  units: formUnits,
  lists: { circuits: circuitList },
  limits: { loop_impedance: loopImpedance, rcd_trip_current: residualTripCurrent },
  kinds: tradeFieldKinds,
  blockKeys: { id: 'circuitId', item: 'circuit' },
  sentences: {
    unknownDefinition: 'Dieses Formular kennt diese Fassung von OpenGewerk nicht.',
    freeBlockWithItem: (label) => `${label}: ein freier Block gehört zu keinem Stromkreis.`,
  },
})
