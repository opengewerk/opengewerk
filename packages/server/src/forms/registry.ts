import { formRegistry, type FormRegistry, type RuleSet } from '@opengewerk/domain'
import { elektroForms, elektroRules } from '@opengewerk/gewerk-elektro'

/**
 * The forms and limits of the trade packages this version is built with
 * (ADR 0008, Nachtrag of 24.09.2026): built in, not read from disk, and the
 * same the interface is built with, so a form filled on a device is read here
 * with the definition it was filled in. One package so far. The forms a
 * business writes itself are rows in `form_definitions`, not here.
 */
export const tradeForms: FormRegistry = formRegistry([...elektroForms])

export const tradeRules: RuleSet = elektroRules
