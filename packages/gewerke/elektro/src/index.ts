import {
  type FormDefinition,
  formRegistry,
  type FormRegistry,
  type RulePackage,
  ruleSet,
  type RuleSet,
} from '@opengewerk/domain'

import manifest from '../manifest.json' with { type: 'json' }
import vde0100600 from '../formulare/vde-0100-600.v1.json' with { type: 'json' }
import vde0100600Limits from '../regeln/vde-0100-600.json' with { type: 'json' }

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
}

export const elektroManifest: TradeManifest = manifest

/** Every version of every form the package has shipped, the oldest kept for the forms filled in it. */
export const elektroForms: readonly FormDefinition[] = [vde0100600 as FormDefinition]

export const elektroRulePackages: readonly RulePackage[] = [vde0100600Limits as RulePackage]

/** The limits of the package as a rule set, the one `limitVerdict` is asked with. */
export const elektroRules: RuleSet = ruleSet(elektroRulePackages.flatMap((entry) => entry.records))

export const elektroRegistry: FormRegistry = formRegistry(elektroForms)
