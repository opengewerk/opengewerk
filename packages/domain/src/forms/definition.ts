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

import { type InstallationKind, installationKinds } from '../model/installation.js'
import { type tradeFieldKinds, tradeForms } from './engine.js'
import {
  type StructureFigure,
  structureFigureFields,
  structureFigures,
} from './structure-values.js'
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
  type DateField,
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
 * current appliance, the two worked out of an appliance (#303), its insulation by
 * the protection class and its protective conductor by the lead, and the
 * kinds of field it shows.
 */
export interface TradeFormTerms {
  readonly unit: MeasurementUnit
  readonly list: 'circuits' | 'pv_strings'
  readonly limit:
    | 'loop_impedance'
    | 'rcd_trip_current'
    | 'appliance_insulation'
    | 'appliance_protective_conductor'
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
   * appliance of the register, for its test after DGUV Vorschrift 3 (#303); a
   * document, for the fields a business gives its report.
   */
  readonly attachesTo: 'installation' | 'appliance' | 'document'
  /**
   * The kinds of installation the form is for, where it is not for every one:
   * the protocol after VDE-AR-N 4105 is for a PV system and a battery (#304).
   */
  readonly installationKinds?: readonly InstallationKind[]
  /**
   * What the protocol records: a test of the installation, which the report
   * of a site names as its last test (#302), or its commissioning, which the
   * report leaves out (#304). A test where the definition says nothing.
   */
  readonly purpose?: 'test' | 'commissioning'
  /**
   * The form tests a part of the installation, always: the DC side of a PV
   * system (#305). Like a first inspection after an extension (#814), the
   * report of a site names it not as the test of the whole.
   */
  readonly partOfInstallation?: boolean
  /**
   * The fields a new form starts filled from the structure of the
   * installation, by key, with what fills each (#304, `structureValues`).
   */
  readonly fromStructure?: Readonly<Record<string, StructureFigure>>
}

/** How the screens name the day of a filled form: the day of the test, or of the commissioning (#304). */
export function dayLabel(definition: FormDefinition): string {
  return definition.purpose === 'commissioning' ? 'Tag der Inbetriebsetzung' : 'Tag der Prüfung'
}

/**
 * The forms a new protocol at an installation of this kind can be: those
 * for every installation, and those for its kind (#304).
 */
export function formsForInstallation(
  definitions: readonly FormDefinition[],
  kind: InstallationKind | null,
): readonly FormDefinition[] {
  return definitions.filter(
    (definition) =>
      definition.attachesTo === 'installation' &&
      (definition.installationKinds === undefined ||
        (kind !== null && definition.installationKinds.includes(kind))),
  )
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
  return [...tradeForms.definitionProblems(definition), ...ownProblems(definition)]
}

/** What the engine of the foundation does not know to ask: what this application adds (#304). */
function ownProblems(definition: FormDefinition): readonly string[] {
  const problems: string[] = []
  const kinds = definition.installationKinds

  if (
    kinds !== undefined &&
    (definition.attachesTo !== 'installation' ||
      kinds.length === 0 ||
      !kinds.every((kind) => (installationKinds as readonly string[]).includes(kind)))
  ) {
    problems.push(
      `${definition.key}: die Arten der Anlage stehen nur an einem Formular einer Anlage, und jede gibt es.`,
    )
  }

  if (definition.purpose !== undefined && !['test', 'commissioning'].includes(definition.purpose)) {
    problems.push(`${definition.key}: der Zweck ${String(definition.purpose)} ist unbekannt.`)
  }

  const fields = new Map(
    definition.sections.flatMap((section) => section.fields.map((field) => [field.key, field])),
  )

  for (const [key, figure] of Object.entries(definition.fromStructure ?? {})) {
    if (!(structureFigures as readonly string[]).includes(figure)) {
      problems.push(
        `${definition.key}: ${key} nimmt ${String(figure)} aus der Struktur, das gibt es nicht.`,
      )
      continue
    }

    const field = fields.get(key)
    const fits = structureFigureFields[figure]

    if (
      field === undefined ||
      field.kind !== fits.kind ||
      (fits.kind === 'number' && field.kind === 'number' && !fits.units.includes(field.unit))
    ) {
      problems.push(
        `${definition.key}: ${key} ist kein Feld, das ${figure} aus der Struktur aufnehmen kann.`,
      )
    }
  }

  return problems
}
