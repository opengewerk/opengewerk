/**
 * Forms described as data and not written as screens (ADR 0010): protocols,
 * checklists, the fields a record carries beside its own. A definition is a
 * value an application hands in, out of a package of its own as a rule, and
 * the engine knows nothing of what a form is about. What a figure is counted
 * in, which lists a group repeats over and which limits are worked out rather
 * than taken from a rule are the application's to say (`formEngine`); so is
 * what a filled form hangs on.
 *
 * A definition has a version, and a filled form names the version it was
 * filled in. Changing a definition means a new version; the old one stays,
 * and a form of two years ago is read with the fields it was written with.
 */

/**
 * What an application names in its forms, as types: the units its figures
 * are counted in, the lists a group of its forms repeats over, and the limits
 * it works out itself. An application that names them exactly gets its
 * definitions typed exactly; left open, any string is one.
 */
export interface FormTerms {
  readonly unit: string
  readonly list: string
  readonly limit: string
}

/**
 * A limit taken from a rule, never a number: a limit is a value with a
 * source and belongs in a rule package, for the same reason as a rate.
 */
export interface RuleLimit {
  readonly kind: 'at_least' | 'at_most'
  readonly rule: string
}

/**
 * A limit the application works out, from what the block a value is measured
 * in is about (`limits` of the engine).
 */
export interface WorkedOutLimit<Kind extends string = string> {
  readonly kind: Kind
}

/** How a measured value is judged, and where the limit comes from. */
export type LimitSpec<T extends FormTerms = FormTerms> = RuleLimit | WorkedOutLimit<T['limit']>

/** Whether a limit is taken from a rule rather than worked out. */
export function isRuleLimit(limit: LimitSpec): limit is RuleLimit {
  return (limit.kind === 'at_least' || limit.kind === 'at_most') && 'rule' in limit
}

interface FieldBase {
  /** How the value is found in the filled form. Latin letters, digits and underscores. */
  readonly key: string
  readonly label: string
  /** Said under the field, in plain words. */
  readonly hint?: string
  /** Has to be filled before the form can be signed. */
  readonly required?: boolean
  /**
   * Taken over from the last form when it is the template of the next one:
   * what describes the subject and the way it is checked. What the last one
   * found is not, so a field without this starts empty; a measured value and
   * a signature never carry.
   */
  readonly carry?: boolean
}

export interface TextField extends FieldBase {
  readonly kind: 'text'
  /** More than a line: a list of findings, a remark. */
  readonly multiline?: boolean
}

/** A number with a unit, not judged against anything. */
export interface NumberField<T extends FormTerms = FormTerms> extends FieldBase {
  readonly kind: 'number'
  readonly unit: T['unit']
  /** Places after the comma on screen and on paper. */
  readonly decimals: number
}

/** A measured value, judged against a limit where the definition names one. */
export interface MeasurementField<T extends FormTerms = FormTerms> extends FieldBase {
  readonly kind: 'measurement'
  readonly unit: T['unit']
  readonly decimals: number
  readonly limit?: LimitSpec<T>
}

export interface ChoiceField extends FieldBase {
  readonly kind: 'choice'
  readonly options: readonly { readonly value: string; readonly label: string }[]
}

export interface YesNoField extends FieldBase {
  readonly kind: 'yes_no'
}

/** A photo out of the files of what the form hangs on, which the application keeps. */
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
 * The repeating group: as many blocks as there is something to check. `free`
 * lets somebody add as many as they need; any other value names a list the
 * application hands in, and the form gets one block for each of its items,
 * which a block keeps as it stood when it was filled.
 */
export interface GroupField<T extends FormTerms = FormTerms> extends FieldBase {
  readonly kind: 'group'
  readonly repeat: 'free' | T['list']
  readonly fields: readonly BlockField<T>[]
}

export type BlockField<T extends FormTerms = FormTerms> =
  TextField | NumberField<T> | MeasurementField<T> | ChoiceField | YesNoField | PhotoField

export type FormField<T extends FormTerms = FormTerms> =
  BlockField<T> | SignatureField | GroupField<T>

export type FormFieldKind = FormField['kind']

/** The kinds of field the engine knows, in the order they are described above. */
export const formFieldKinds: readonly FormFieldKind[] = [
  'text',
  'number',
  'measurement',
  'choice',
  'yes_no',
  'photo',
  'signature',
  'group',
]

export interface FormSection<T extends FormTerms = FormTerms> {
  readonly key: string
  readonly title: string
  /** Said under the title: which part of the rules the section is. */
  readonly hint?: string
  readonly fields: readonly FormField<T>[]
}

/**
 * A form as its definition says it. What the form hangs on, and anything
 * else an application keeps beside it, may stand in the same object: the
 * engine reads what it knows and leaves the rest alone, so a stored
 * definition stays readable as it was written.
 */
export interface FormDefinition<T extends FormTerms = FormTerms> {
  /** Stable across versions. */
  readonly key: string
  /** Counts up with every change; a filled form keeps the one it was filled in. */
  readonly version: number
  readonly title: string
  readonly sections: readonly FormSection<T>[]
}

/** Every field of a definition, groups included but not their fields. */
export function fieldsOf<T extends FormTerms>(
  definition: FormDefinition<T>,
): readonly FormField<T>[] {
  return definition.sections.flatMap((section) => section.fields)
}

/** The definitions a build knows, by key and version. */
export interface FormRegistry<D extends FormDefinition = FormDefinition> {
  readonly definitionFor: (key: string, version: number) => D | null
  /** The newest version of each form: what a new form is filled in. */
  readonly current: () => readonly D[]
}

/**
 * All the definitions the packages of an application bring, in one place.
 * Server and device build the same one out of the same packages, so a form
 * filled on a device is read on the server with the definition it was filled
 * in.
 */
export function formRegistry<D extends FormDefinition>(definitions: readonly D[]): FormRegistry<D> {
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
