import type {
  BlockField as GeneralBlockField,
  FormDefinition as GeneralFormDefinition,
  FormField as GeneralFormField,
  FormRegistry as GeneralFormRegistry,
  FormSection as GeneralFormSection,
  GroupField as GeneralGroupField,
  LimitSpec as GeneralLimitSpec,
  MeasurementField as GeneralMeasurementField,
  NumberField as GeneralNumberField,
} from '@opengewerk/platform-domain'

import { type tradeFieldKinds, tradeForms } from './engine.js'
import type { MeasurementUnit } from './units.js'

/**
 * The forms of section 1.3 (#78): test protocols, handover protocols and
 * checklists described as data and not written as screens.
 *
 * A definition is a JSON file in a trade package (`packages/gewerke/<name>/
 * formulare/`) and reaches the engine as a value: the community sends a form
 * as a pull request, not as code. The engine itself is the foundation's
 * since opengewerk-haustechnik#28 (ADR 0010); what is here is what this
 * application tells it, and the names its forms are written with.
 *
 * A definition has a version, and a filled form names the version it was
 * filled in. Changing a definition means a new file with the next version;
 * the old one stays, and a protocol of two years ago is read with the fields
 * it was written with.
 */

export { measurementUnits, measurementUnitSign, type MeasurementUnit } from './units.js'

export {
  type ChoiceField,
  fieldsOf,
  type FormFieldKind,
  formRegistry,
  type PhotoField,
  type SignatureField,
  type TextField,
  type YesNoField,
} from '@opengewerk/platform-domain'

/**
 * What the forms of this application name: its units, the circuits a group
 * repeats over, the two limits worked out of a circuit, the loop impedance
 * from its protective device and the tripping current from its residual
 * current device, and the kinds of field it shows.
 */
export interface TradeFormTerms {
  readonly unit: MeasurementUnit
  readonly list: 'circuits'
  readonly limit: 'loop_impedance' | 'rcd_trip_current'
  readonly kind: (typeof tradeFieldKinds)[number]
}

export type LimitSpec = GeneralLimitSpec<TradeFormTerms>
export type NumberField = GeneralNumberField<TradeFormTerms>
export type MeasurementField = GeneralMeasurementField<TradeFormTerms>
export type GroupField = GeneralGroupField<TradeFormTerms>
export type BlockField = GeneralBlockField<TradeFormTerms>
export type FormField = GeneralFormField<TradeFormTerms>
export type FormSection = GeneralFormSection<TradeFormTerms>

export interface FormDefinition extends GeneralFormDefinition<TradeFormTerms> {
  /**
   * What a filled form hangs on: an installation, for a test protocol; a
   * document, for the fields a business gives its report.
   */
  readonly attachesTo: 'installation' | 'document'
}

/** The definitions a version of OpenGewerk knows, by key and version. */
export type FormRegistry = GeneralFormRegistry<FormDefinition>

/**
 * What is wrong with a definition, as sentences, or nothing.
 *
 * Asked of every definition a package ships, in its tests: a key twice, a
 * choice without options or a group inside a group would otherwise show up
 * as a form that cannot be filled in, on a site without a network.
 */
export function definitionProblems(definition: FormDefinition): readonly string[] {
  return tradeForms.definitionProblems(definition)
}
