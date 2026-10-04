import type { IsoDate } from '../model/identifier.js'
import { signaturePathIsValid, signerNameProblem } from '../model/signature.js'
import { RuleError, type RuleRecord, type RuleSet, type RuleUnit } from '../rules/rule.js'
import {
  type BlockField,
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
   * to show and never a reason to refuse it.
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
   * fields that are empty, required fields of every block included, and a
   * signature that seals it. Without the seal it is the question the form
   * asks before it offers the signature at all.
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

const keyShape = /^[a-z][a-z0-9_]*$/
const definitionKeyShape = /^[a-z][a-z0-9-]*$/

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

function none(text: string): LimitVerdict {
  return { within: null, limitMilli: null, text, source: null }
}

/**
 * The engine for the forms of one application: its units, its lists, the
 * limits it works out and the keys its blocks keep their items under.
 */
export function formEngine<T extends FormTerms>(setup: FormEngineSetup<T>): FormEngine<T> {
  const keys = setup.blockKeys ?? { id: 'itemId', item: 'item' }
  const units = setup.units as Readonly<Record<string, FormUnit>>
  const lists = setup.lists as Readonly<Record<string, RepeatList>>
  const limits = setup.limits as Readonly<Record<string, LimitCalculator<T>>>
  const unknownDefinition =
    setup.sentences?.unknownDefinition ?? 'Diese Fassung des Formulars ist hier nicht bekannt.'
  const freeBlockWithItem =
    setup.sentences?.freeBlockWithItem ??
    ((label: string) => `${label}: ein freier Block gehört zu keinem Eintrag einer Liste.`)

  const listOf = (field: GroupField<T>): RepeatList | null =>
    field.repeat !== 'free' && Object.hasOwn(lists, field.repeat)
      ? (lists[field.repeat] ?? null)
      : null

  const unitOf = (unit: string): FormUnit | null =>
    Object.hasOwn(units, unit) ? (units[unit] ?? null) : null

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

  function definitionProblems(definition: FormDefinition<T>): readonly string[] {
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

    const check = (field: FormField<T> | BlockField<T>, inGroup: boolean) => {
      if (!(formFieldKinds as readonly string[]).includes(field.kind)) {
        problems.push(
          `${definition.key}: das Feld ${field.key} hat die Art ${String(field.kind)}, die es nicht gibt.`,
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

      if (field.kind === 'choice' && field.options.length < 2) {
        problems.push(
          `${definition.key}: die Auswahl ${field.key} hat weniger als zwei Möglichkeiten.`,
        )
      }

      if (
        field.kind === 'choice' &&
        (field.options.some((option) => option.value === '' || option.label.trim() === '') ||
          new Set(field.options.map((option) => option.value)).size !== field.options.length)
      ) {
        problems.push(
          `${definition.key}: jede Möglichkeit der Auswahl ${field.key} braucht einen eigenen Wert und eine Beschriftung.`,
        )
      }

      if ((field.kind === 'number' || field.kind === 'measurement') && !unitOf(field.unit)) {
        problems.push(`${definition.key}: ${field.key} nennt eine Einheit, die es nicht gibt.`)
      }

      if (
        (field.kind === 'number' || field.kind === 'measurement') &&
        (!Number.isInteger(field.decimals) || field.decimals < 0 || field.decimals > 3)
      ) {
        problems.push(`${definition.key}: ${field.key} zeigt null bis drei Nachkommastellen.`)
      }

      if (field.kind === 'measurement' && field.limit !== undefined) {
        const limit = field.limit

        if (isRuleLimit(limit)) {
          if (typeof limit.rule !== 'string' || limit.rule === '') {
            problems.push(`${definition.key}: der Grenzwert von ${field.key} nennt keine Regel.`)
          }
        } else if (!Object.hasOwn(limits, limit.kind)) {
          problems.push(
            `${definition.key}: der Grenzwert von ${field.key} ist von einer Art, die es nicht gibt.`,
          )
        }
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
        if (seen.has(field.key)) {
          problems.push(`${definition.key}: das Feld ${field.key} steht zweimal im Formular.`)
        }

        seen.add(field.key)
        check(field, false)
      }
    }

    return problems
  }

  function valueProblem(field: BlockField<T> | SignatureField, value: unknown): string | null {
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
      default:
        // A kind a newer build knows: refused with a sentence, never let through.
        return `${(field as { readonly label?: unknown }).label as string}: dieses Feld kennt dieser Stand nicht.`
    }
  }

  function groupProblem(field: GroupField<T>, value: unknown): string | null {
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

  function valuesProblem(definition: FormDefinition<T>, values: unknown): string | null {
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
  function filled(field: FormField<T>, value: FormValue | undefined): boolean {
    if (value === undefined) {
      return false
    }

    return field.kind === 'group' ? Array.isArray(value) && value.length > 0 : true
  }

  function sealProblems(
    definition: FormDefinition<T>,
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

  function sealingField(definition: FormDefinition<T>): SignatureField | null {
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

  function templateValues(definition: FormDefinition<T>, values: FormValues): FormValues {
    const kept: Record<string, FormValue> = {}
    const carries = (field: FormField<T> | BlockField<T>) =>
      field.carry === true && field.kind !== 'measurement' && field.kind !== 'signature'

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
    field: MeasurementField<T>,
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
    const shown = atLeast
      ? Math.ceil(limitMilli / step) * step
      : Math.floor(limitMilli / step) * step
    const stated = `${atLeast ? 'mindestens' : 'höchstens'} ${formatMeasured(
      shown,
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
    registry: FormRegistry<FormDefinition<T>>,
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

  return {
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
}
