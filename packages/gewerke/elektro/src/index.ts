import {
  type DeadlineKind,
  type FormDefinition,
  formRegistry,
  type FormRegistry,
  type RulePackage,
  ruleSet,
  type RuleSet,
} from '@opengewerk/domain'

import manifest from '../manifest.json' with { type: 'json' }
import vde0100600v1 from '../formulare/vde-0100-600.v1.json' with { type: 'json' }
import vde0100600v2 from '../formulare/vde-0100-600.v2.json' with { type: 'json' }
import vde0100600v3 from '../formulare/vde-0100-600.v3.json' with { type: 'json' }
import vde0105100v1 from '../formulare/vde-0105-100.v1.json' with { type: 'json' }
import dguvV3v1 from '../formulare/dguv-v3.v1.json' with { type: 'json' }
import vde0105100Deadlines from '../fristen/vde-0105-100.json' with { type: 'json' }
import dguvV3Deadlines from '../fristen/dguv-v3.json' with { type: 'json' }
import vde0100600Limits from '../regeln/vde-0100-600.json' with { type: 'json' }
import vde0105100Limits from '../regeln/vde-0105-100.json' with { type: 'json' }
import dguvV3Limits from '../regeln/dguv-v3.json' with { type: 'json' }

/**
 * The trade package Elektro und PV in the format of ADR 0008: a manifest, the
 * form definitions under `formulare/` and the limits under `regeln/`, all of
 * it data a contributor can read and change without touching code.
 *
 * Built into the server and into the interface rather than read from disk at
 * the start (Nachtrag of 24.09.2026 in ADR 0008): a device without a network
 * fills in the protocol with the same definition the server reads it with.
 * The installation structure it measures on stays in the core; this package
 * only brings what a form needs.
 */

export interface TradeManifest {
  readonly name: string
  readonly title: string
  readonly version: string
  /** The oldest version of OpenGewerk the package works with. */
  readonly minimumCore: string
  readonly forms: readonly string[]
  readonly rules: readonly string[]
  readonly deadlines: readonly string[]
}

export const elektroManifest: TradeManifest = manifest

/**
 * Every version of every form the package has shipped, the oldest kept for the
 * forms filled in it. Version 2 of the protocol differs from version 1 in one
 * thing: the remark on a circuit takes more than a line (#256); version 3 names
 * the interval to the first recurring inspection of a new installation
 * (#814). The recurring inspection after DIN VDE 0105-100 is the second form
 * (#301), the test of a appliance after DGUV Vorschrift 3 the third, the first
 * that hangs on an appliance of the register and not on an installation (#303).
 */
export const elektroForms: readonly FormDefinition[] = [
  vde0100600v1 as FormDefinition,
  vde0100600v2 as FormDefinition,
  vde0100600v3 as FormDefinition,
  vde0105100v1 as FormDefinition,
  dguvV3v1 as FormDefinition,
]

export const elektroRulePackages: readonly RulePackage[] = [
  vde0100600Limits as RulePackage,
  vde0105100Limits as RulePackage,
  dguvV3Limits as RulePackage,
]

/**
 * The kinds of deadline the package brings (`fristen/`, ADR 0008): the
 * recurring inspection, due when the last protocol after DIN VDE 0105-100 of
 * an installation says, and the test of an appliance, due when its last protocol
 * after DGUV Vorschrift 3 says (#303). The server puts them beside the core's.
 */
export const elektroDeadlineKinds: readonly DeadlineKind[] = [
  ...(vde0105100Deadlines.kinds as readonly DeadlineKind[]),
  ...(dguvV3Deadlines.kinds as readonly DeadlineKind[]),
]

/** The limits of the package as a rule set, the one `limitVerdict` is asked with. */
export const elektroRules: RuleSet = ruleSet(elektroRulePackages.flatMap((entry) => entry.records))

export const elektroRegistry: FormRegistry = formRegistry(elektroForms)
