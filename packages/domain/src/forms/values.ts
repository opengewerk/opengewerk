import {
  type FieldValue,
  readFormValues as readGeneralFormValues,
  type GroupBlock as GeneralGroupBlock,
} from '@opengewerk/platform-domain'

import type { BlockCircuit } from './circuits.js'
import type { BlockField, FormDefinition, SignatureField } from './definition.js'
import { tradeForms } from './engine.js'

export {
  type FieldValue,
  formValuesText,
  longestFormText,
  longestFormValues,
  type SignatureValue,
} from '@opengewerk/platform-domain'

export type { BlockCircuit } from './circuits.js'

/**
 * One block of a repeating group: its own values, and the circuit it is about.
 * The keys are the ones every protocol has been written with (#79), and the
 * engine is told them (`tradeForms`).
 */
export interface GroupBlock extends GeneralGroupBlock {
  /** The circuit of a group that repeats per circuit, null for a free one. */
  readonly circuitId: string | null
  readonly circuit: BlockCircuit | null
  readonly values: Readonly<Record<string, FieldValue>>
}

export type FormValue = FieldValue | readonly GroupBlock[]

/** A filled form: its values by key. */
export type FormValues = Readonly<Record<string, FormValue>>

/**
 * The values of a filled form read from the text the record carries, or null
 * when it is not the text of an object. Whether the values fit their
 * definition is `valuesProblem`, asked after this.
 */
export function readFormValues(text: unknown): FormValues | null {
  return readGeneralFormValues<FormValues>(text)
}

/**
 * What is wrong with one value of one field, or null. The shape and nothing
 * else: whether a measured value is within its limit is a verdict to show and
 * never a reason to refuse it (#79), since what was measured is what goes on
 * paper.
 */
export function valueProblem(field: BlockField | SignatureField, value: unknown): string | null {
  return tradeForms.valueProblem(field, value)
}

/**
 * What is wrong with the values of a filled form, as the first sentence, or
 * null. Asked by the form before a change is queued and by the server when it
 * lands: a key the definition does not know, or a value of the wrong kind, is
 * a mistake of the client and not a conflict.
 */
export function valuesProblem(definition: FormDefinition, values: unknown): string | null {
  return tradeForms.valuesProblem(definition, values)
}

/**
 * What is missing before a form can be signed and fixed: the required fields
 * that are empty, required fields of every block included, and a signature
 * that seals it. As sentences, empty when nothing is.
 *
 * Without the seal (`seal: false`) it is the question the form asks before it
 * offers the signature at all: whether everything else is there.
 */
export function sealProblems(
  definition: FormDefinition,
  values: FormValues,
  options: { readonly seal?: boolean } = {},
): readonly string[] {
  return tradeForms.sealProblems(definition, values, options)
}

/** The sealing signature of a definition, if it has one. */
export function sealingField(definition: FormDefinition): SignatureField | null {
  return tradeForms.sealingField(definition)
}

/**
 * The blocks of a group that repeats per circuit, laid over the circuits of
 * the installation as they are now: one block for each circuit, in the order
 * of the chart, with what was filled in already and the circuit as it stands;
 * a block of a circuit that is gone stays at the end, because what was
 * measured on it was measured.
 */
export function circuitBlocks(
  blocks: readonly GroupBlock[],
  circuits: readonly (BlockCircuit & { readonly id: string })[],
): readonly GroupBlock[] {
  return tradeForms.listBlocks(
    blocks,
    circuits.map(({ id, ...circuit }) => ({ id, item: circuit })),
  ) as readonly GroupBlock[]
}

/**
 * The values a new form starts from when the last one is taken as its
 * template (#79): the fields the definition marks with `carry`, what
 * describes the installation and the way it is tested. What the last test
 * found, measured and signed is not taken over, because the next test comes
 * to its own. The blocks stay with their circuits and keep only what carries.
 */
export function templateValues(definition: FormDefinition, values: FormValues): FormValues {
  return tradeForms.templateValues(definition, values) as FormValues
}
