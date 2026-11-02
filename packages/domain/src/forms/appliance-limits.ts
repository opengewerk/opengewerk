import type { LimitCalculator } from '@opengewerk/platform-domain'

import { type ApplianceFacts, isApplianceFacts } from '../model/appliance.js'

/**
 * The two limits of the test of an appliance after DGUV Vorschrift 3 (#303) that
 * depend on the appliance, worked out of the rules of the trade package and what
 * the protocol hangs on: the protection class, and for the protective
 * conductor the length of the lead. The limits themselves are values with a
 * source in the package, as every other limit; here is only which of them
 * applies, and how the lead adds to it (DGUV Information 203-070, table 1).
 */

const insulationRule: Readonly<Record<ApplianceFacts['protectionClass'], string>> = {
  I: 'elektro.appliance.insulation_class_one',
  II: 'elektro.appliance.insulation_class_two',
  III: 'elektro.appliance.insulation_class_three',
}

function applianceOf(item: unknown): ApplianceFacts | null {
  return isApplianceFacts(item) ? item : null
}

/**
 * The least insulation resistance, by the protection class of the appliance.
 * A rule in kiloohms is a thousandth of a megaohm, the unit of the field, so
 * the value is the limit in thousandths as it stands.
 */
export const applianceInsulation: LimitCalculator = (_field, { rules, on, item }) => {
  const appliance = applianceOf(item)
  const rule = appliance ? rules.at(insulationRule[appliance.protectionClass], on) : null

  if (!appliance || !rule) {
    return { none: 'Ohne Schutzklasse des Geräts gibt es keinen Grenzwert.' }
  }

  return { limitMilli: rule.value, atLeast: true, source: rule.source }
}

/**
 * The largest protective conductor resistance of an appliance of class I: the
 * base value for a lead up to its length, a step for every further length or
 * part of one, and never more than the maximum. An appliance without a length
 * entered is held to the base value, which is never looser than the rule. A
 * appliance of class II or III has no protective conductor.
 */
export const applianceProtectiveConductor: LimitCalculator = (_field, { rules, on, item }) => {
  const appliance = applianceOf(item)

  if (!appliance) {
    return { none: 'Ohne Schutzklasse des Geräts gibt es keinen Grenzwert.' }
  }

  if (appliance.protectionClass !== 'I') {
    return { none: 'Ein Gerät dieser Schutzklasse hat keinen Schutzleiter.' }
  }

  const base = rules.at('elektro.appliance.protective_conductor_base', on)
  const baseLength = rules.at('elektro.appliance.protective_conductor_base_length', on)
  const step = rules.at('elektro.appliance.protective_conductor_step', on)
  const stepLength = rules.at('elektro.appliance.protective_conductor_step_length', on)
  const maximum = rules.at('elektro.appliance.protective_conductor_maximum', on)

  if (!base || !baseLength || !step || !stepLength || !maximum || stepLength.value <= 0) {
    return { none: 'Für diesen Tag ist kein Grenzwert des Schutzleiterwiderstands hinterlegt.' }
  }

  const beyond = Math.max(0, (appliance.cordLengthMilli ?? 0) - baseLength.value)
  const steps = Math.ceil(beyond / stepLength.value)

  // Milliohms are thousandths of an ohm, the unit of the field.
  return {
    limitMilli: Math.min(base.value + steps * step.value, maximum.value),
    atLeast: false,
    source: base.source,
  }
}
