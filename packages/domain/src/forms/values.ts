import { signaturePathIsValid, signerNameProblem } from '../model/document-signature.js'
import { tripCharacteristics } from '../model/electrical.js'
import type {
  BlockField,
  FormDefinition,
  FormField,
  GroupField,
  SignatureField,
} from './definition.js'
import { fieldsOf } from './definition.js'
import type { CircuitFacts } from './limits.js'

/** A signature given in a form: the path drawn, the name typed beside it, the moment. */
export interface SignatureValue {
  readonly name: string
  readonly path: string
  readonly signedAt: string
}

/**
 * The value of one field as a filled form holds it. Numbers and measured
 * values are whole thousandths of their unit, like every figure in this
 * system: 0,85 Ω is 850. A photo is the id of a file of what the form hangs
 * on. Nothing filled in is the key left out, not an empty value.
 */
export type FieldValue = string | number | boolean | SignatureValue

/**
 * The circuit a block is about, as it stood when the block was filled: how it
 * is named on paper, and what its limits are worked out from. Kept in the
 * block, so that a signed protocol shows the circuit and the verdict it was
 * signed with even after the chart has changed.
 */
export interface BlockCircuit extends CircuitFacts {
  readonly designation: string
  readonly consumer: string | null
}

/** One block of a repeating group: its own values, and the circuit it is about. */
export interface GroupBlock {
  /** The circuit of a group that repeats per circuit, null for a free one. */
  readonly circuitId: string | null
  readonly circuit: BlockCircuit | null
  readonly values: Readonly<Record<string, FieldValue>>
}

export type FormValue = FieldValue | readonly GroupBlock[]

/** A filled form: its values by key. */
export type FormValues = Readonly<Record<string, FormValue>>

/** Long enough for a list of defects, short enough for one transmission. */
export const longestFormText = 4000

/**
 * The longest the values of one form may be as text. Far above any protocol
 * a trade fills in, a hundred circuits with a remark on every one included,
 * and still a size one transmission carries twice, as `from` and `to`.
 */
export const longestFormValues = 1_000_000

/**
 * The values of a filled form as the record carries them: JSON text. The
 * sync carries plain values and compares a field by what a device saw in it,
 * so the text a device wrote is the text it gets back, character for
 * character.
 */
export function formValuesText(values: FormValues): string {
  return JSON.stringify(values)
}

/**
 * The values of a filled form read from the text the record carries, or null
 * when it is not the text of an object. Whether the values fit their
 * definition is `valuesProblem`, asked after this.
 */
export function readFormValues(text: unknown): FormValues | null {
  if (typeof text !== 'string') {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as FormValues)
    : null
}

function isSignature(value: unknown): value is SignatureValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SignatureValue).name === 'string' &&
    typeof (value as SignatureValue).path === 'string' &&
    typeof (value as SignatureValue).signedAt === 'string'
  )
}

/**
 * What is wrong with one value of one field, or null. The shape and nothing
 * else: whether a measured value is within its limit is a verdict to show and
 * never a reason to refuse it (#79), since what was measured is what goes on
 * paper.
 */
export function valueProblem(field: BlockField | SignatureField, value: unknown): string | null {
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' && value.length <= longestFormText
        ? null
        : `${field.label}: ein Text mit höchstens ${String(longestFormText)} Zeichen.`
    case 'number':
    case 'measurement':
      return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 1e15
        ? null
        : `${field.label}: eine Zahl.`
    case 'choice':
      return field.options.some((option) => option.value === value)
        ? null
        : `${field.label}: eine der angebotenen Möglichkeiten.`
    case 'yes_no':
      return typeof value === 'boolean' ? null : `${field.label}: ja oder nein.`
    case 'photo':
      return typeof value === 'string' && value.length > 0 && value.length <= 64
        ? null
        : `${field.label}: ein Foto aus den Dateien.`
    case 'signature': {
      if (!isSignature(value)) {
        return `${field.label}: eine Unterschrift mit Namen.`
      }

      return (
        signerNameProblem(value.name) ??
        (signaturePathIsValid(value.path)
          ? null
          : `${field.label}: die Unterschrift ist kein Pfad.`)
      )
    }
  }
}

/** Whether a value is a circuit as a block keeps it. */
function isBlockCircuit(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const circuit = value as Record<string, unknown>
  const count = (entry: unknown) =>
    entry === null || (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0)

  return (
    typeof circuit['designation'] === 'string' &&
    circuit['designation'].length <= 200 &&
    (circuit['consumer'] === null ||
      (typeof circuit['consumer'] === 'string' && circuit['consumer'].length <= 200)) &&
    (circuit['tripCharacteristic'] === null ||
      tripCharacteristics.some((entry) => entry === circuit['tripCharacteristic'])) &&
    count(circuit['ratedCurrentMilli']) &&
    count(circuit['ratedResidualCurrentMilli'])
  )
}

function groupProblem(field: GroupField, value: unknown): string | null {
  if (!Array.isArray(value)) {
    return `${field.label}: eine Liste von Blöcken.`
  }

  for (const block of value as unknown[]) {
    if (typeof block !== 'object' || block === null) {
      return `${field.label}: ein Block ist kein Block.`
    }

    const { circuitId, circuit, values } = block as {
      circuitId?: unknown
      circuit?: unknown
      values?: unknown
    }

    if (
      field.repeat === 'circuits'
        ? typeof circuitId !== 'string' || !isBlockCircuit(circuit)
        : circuitId !== null || circuit !== null
    ) {
      return field.repeat === 'circuits'
        ? `${field.label}: jeder Block gehört zu einem Stromkreis.`
        : `${field.label}: ein freier Block gehört zu keinem Stromkreis.`
    }

    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      return `${field.label}: ein Block ohne Werte.`
    }

    for (const [key, entry] of Object.entries(values)) {
      const nested = field.fields.find((candidate) => candidate.key === key)

      if (!nested) {
        return `${field.label}: das Feld ${key} gibt es in diesem Block nicht.`
      }

      const problem = valueProblem(nested, entry)

      if (problem !== null) {
        return problem
      }
    }
  }

  if (field.repeat === 'circuits') {
    const circuits = (value as GroupBlock[]).map((block) => block.circuitId)

    if (new Set(circuits).size !== circuits.length) {
      return `${field.label}: ein Stromkreis hat zwei Blöcke.`
    }
  }

  return null
}

/**
 * What is wrong with the values of a filled form, as the first sentence, or
 * null. Asked by the form before a change is queued and by the server when it
 * lands: a key the definition does not know, or a value of the wrong kind, is
 * a mistake of the client and not a conflict.
 */
export function valuesProblem(definition: FormDefinition, values: unknown): string | null {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return 'Die Werte eines Formulars sind eine Zuordnung von Feldern zu Werten.'
  }

  const fields = fieldsOf(definition)

  for (const [key, value] of Object.entries(values)) {
    const field = fields.find((candidate) => candidate.key === key)

    if (!field) {
      return `Das Feld ${key} gibt es in ${definition.title} nicht.`
    }

    const problem = field.kind === 'group' ? groupProblem(field, value) : valueProblem(field, value)

    if (problem !== null) {
      return problem
    }
  }

  return null
}

/** Whether a field holds something, for a group whether it has any block. */
function filled(field: FormField, value: FormValue | undefined): boolean {
  if (value === undefined) {
    return false
  }

  return field.kind === 'group' ? Array.isArray(value) && value.length > 0 : true
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
  { seal = true }: { readonly seal?: boolean } = {},
): readonly string[] {
  const missing: string[] = []

  for (const field of fieldsOf(definition)) {
    const value = values[field.key]

    if (field.required && !filled(field, value)) {
      missing.push(`${field.label} fehlt.`)
    }

    if (seal && field.kind === 'signature' && field.seals && value === undefined) {
      missing.push(`${field.label} fehlt.`)
    }

    if (field.kind === 'group' && Array.isArray(value)) {
      for (const [index, block] of (value as readonly GroupBlock[]).entries()) {
        for (const nested of field.fields) {
          if (nested.required && block.values[nested.key] === undefined) {
            missing.push(`${field.label}, Block ${String(index + 1)}: ${nested.label} fehlt.`)
          }
        }
      }
    }
  }

  return missing
}

/** The sealing signature of a definition, if it has one. */
export function sealingField(definition: FormDefinition): SignatureField | null {
  const found = fieldsOf(definition).find(
    (field): field is SignatureField => field.kind === 'signature' && field.seals === true,
  )

  return found ?? null
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
  const byCircuit = new Map(blocks.map((block) => [block.circuitId, block]))
  const current = circuits.map(({ id, ...circuit }) => ({
    circuitId: id,
    circuit,
    values: byCircuit.get(id)?.values ?? {},
  }))
  const gone = blocks.filter(
    (block) =>
      block.circuitId === null || !circuits.some((circuit) => circuit.id === block.circuitId),
  )

  return [...current, ...gone]
}

/**
 * The values a new form starts from when the last one is taken as its
 * template (#79): the fields the definition marks with `carry`, what
 * describes the installation and the way it is tested. What the last test
 * found, measured and signed is not taken over, because the next test comes
 * to its own. The blocks stay with their circuits and keep only what carries.
 */
export function templateValues(definition: FormDefinition, values: FormValues): FormValues {
  const kept: Record<string, FormValue> = {}
  const carries = (field: FormField | BlockField) =>
    field.carry === true && field.kind !== 'measurement' && field.kind !== 'signature'

  for (const field of fieldsOf(definition)) {
    const value = values[field.key]

    if (value === undefined) {
      continue
    }

    if (field.kind === 'group') {
      if (Array.isArray(value)) {
        kept[field.key] = (value as readonly GroupBlock[]).map((block) => ({
          circuitId: block.circuitId,
          circuit: block.circuit,
          values: Object.fromEntries(
            Object.entries(block.values).filter(([key]) =>
              field.fields.some((nested) => nested.key === key && carries(nested)),
            ),
          ),
        }))
      }

      continue
    }

    if (carries(field)) {
      kept[field.key] = value
    }
  }

  return kept
}
