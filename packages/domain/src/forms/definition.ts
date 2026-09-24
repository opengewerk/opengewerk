/**
 * The forms of section 1.3 (#78): test protocols, handover protocols and
 * checklists described as data and not written as screens.
 *
 * A definition is a JSON file in a trade package (`packages/gewerke/<name>/
 * formulare/`) and reaches the engine as a value: the community sends a form
 * as a pull request, not as code. The engine is built only as far as the one
 * protocol of phase 1 needs it, the initial verification after DIN VDE
 * 0100-600 (#79); a field kind nobody uses would be general in the wrong
 * places.
 *
 * A definition has a version, and a filled form names the version it was
 * filled in. Changing a definition means a new file with the next version;
 * the old one stays, and a protocol of two years ago is read with the fields
 * it was written with.
 */

/** What a measured value is counted in. Stored as whole thousandths of it. */
export const measurementUnits = ['ohm', 'megaohm', 'milliampere', 'millisecond', 'volt'] as const

export type MeasurementUnit = (typeof measurementUnits)[number]

/** The sign a unit is written with, on screen and on paper. */
export const measurementUnitSign: Readonly<Record<MeasurementUnit, string>> = {
  ohm: 'Ω',
  megaohm: 'MΩ',
  milliampere: 'mA',
  millisecond: 'ms',
  volt: 'V',
}

/**
 * How a measured value is judged, and where the limit comes from.
 *
 * A fixed limit names the rule it is taken from, never a number: a limit is a
 * value with a source and belongs in a rule package, for the same reason as a
 * tax rate (section 1.7). Two limits depend on the circuit the value was
 * measured on and are worked out from it: the loop impedance from the
 * protective device, the tripping current from the residual current device.
 */
export type LimitSpec =
  | { readonly kind: 'at_least'; readonly rule: string }
  | { readonly kind: 'at_most'; readonly rule: string }
  | { readonly kind: 'loop_impedance' }
  | { readonly kind: 'rcd_trip_current' }

interface FieldBase {
  /** How the value is found in the filled form. Latin letters, digits and underscores. */
  readonly key: string
  readonly label: string
  /** Said under the field, in plain words. */
  readonly hint?: string
  /** Has to be filled before the form can be signed. */
  readonly required?: boolean
  /**
   * Taken over from the last form when it is the template of the next one
   * (#79): what describes the installation and the way it is tested, the
   * tester, the instrument, the earthing system. What the test found is not,
   * so a field without this starts empty; a measured value and a signature
   * never carry.
   */
  readonly carry?: boolean
}

export interface TextField extends FieldBase {
  readonly kind: 'text'
  /** More than a line: a list of defects, a remark. */
  readonly multiline?: boolean
}

/** A number with a unit, not judged against anything: a nominal voltage. */
export interface NumberField extends FieldBase {
  readonly kind: 'number'
  readonly unit: MeasurementUnit
  /** Places after the comma on screen and on paper. */
  readonly decimals: number
}

/** A measured value, judged against a limit where the definition names one. */
export interface MeasurementField extends FieldBase {
  readonly kind: 'measurement'
  readonly unit: MeasurementUnit
  readonly decimals: number
  readonly limit?: LimitSpec
}

export interface ChoiceField extends FieldBase {
  readonly kind: 'choice'
  readonly options: readonly { readonly value: string; readonly label: string }[]
}

export interface YesNoField extends FieldBase {
  readonly kind: 'yes_no'
}

/** A photo out of the files of what the form hangs on (#77). */
export interface PhotoField extends FieldBase {
  readonly kind: 'photo'
}

/**
 * A signature drawn on the device, with the name typed beside it. One that
 * `seals` the form fixes it: once it is given, nothing in the form changes.
 */
export interface SignatureField extends FieldBase {
  readonly kind: 'signature'
  readonly seals?: boolean
}

/**
 * The repeating group, the part a protocol cannot do without: as many blocks
 * as there is something to measure. `circuits` makes one block for each
 * circuit of the installation, taken from its circuit chart (#70) and not
 * typed again; `free` lets somebody add as many as they need.
 */
export interface GroupField extends FieldBase {
  readonly kind: 'group'
  readonly repeat: 'circuits' | 'free'
  readonly fields: readonly BlockField[]
}

export type BlockField =
  TextField | NumberField | MeasurementField | ChoiceField | YesNoField | PhotoField

export type FormField = BlockField | SignatureField | GroupField

export type FormFieldKind = FormField['kind']

export interface FormSection {
  readonly key: string
  readonly title: string
  /** Said under the title: which part of the standard the section is. */
  readonly hint?: string
  readonly fields: readonly FormField[]
}

export interface FormDefinition {
  /** Stable across versions: `vde-0100-600`. */
  readonly key: string
  /** Counts up with every change; a filled form keeps the one it was filled in. */
  readonly version: number
  readonly title: string
  /** What a filled form hangs on. An installation, for a test protocol. */
  readonly attachesTo: 'installation'
  readonly sections: readonly FormSection[]
}

const keyShape = /^[a-z][a-z0-9_]*$/

/** Every field of a definition with the section it is in, groups included but not their fields. */
export function fieldsOf(definition: FormDefinition): readonly FormField[] {
  return definition.sections.flatMap((section) => section.fields)
}

/**
 * What is wrong with a definition, as sentences, or nothing.
 *
 * Asked of every definition a package ships, in its tests: a key twice, a
 * choice without options or a group inside a group would otherwise show up
 * as a form that cannot be filled in, on a site without a network.
 */
export function definitionProblems(definition: FormDefinition): readonly string[] {
  const problems: string[] = []

  if (!/^[a-z][a-z0-9-]*$/.test(definition.key)) {
    problems.push(`Der Schlüssel ${definition.key} hat die falsche Form.`)
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    problems.push(`${definition.key}: die Fassung ist eine ganze Zahl ab eins.`)
  }

  const seen = new Set<string>()

  const check = (field: FormField | BlockField, inGroup: boolean) => {
    if (!keyShape.test(field.key)) {
      problems.push(
        `${definition.key}: das Feld ${field.key} hat einen Schlüssel der falschen Form.`,
      )
    }

    if (field.label.trim() === '') {
      problems.push(`${definition.key}: das Feld ${field.key} hat keine Beschriftung.`)
    }

    if (field.carry === true && (field.kind === 'measurement' || field.kind === 'signature')) {
      problems.push(
        `${definition.key}: ${field.key} wird nicht übernommen, ein Messwert und eine Unterschrift gehören zu der Prüfung, in der sie entstanden sind.`,
      )
    }

    if (field.kind === 'choice' && field.options.length < 2) {
      problems.push(
        `${definition.key}: die Auswahl ${field.key} hat weniger als zwei Möglichkeiten.`,
      )
    }

    if (
      (field.kind === 'number' || field.kind === 'measurement') &&
      (!Number.isInteger(field.decimals) || field.decimals < 0 || field.decimals > 3)
    ) {
      problems.push(`${definition.key}: ${field.key} zeigt null bis drei Nachkommastellen.`)
    }

    if (field.kind === 'group') {
      if (inGroup) {
        problems.push(`${definition.key}: die Gruppe ${field.key} steht in einer Gruppe.`)
      }

      const inside = new Set<string>()

      for (const nested of field.fields) {
        if (inside.has(nested.key)) {
          problems.push(`${definition.key}: ${nested.key} steht in ${field.key} zweimal.`)
        }

        inside.add(nested.key)
        check(nested, true)
      }
    }
  }

  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (seen.has(field.key)) {
        problems.push(`${definition.key}: das Feld ${field.key} steht zweimal im Formular.`)
      }

      seen.add(field.key)
      check(field, false)
    }
  }

  return problems
}

/** The definitions a version of OpenGewerk knows, by key and version. */
export interface FormRegistry {
  readonly definitionFor: (key: string, version: number) => FormDefinition | null
  /** The newest version of each form: what a new form is filled in. */
  readonly current: () => readonly FormDefinition[]
}

/**
 * All the definitions the trade packages bring, in one place. Server and
 * device build the same one out of the same packages, so a form filled on a
 * device is read on the server with the definition it was filled in.
 */
export function formRegistry(definitions: readonly FormDefinition[]): FormRegistry {
  return {
    definitionFor: (key, version) =>
      definitions.find((entry) => entry.key === key && entry.version === version) ?? null,
    current: () =>
      [...new Set(definitions.map((entry) => entry.key))].flatMap((key) => {
        const newest = definitions
          .filter((entry) => entry.key === key)
          .sort((left, right) => right.version - left.version)[0]

        return newest ? [newest] : []
      }),
  }
}
