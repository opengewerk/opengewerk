import type { IsoDate } from '../model/identifier.js'
import { signaturePathIsValid, signerNameProblem } from '../model/signature.js'
import { RuleError, type RuleRecord, type RuleSet, type RuleUnit } from '../rules/rule.js'
import {
  type BlockField,
  type BlockFieldKind,
  type CheckPointField,
  fieldsOf,
  type FormDefinition,
  type FormField,
  formFieldKinds,
  type FormRegistry,
  type FormTerms,
  type GroupField,
  isRuleLimit,
  type MeasurementField,
  type SignatureField,
} from './definition.js'
import {
  type CheckPointValue,
  checkPointResultLabel,
  checkPointResults,
  type FieldValue,
  type FormValue,
  type FormValues,
  type GroupBlock,
  longestFormText,
  longestFormValues,
  readFormValues,
  type SignatureValue,
} from './values.js'

/** A unit a figure of an application is counted in. */
export interface FormUnit {
  /** The sign it is written with, on screen and on paper. */
  readonly sign: string
  /**
   * How many thousandths of this unit one unit of a rule is, by the unit of
   * the rule: a rule in kiloohms against a field in megaohms is one. A pair
   * that is not here is a definition that asks the wrong rule.
   */
  readonly fromRule?: Partial<Readonly<Record<RuleUnit, number>>>
}

/**
 * A list a group repeats over: whether an item, as a block keeps it, is one
 * of the list, and what is said when a block is not about one.
 */
export interface RepeatList {
  readonly itemIsValid: (item: unknown) => boolean
  readonly sentences: {
    /** A block without an item of the list, by the label of the group. */
    readonly blockWithoutItem: (label: string) => string
    /** Two blocks about the same item. */
    readonly itemTwice: (label: string) => string
  }
}

/** A limit worked out, in thousandths of the field's unit, and where it comes from. */
export interface WorkedOutValue {
  readonly limitMilli: number
  readonly atLeast: boolean
  readonly source: string
}

/**
 * Works out a limit from the rules and what the block a value is measured in
 * is about, or says in a sentence why there is none.
 */
export type LimitCalculator<T extends FormTerms = FormTerms> = (
  field: MeasurementField<T>,
  context: { readonly rules: RuleSet; readonly on: IsoDate; readonly item: unknown },
) => WorkedOutValue | { readonly none: string }

/**
 * How a measured value stands against its limit.
 *
 * `within` is null when there is nothing to judge: no value yet, no limit in
 * the definition, or one that cannot be worked out. The text says which, and
 * the source says where the limit comes from, so that whoever reads the form
 * can check it.
 */
export interface LimitVerdict {
  readonly within: boolean | null
  /** The limit in thousandths of the field's unit, null when there is none. */
  readonly limitMilli: number | null
  readonly text: string
  readonly source: string | null
}

/** Where a block keeps the item it is about, and its id. */
export interface BlockKeys {
  readonly id: string
  readonly item: string
}

/** What an application tells the engine about its forms. */
export interface FormEngineSetup<T extends FormTerms = FormTerms> {
  /** Its units, by the key a definition names them with. */
  readonly units: Readonly<Record<T['unit'], FormUnit>>
  /** The lists a group of its forms repeats over, beside `free`. */
  readonly lists: Readonly<Record<T['list'], RepeatList>>
  /** The limits it works out itself, beside those taken from a rule. */
  readonly limits: Readonly<Record<T['limit'], LimitCalculator<T>>>
  /**
   * The kinds of field its screens show, beside the signature and the group.
   * A definition with any other is refused, and so is a value for one.
   */
  readonly kinds: readonly T['kind'][]
  /**
   * The kinds of record a field of its forms may be about (`about` of a
   * field), none when left out.
   */
  readonly records?: readonly string[]
  /**
   * Where a block keeps its item and the item's id. Fixed once a form is
   * filled: a block written under these keys is read under them for ever.
   */
  readonly blockKeys?: BlockKeys
  readonly sentences?: {
    /** A form filled in a version this build does not know. */
    readonly unknownDefinition?: string
    /** A block of a free group that is about an item. */
    readonly freeBlockWithItem?: (label: string) => string
  }
}

/** A filled form as far as the engine asks it: what it was filled in, its state and its values. */
export interface FilledForm {
  readonly definitionKey: unknown
  readonly definitionVersion: unknown
  readonly status: unknown
  readonly values: unknown
}

/** The engine bound to what an application said about its forms. */
export interface FormEngine<T extends FormTerms = FormTerms> {
  /**
   * What is wrong with a definition, as sentences, or nothing. Asked of every
   * definition a package ships: a key twice, a choice without options or a
   * group inside a group would otherwise show up as a form that cannot be
   * filled in, on site without a network.
   */
  readonly definitionProblems: (definition: FormDefinition<T>) => readonly string[]
  /**
   * What is wrong with one value of one field, or null. The shape and
   * nothing else: whether a measured value is within its limit is a verdict
   * to show and never a reason to refuse it, and whether an answer has the
   * remark it needs is a question of signing, so that a form can be saved
   * between the answer and the remark.
   */
  readonly valueProblem: (field: BlockField<T> | SignatureField, value: unknown) => string | null
  /**
   * What is wrong with the values of a filled form, as the first sentence, or
   * null. Asked by the form before a change is queued and by the server when
   * it lands.
   */
  readonly valuesProblem: (definition: FormDefinition<T>, values: unknown) => string | null
  /**
   * What is missing before a form can be signed and fixed: the required
   * fields that are empty, required fields of every block included, every
   * check point without an answer or without the remark its answer needs,
   * and a signature that seals it. Without the seal it is the question the
   * form asks before it offers the signature at all.
   */
  readonly sealProblems: (
    definition: FormDefinition<T>,
    values: FormValues,
    options?: { readonly seal?: boolean },
  ) => readonly string[]
  /** The sealing signature of a definition, if it has one. */
  readonly sealingField: (definition: FormDefinition<T>) => SignatureField | null
  /**
   * The blocks of a group over a list, laid over the items as they are now:
   * one block for each item, in their order, with what was filled in already
   * and the item as it stands; a block of an item that is gone stays at the
   * end, because what was found on it was found.
   */
  readonly listBlocks: (
    blocks: readonly GroupBlock[],
    items: readonly { readonly id: string; readonly item: unknown }[],
  ) => readonly GroupBlock[]
  /**
   * The values a new form starts from when the last one is taken as its
   * template: the fields marked with `carry`. The blocks stay with their
   * items and keep only what carries.
   */
  readonly templateValues: (definition: FormDefinition<T>, values: FormValues) => FormValues
  /** A value in thousandths, as it is written: `0,85 Ω`. */
  readonly formatMeasured: (milli: number, unit: T['unit'], decimals: number) => string
  /**
   * Judges a measured value against the limit its field names, on the day
   * the form says, with the rules of the application. A value outside its
   * limit is said so and kept.
   */
  readonly limitVerdict: (
    field: MeasurementField<T>,
    measuredMilli: number | null,
    context: { readonly rules: RuleSet; readonly on: IsoDate; readonly item?: unknown },
  ) => LimitVerdict
  /**
   * What is wrong with a filled form as it would stand, or null: a definition
   * this build does not know, values that are not the text of an object, a
   * value of the wrong kind, and a form marked signed that lacks what signing
   * needs.
   */
  readonly formRecordProblem: (
    registry: FormRegistry<FormDefinition<T>>,
    record: FilledForm,
  ) => string | null
}

/**
 * The terms of an application with every kind of field: how the engine reads
 * a definition, since what it is handed may come out of a file and hold a
 * kind the application does not show, and it has to say so.
 */
interface Every<T extends FormTerms> {
  readonly unit: T['unit']
  readonly list: T['list']
  readonly limit: T['limit']
  readonly kind: BlockFieldKind
}

const keyShape = /^[a-z][a-z0-9_]*$/

/**
 * Small letters, digits, hyphens and underscores: one application writes the
 * key of a form with hyphens, the next with underscores, as it writes every
 * key of its packages.
 */
const definitionKeyShape = /^[a-z][a-z0-9_-]*$/

/** The keys an answer to a check point holds, and no other. */
const checkPointKeys: readonly string[] = ['result', 'remark', 'photo']

/** The longest id of a record a field may be about. */
const longestRecordId = 64

const numberFormats = new Map<number, Intl.NumberFormat>()

/**
 * A value in thousandths as a number without its unit, `0,85`: in a column
 * whose head names the unit once.
 */
export function measuredNumber(milli: number, decimals: number): string {
  const format =
    numberFormats.get(decimals) ??
    new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })

  numberFormats.set(decimals, format)

  return format.format(milli / 1000)
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

/** Whether a value read out of a definition is an object at all. */
function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An option of a choice as the engine reads it: a value and a label, neither empty. */
function isOption(value: unknown): boolean {
  const option = value as { readonly value?: unknown; readonly label?: unknown } | null

  return (
    isObject(option) &&
    typeof option?.value === 'string' &&
    option.value !== '' &&
    typeof option.label === 'string' &&
    option.label.trim() !== ''
  )
}

/** The id of a file, as a photo field and a check point hold it. */
function isPhoto(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

function isCheckPointAnswer(value: unknown): value is CheckPointValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (checkPointResults as readonly unknown[]).includes((value as CheckPointValue).result)
  )
}

/**
 * What is missing from an answer to a check point: the remark every answer
 * but "in order" needs, the finding or the reason. Null when nothing is.
 */
function remarkMissing(label: string, value: unknown): string | null {
  if (!isCheckPointAnswer(value) || value.result === 'ok') {
    return null
  }

  if (typeof value.remark === 'string' && value.remark.trim() !== '') {
    return null
  }

  const answer = checkPointResultLabel[value.result]

  return value.result === 'not_ok'
    ? `${label}: zu „${answer}“ fehlt die Bemerkung.`
    : `${label}: zu „${answer}“ fehlt der Grund.`
}

function none(text: string): LimitVerdict {
  return { within: null, limitMilli: null, text, source: null }
}

/**
 * The engine for the forms of one application: its units, its lists, the
 * limits it works out, the kinds of field it shows, the records a field may
 * be about and the keys its blocks keep their items under.
 */
export function formEngine<T extends FormTerms>(setup: FormEngineSetup<T>): FormEngine<T> {
  type E = Every<T>

  const keys = setup.blockKeys ?? { id: 'itemId', item: 'item' }
  const units = setup.units as Readonly<Record<string, FormUnit>>
  const lists = setup.lists as Readonly<Record<string, RepeatList>>
  const limits = setup.limits as unknown as Readonly<Record<string, LimitCalculator<E>>>
  const shown: readonly string[] = setup.kinds
  const records: readonly string[] = setup.records ?? []
  const unknownDefinition =
    setup.sentences?.unknownDefinition ?? 'Diese Fassung des Formulars ist hier nicht bekannt.'
  const freeBlockWithItem =
    setup.sentences?.freeBlockWithItem ??
    ((label: string) => `${label}: ein freier Block gehört zu keinem Eintrag einer Liste.`)

  const listOf = (field: GroupField<E>): RepeatList | null =>
    field.repeat !== 'free' && Object.hasOwn(lists, field.repeat)
      ? (lists[field.repeat] ?? null)
      : null

  const unitOf = (unit: string): FormUnit | null =>
    Object.hasOwn(units, unit) ? (units[unit] ?? null) : null

  /** Whether the application shows a field of this kind. */
  const isShown = (kind: string): boolean =>
    kind === 'signature' || kind === 'group' || shown.includes(kind)

  /** Whether an answer to this field is needed before the form is signed. */
  const needed = (field: FormField<E> | BlockField<E>): boolean =>
    field.required === true || field.kind === 'check_point'

  const idOf = (block: GroupBlock): unknown =>
    (block as unknown as Record<string, unknown>)[keys.id]
  const itemOf = (block: GroupBlock): unknown =>
    (block as unknown as Record<string, unknown>)[keys.item]

  /** A block as the application keeps it, with its item under the keys it gave. */
  const blockWith = (
    id: unknown,
    item: unknown,
    values: Readonly<Record<string, FieldValue>>,
  ): GroupBlock => ({ [keys.id]: id, [keys.item]: item, values }) as unknown as GroupBlock

  function definitionProblems(definition: FormDefinition<E>): readonly string[] {
    const problems: string[] = []

    if (typeof definition.key !== 'string' || !definitionKeyShape.test(definition.key)) {
      problems.push(`Der Schlüssel ${String(definition.key)} hat die falsche Form.`)
    }

    if (!Number.isInteger(definition.version) || definition.version < 1) {
      problems.push(`${definition.key}: die Fassung ist eine ganze Zahl ab eins.`)
    }

    if (typeof definition.title !== 'string' || definition.title.trim() === '') {
      problems.push(`${definition.key}: das Formular hat keinen Titel.`)
    }

    if (!Array.isArray(definition.sections)) {
      problems.push(`${definition.key}: ein Formular hat eine Liste von Abschnitten.`)

      return problems
    }

    const seen = new Set<string>()
    const sections = new Set<string>()

    const pointerProblem = (field: FormField<E>, inGroup: boolean): string | null => {
      // Read off any field: a definition out of a file may give one to a
      // signature or a group, which the types do not allow.
      const about = (field as { readonly about?: unknown }).about

      if (about === undefined) {
        return null
      }

      if (field.kind === 'signature' || field.kind === 'group') {
        return `${definition.key}: ${field.key} zeigt auf einen Datensatz, das kann weder eine Unterschrift noch eine Gruppe.`
      }

      if (inGroup) {
        return `${definition.key}: ${field.key} zeigt in einer Gruppe auf einen Datensatz, das kann nur ein Feld außerhalb einer Gruppe.`
      }

      if (
        typeof about !== 'object' ||
        about === null ||
        !records.includes((about as { readonly kind?: unknown }).kind as string)
      ) {
        return `${definition.key}: ${field.key} zeigt auf eine Art von Datensatz, die es nicht gibt.`
      }

      const id = (about as { readonly id?: unknown }).id

      return typeof id === 'string' && id.trim() !== '' && id.length <= longestRecordId
        ? null
        : `${definition.key}: ${field.key} zeigt auf einen Datensatz ohne Kennung.`
    }

    const check = (field: FormField<E>, inGroup: boolean) => {
      // A definition out of a file may hold anything where a field belongs.
      if (!isObject(field)) {
        problems.push(`${definition.key}: unter den Feldern steht etwas, das kein Feld ist.`)

        return
      }

      if (!(formFieldKinds as readonly string[]).includes(field.kind)) {
        problems.push(
          `${definition.key}: das Feld ${field.key} hat die Art ${String(field.kind)}, die es nicht gibt.`,
        )

        return
      }

      if (!isShown(field.kind)) {
        problems.push(
          `${definition.key}: das Feld ${field.key} hat die Art ${field.kind}, die diese Anwendung nicht zeigt.`,
        )

        return
      }

      if (typeof field.key !== 'string' || !keyShape.test(field.key)) {
        problems.push(
          `${definition.key}: das Feld ${String(field.key)} hat einen Schlüssel der falschen Form.`,
        )
      }

      if (typeof field.label !== 'string' || field.label.trim() === '') {
        problems.push(`${definition.key}: das Feld ${field.key} hat keine Beschriftung.`)
      }

      if (field.carry === true && (field.kind === 'measurement' || field.kind === 'signature')) {
        problems.push(
          `${definition.key}: ${field.key} wird nicht übernommen, ein Messwert und eine Unterschrift gehören zu der Prüfung, in der sie entstanden sind.`,
        )
      }

      if (
        field.carry === true &&
        (field.kind === 'check_point' || field.kind === 'meter_reading')
      ) {
        problems.push(
          `${definition.key}: ${field.key} wird nicht übernommen, eine Antwort auf einen Prüfpunkt und ein Zählerstand gehören zu dem Tag, an dem sie entstanden sind.`,
        )
      }

      if (field.kind === 'check_point' && field.required === false) {
        problems.push(
          `${definition.key}: der Prüfpunkt ${field.key} braucht immer eine Antwort, dafür gibt es „entfällt“ und „nicht möglich“.`,
        )
      }

      if (field.kind === 'choice' && !Array.isArray(field.options)) {
        problems.push(
          `${definition.key}: die Auswahl ${field.key} hat keine Liste von Möglichkeiten.`,
        )
      } else if (field.kind === 'choice') {
        if (field.options.length < 2) {
          problems.push(
            `${definition.key}: die Auswahl ${field.key} hat weniger als zwei Möglichkeiten.`,
          )
        }

        if (
          !field.options.every(isOption) ||
          new Set(field.options.map((option) => option.value)).size !== field.options.length
        ) {
          problems.push(
            `${definition.key}: jede Möglichkeit der Auswahl ${field.key} braucht einen eigenen Wert und eine Beschriftung.`,
          )
        }
      }

      if (
        (field.kind === 'number' ||
          field.kind === 'measurement' ||
          field.kind === 'meter_reading') &&
        !unitOf(field.unit)
      ) {
        problems.push(`${definition.key}: ${field.key} nennt eine Einheit, die es nicht gibt.`)
      }

      if (
        (field.kind === 'number' ||
          field.kind === 'measurement' ||
          field.kind === 'meter_reading') &&
        (!Number.isInteger(field.decimals) || field.decimals < 0 || field.decimals > 3)
      ) {
        problems.push(`${definition.key}: ${field.key} zeigt null bis drei Nachkommastellen.`)
      }

      if (field.kind === 'measurement' && field.limit !== undefined) {
        const limit = field.limit

        if (!isObject(limit) || typeof (limit as { readonly kind?: unknown }).kind !== 'string') {
          problems.push(
            `${definition.key}: der Grenzwert von ${field.key} ist von einer Art, die es nicht gibt.`,
          )
        } else if (isRuleLimit(limit)) {
          if (typeof limit.rule !== 'string' || limit.rule === '') {
            problems.push(`${definition.key}: der Grenzwert von ${field.key} nennt keine Regel.`)
          }
        } else if (!Object.hasOwn(limits, limit.kind)) {
          problems.push(
            `${definition.key}: der Grenzwert von ${field.key} ist von einer Art, die es nicht gibt.`,
          )
        }
      }

      const pointer = pointerProblem(field, inGroup)

      if (pointer !== null) {
        problems.push(pointer)
      }

      if (field.kind === 'group') {
        if (inGroup) {
          problems.push(`${definition.key}: die Gruppe ${field.key} steht in einer Gruppe.`)
        }

        if (field.repeat !== 'free' && !listOf(field)) {
          problems.push(
            `${definition.key}: die Gruppe ${field.key} wiederholt über eine Liste, die es nicht gibt.`,
          )
        }

        const inside = new Set<string>()

        if (!Array.isArray(field.fields)) {
          problems.push(`${definition.key}: die Gruppe ${field.key} hat keine Liste von Feldern.`)
        }

        for (const nested of Array.isArray(field.fields) ? field.fields : []) {
          if (isObject(nested) && inside.has(nested.key)) {
            problems.push(`${definition.key}: ${nested.key} steht in ${field.key} zweimal.`)
          }

          if (isObject(nested)) {
            inside.add(nested.key)
          }

          check(nested, true)
        }
      }
    }

    for (const section of definition.sections) {
      if (!isObject(section)) {
        problems.push(
          `${definition.key}: unter den Abschnitten steht etwas, das kein Abschnitt ist.`,
        )
        continue
      }

      if (typeof section.key !== 'string' || !keyShape.test(section.key)) {
        problems.push(
          `${definition.key}: der Abschnitt ${String(section.key)} hat einen Schlüssel der falschen Form.`,
        )
      } else if (sections.has(section.key)) {
        problems.push(`${definition.key}: der Abschnitt ${section.key} steht zweimal im Formular.`)
      }

      sections.add(section.key)

      if (typeof section.title !== 'string' || section.title.trim() === '') {
        problems.push(`${definition.key}: der Abschnitt ${section.key} hat keinen Titel.`)
      }

      if (!Array.isArray(section.fields)) {
        problems.push(
          `${definition.key}: der Abschnitt ${section.key} hat keine Liste von Feldern.`,
        )
        continue
      }

      for (const field of section.fields) {
        if (isObject(field) && seen.has(field.key)) {
          problems.push(`${definition.key}: das Feld ${field.key} steht zweimal im Formular.`)
        }

        if (isObject(field)) {
          seen.add(field.key)
        }

        check(field, false)
      }
    }

    return problems
  }

  function checkPointProblem(field: CheckPointField, value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return `${field.label}: in Ordnung, nicht in Ordnung, entfällt oder nicht möglich.`
    }

    const answer = value as Readonly<Record<string, unknown>>

    if (Object.keys(answer).some((key) => !checkPointKeys.includes(key))) {
      return `${field.label}: ein Prüfpunkt hält eine Antwort, eine Bemerkung und ein Foto.`
    }

    if (!(checkPointResults as readonly unknown[]).includes(answer['result'])) {
      return `${field.label}: in Ordnung, nicht in Ordnung, entfällt oder nicht möglich.`
    }

    const remark = answer['remark']

    if (remark !== undefined && (typeof remark !== 'string' || remark.length > longestFormText)) {
      return `${field.label}: eine Bemerkung mit höchstens ${String(longestFormText)} Zeichen.`
    }

    if (answer['photo'] !== undefined && !isPhoto(answer['photo'])) {
      return `${field.label}: ein Foto aus den Dateien.`
    }

    return null
  }

  function valueProblem(field: BlockField<E> | SignatureField, value: unknown): string | null {
    if (!isShown(field.kind)) {
      // A kind the application does not show, out of a definition nobody
      // checked: refused like one a newer build knows.
      return `${field.label}: dieses Feld kennt dieser Stand nicht.`
    }

    switch (field.kind) {
      case 'text':
        return typeof value === 'string' && value.length <= longestFormText
          ? null
          : `${field.label}: ein Text mit höchstens ${String(longestFormText)} Zeichen.`
      case 'number':
      case 'measurement':
      case 'meter_reading':
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
        return isPhoto(value) ? null : `${field.label}: ein Foto aus den Dateien.`
      case 'check_point':
        return checkPointProblem(field, value)
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
      default:
        // A kind a newer build knows: refused with a sentence, never let through.
        return `${(field as { readonly label?: unknown }).label as string}: dieses Feld kennt dieser Stand nicht.`
    }
  }

  function groupProblem(field: GroupField<E>, value: unknown): string | null {
    if (!Array.isArray(value)) {
      return `${field.label}: eine Liste von Blöcken.`
    }

    const list = listOf(field)

    for (const block of value as unknown[]) {
      if (typeof block !== 'object' || block === null) {
        return `${field.label}: ein Block ist kein Block.`
      }

      const entry = block as Record<string, unknown>
      const id = entry[keys.id]
      const item = entry[keys.item]

      if (list) {
        if (typeof id !== 'string' || !list.itemIsValid(item)) {
          return list.sentences.blockWithoutItem(field.label)
        }
      } else if (field.repeat !== 'free') {
        return `${field.label}: diese Gruppe wiederholt über eine Liste, die es nicht gibt.`
      } else if ((id !== undefined && id !== null) || (item !== undefined && item !== null)) {
        return freeBlockWithItem(field.label)
      }

      const values = entry['values']

      if (typeof values !== 'object' || values === null || Array.isArray(values)) {
        return `${field.label}: ein Block ohne Werte.`
      }

      for (const [key, nestedValue] of Object.entries(values)) {
        const nested = field.fields.find((candidate) => candidate.key === key)

        if (!nested) {
          return `${field.label}: das Feld ${key} gibt es in diesem Block nicht.`
        }

        const problem = valueProblem(nested, nestedValue)

        if (problem !== null) {
          return problem
        }
      }
    }

    if (list) {
      const ids = (value as GroupBlock[]).map(idOf)

      if (new Set(ids).size !== ids.length) {
        return list.sentences.itemTwice(field.label)
      }
    }

    return null
  }

  function valuesProblem(definition: FormDefinition<E>, values: unknown): string | null {
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      return 'Die Werte eines Formulars sind eine Zuordnung von Feldern zu Werten.'
    }

    const fields = fieldsOf(definition)

    for (const [key, value] of Object.entries(values)) {
      const field = fields.find((candidate) => candidate.key === key)

      if (!field) {
        return `Das Feld ${key} gibt es in ${definition.title} nicht.`
      }

      const problem =
        field.kind === 'group' ? groupProblem(field, value) : valueProblem(field, value)

      if (problem !== null) {
        return problem
      }
    }

    return null
  }

  /** Whether a field holds something, for a group whether it has any block. */
  function filled(field: FormField<E>, value: FormValue | undefined): boolean {
    if (value === undefined) {
      return false
    }

    return field.kind === 'group' ? Array.isArray(value) && value.length > 0 : true
  }

  function sealProblems(
    definition: FormDefinition<E>,
    values: FormValues,
    { seal = true }: { readonly seal?: boolean } = {},
  ): readonly string[] {
    const missing: string[] = []

    for (const field of fieldsOf(definition)) {
      const value = values[field.key]

      if (needed(field) && !filled(field, value)) {
        missing.push(`${field.label} fehlt.`)
      }

      const remark = field.kind === 'check_point' ? remarkMissing(field.label, value) : null

      if (remark !== null) {
        missing.push(remark)
      }

      if (seal && field.kind === 'signature' && field.seals && value === undefined) {
        missing.push(`${field.label} fehlt.`)
      }

      if (field.kind === 'group' && Array.isArray(value)) {
        for (const [index, block] of (value as readonly GroupBlock[]).entries()) {
          const where = `${field.label}, Block ${String(index + 1)}`

          for (const nested of field.fields) {
            const nestedValue = block.values[nested.key]

            if (needed(nested) && nestedValue === undefined) {
              missing.push(`${where}: ${nested.label} fehlt.`)
            }

            const nestedRemark =
              nested.kind === 'check_point'
                ? remarkMissing(`${where}: ${nested.label}`, nestedValue)
                : null

            if (nestedRemark !== null) {
              missing.push(nestedRemark)
            }
          }
        }
      }
    }

    return missing
  }

  function sealingField(definition: FormDefinition<E>): SignatureField | null {
    const found = fieldsOf(definition).find(
      (field): field is SignatureField => field.kind === 'signature' && field.seals === true,
    )

    return found ?? null
  }

  function listBlocks(
    blocks: readonly GroupBlock[],
    items: readonly { readonly id: string; readonly item: unknown }[],
  ): readonly GroupBlock[] {
    const byItem = new Map(blocks.map((block) => [idOf(block), block]))
    const current = items.map(({ id, item }) => blockWith(id, item, byItem.get(id)?.values ?? {}))
    const gone = blocks.filter((block) => {
      const id = idOf(block)

      return id === null || id === undefined || !items.some((entry) => entry.id === id)
    })

    return [...current, ...gone]
  }

  function templateValues(definition: FormDefinition<E>, values: FormValues): FormValues {
    const kept: Record<string, FormValue> = {}
    const carries = (field: FormField<E>) =>
      field.carry === true &&
      field.kind !== 'measurement' &&
      field.kind !== 'signature' &&
      field.kind !== 'check_point' &&
      field.kind !== 'meter_reading'

    for (const field of fieldsOf(definition)) {
      const value = values[field.key]

      if (value === undefined) {
        continue
      }

      if (field.kind === 'group') {
        if (Array.isArray(value)) {
          kept[field.key] = (value as readonly GroupBlock[]).map((block) =>
            blockWith(
              idOf(block),
              itemOf(block),
              Object.fromEntries(
                Object.entries(block.values).filter(([key]) =>
                  field.fields.some((nested) => nested.key === key && carries(nested)),
                ),
              ),
            ),
          )
        }

        continue
      }

      if (carries(field)) {
        kept[field.key] = value
      }
    }

    return kept
  }

  function formatMeasured(milli: number, unit: T['unit'], decimals: number): string {
    const sign = unitOf(unit)?.sign

    return sign === undefined
      ? measuredNumber(milli, decimals)
      : `${measuredNumber(milli, decimals)} ${sign}`
  }

  function thousandthsOf(unit: string, record: RuleRecord): number {
    const factor = unitOf(unit)?.fromRule?.[record.unit]

    if (factor === undefined) {
      throw new RuleError(
        `Die Regel ${record.key} in ${record.unit} passt nicht zu einem Messwert in ${unit}.`,
      )
    }

    return record.value * factor
  }

  function limitVerdict(
    field: MeasurementField<E>,
    measuredMilli: number | null,
    context: { readonly rules: RuleSet; readonly on: IsoDate; readonly item?: unknown },
  ): LimitVerdict {
    const limit = field.limit

    if (!limit) {
      return none('Kein Grenzwert.')
    }

    let worked: WorkedOutValue

    if (isRuleLimit(limit)) {
      const record = context.rules.at(limit.rule, context.on)

      if (!record) {
        return none('Für diesen Tag ist kein Grenzwert hinterlegt.')
      }

      worked = {
        limitMilli: thousandthsOf(field.unit, record),
        atLeast: limit.kind === 'at_least',
        source: record.source,
      }
    } else {
      const calculator = Object.hasOwn(limits, limit.kind) ? limits[limit.kind] : undefined

      if (!calculator) {
        return none('Diesen Grenzwert kennt dieser Stand nicht.')
      }

      const outcome = calculator(field, {
        rules: context.rules,
        on: context.on,
        item: context.item ?? null,
      })

      if ('none' in outcome) {
        return none(outcome.none)
      }

      worked = outcome
    }

    const { limitMilli, atLeast, source } = worked

    // Written with the places of the field and rounded towards the strict
    // side: 2,875 as "höchstens 2,87", never 2,88, or a measured 2,88 would be
    // outside a limit that reads like it.
    const step = 10 ** Math.max(0, 3 - field.decimals)
    const shownLimit = atLeast
      ? Math.ceil(limitMilli / step) * step
      : Math.floor(limitMilli / step) * step
    const stated = `${atLeast ? 'mindestens' : 'höchstens'} ${formatMeasured(
      shownLimit,
      field.unit,
      field.decimals,
    )}`

    if (measuredMilli === null) {
      return { within: null, limitMilli, text: `Grenzwert: ${stated}.`, source }
    }

    const within = atLeast ? measuredMilli >= limitMilli : measuredMilli <= limitMilli

    return {
      within,
      limitMilli,
      text: within
        ? `Innerhalb des Grenzwerts, ${stated}.`
        : `Außerhalb des Grenzwerts, ${stated}.`,
      source,
    }
  }

  function formRecordProblem(
    registry: FormRegistry<FormDefinition<E>>,
    record: FilledForm,
  ): string | null {
    const definition =
      typeof record.definitionKey === 'string' && typeof record.definitionVersion === 'number'
        ? registry.definitionFor(record.definitionKey, record.definitionVersion)
        : null

    if (!definition) {
      return unknownDefinition
    }

    if (typeof record.values === 'string' && record.values.length > longestFormValues) {
      return `Die Werte eines Formulars sind höchstens ${String(longestFormValues)} Zeichen lang.`
    }

    const values = readFormValues(record.values ?? '{}')

    if (values === null) {
      return 'Die Werte eines Formulars kommen als JSON-Text eines Objekts.'
    }

    const problem = valuesProblem(definition, values)

    if (problem !== null) {
      return problem
    }

    if (record.status === 'signed') {
      const [missing] = sealProblems(definition, values)

      if (missing !== undefined) {
        return `Unterschrieben wird ein vollständiges Protokoll: ${missing}`
      }
    }

    return null
  }

  const engine: FormEngine<E> = {
    definitionProblems,
    valueProblem,
    valuesProblem,
    sealProblems,
    sealingField,
    listBlocks,
    templateValues,
    formatMeasured,
    limitVerdict,
    formRecordProblem,
  }

  // The engine reads every kind, the application is handed the ones it
  // shows: a definition of its own terms is one of these, so the functions
  // take it as they are.
  return engine as unknown as FormEngine<T>
}
