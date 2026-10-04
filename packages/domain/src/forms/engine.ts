import { formEngine } from '@opengewerk/platform-domain'

import { circuitList, loopImpedance, residualTripCurrent } from './circuits.js'
import type { TradeFormTerms } from './definition.js'
import { formUnits } from './units.js'

/**
 * The form engine of the foundation (ADR 0010, opengewerk-haustechnik#28),
 * bound to the forms of this application: its units, the circuits a group
 * repeats over, the two limits worked out of a circuit, and its sentences.
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
  blockKeys: { id: 'circuitId', item: 'circuit' },
  sentences: {
    unknownDefinition: 'Dieses Formular kennt diese Fassung von OpenGewerk nicht.',
    freeBlockWithItem: (label) => `${label}: ein freier Block gehört zu keinem Stromkreis.`,
  },
})
