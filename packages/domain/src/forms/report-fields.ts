import type { ReportFieldContent } from '../model/document-content.js'
import type { Id, Synced } from '../model/identifier.js'
import type {
  BlockField,
  ChoiceField,
  FormDefinition,
  NumberField,
  TextField,
  YesNoField,
} from './definition.js'
import { definitionProblems, fieldsOf } from './definition.js'
import { formatMeasured } from './limits.js'
import type { FieldValue, FormValues } from './values.js'

/**
 * The fields a business gives its daily reports (#78, decided with #137).
 *
 * The report stays a document: it has lines, is signed, issued and invoiced.
 * What the engine adds are fields the business chooses for it, the weather,
 * the distance driven, something particular about the site. They are a form
 * definition like the ones a trade package brings, kept in the database
 * because the business writes it, and versioned the same way: a report is
 * filled in, signed and printed with the version it was started with.
 *
 * Four kinds and no more: text, a number with a unit, a choice and yes or
 * no. A report is a page a customer signs; anything that needs a measured
 * value with a limit is a protocol.
 */

export const reportFieldKinds = ['text', 'number', 'choice', 'yes_no'] as const

export type ReportFieldKind = (typeof reportFieldKinds)[number]

export type ReportField = TextField | NumberField | ChoiceField | YesNoField

/** The key every business's report definition has; its versions count up from one. */
export const reportDefinitionKey = 'report'

/** At most this many fields: a report is read and signed on a phone. */
export const mostReportFields = 12

/** A label a customer reads at a glance. */
export const longestFieldLabel = 80

/**
 * One version of a form a business writes itself, as it is kept and synced:
 * the definition as JSON text, read with `readFormDefinition`. Never changed;
 * a change is the next version.
 */
export interface FormDefinitionRecord extends Synced {
  readonly id: Id<'form-definition'>
  readonly key: string
  /** Counts up from one per key; `version` of the row is the sync's own counter. */
  readonly definitionVersion: number
  readonly definition: string
}

/** A definition out of the JSON text a record keeps, or null when it is not one. */
export function readFormDefinition(text: unknown): FormDefinition | null {
  if (typeof text !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(text) as unknown

    return typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as FormDefinition).sections)
      ? (parsed as FormDefinition)
      : null
  } catch {
    return null
  }
}

/** The definition of a business's report fields, in the shape of every other form. */
export function reportDefinition(version: number, fields: readonly ReportField[]): FormDefinition {
  return {
    key: reportDefinitionKey,
    version,
    title: 'Regiebericht',
    attachesTo: 'document',
    sections: [{ key: 'fields', title: 'Angaben', fields }],
  }
}

/** The fields of a report definition, whichever version. */
export function reportFieldsOf(definition: FormDefinition | null): readonly ReportField[] {
  return definition
    ? fieldsOf(definition).filter((field): field is ReportField =>
        reportFieldKinds.some((kind) => kind === field.kind),
      )
    : []
}

/**
 * What is wrong with the fields a business wants to give its reports, as
 * sentences, or nothing. Asked by the screen in the settings before it saves
 * and by the route that saves, with the same sentences.
 */
export function reportFieldsProblems(fields: unknown): readonly string[] {
  if (!Array.isArray(fields)) {
    return ['Die Felder kommen als Liste.']
  }

  if (fields.length > mostReportFields) {
    return [`Ein Regiebericht hat höchstens ${String(mostReportFields)} eigene Felder.`]
  }

  const problems: string[] = []

  for (const field of fields as readonly Partial<ReportField>[]) {
    if (typeof field !== 'object' || field === null) {
      return ['Jedes Feld ist ein Eintrag mit Art und Beschriftung.']
    }

    if (!reportFieldKinds.some((kind) => kind === field.kind)) {
      return ['Ein Feld ist Text, Zahl mit Einheit, Auswahl oder Ja/Nein.']
    }

    const label = typeof field.label === 'string' ? field.label.trim() : ''

    if (label === '') {
      problems.push('Jedes Feld braucht eine Beschriftung.')
    } else if (label.length > longestFieldLabel) {
      problems.push(`${label}: höchstens ${String(longestFieldLabel)} Zeichen.`)
    }
  }

  if (problems.length > 0) {
    return problems
  }

  const labels = (fields as readonly ReportField[]).map((field) => field.label.trim())
  const twice = labels.find((label, index) => labels.indexOf(label) !== index)

  if (twice !== undefined) {
    return [`Das Feld ${twice} steht zweimal da.`]
  }

  // The rest is what every definition is asked: keys, units, options.
  return definitionProblems(reportDefinition(1, fields as readonly ReportField[]))
}

/**
 * The fields as they are kept: each with what its kind uses and nothing else,
 * the labels trimmed. A client that sends a limit or a flag of a protocol
 * along does not carry it into the report; call it after
 * `reportFieldsProblems` has found nothing.
 */
export function normalizedReportFields(fields: readonly ReportField[]): readonly ReportField[] {
  return fields.map((field): ReportField => {
    const base = { key: field.key, label: field.label.trim() }

    switch (field.kind) {
      case 'text':
        return { kind: 'text', ...base, ...(field.multiline === true ? { multiline: true } : {}) }
      case 'number':
        return { kind: 'number', ...base, unit: field.unit, decimals: field.decimals }
      case 'choice':
        return {
          kind: 'choice',
          ...base,
          options: field.options.map((option) => ({
            value: option.value,
            label: option.label.trim(),
          })),
        }
      case 'yes_no':
        return { kind: 'yes_no', ...base }
    }
  })
}

/**
 * The key of a field added now: `field_1`, `field_2`, one more than any in
 * use, so that a field removed and one added in the same version never share
 * a key. Across versions a key may come back: a report is read with the
 * version it was filled in, never with a later one.
 */
export function nextReportFieldKey(used: readonly string[]): string {
  const highest = used.reduce((most, key) => {
    const match = /^field_(\d+)$/.exec(key)

    return match ? Math.max(most, Number(match[1])) : most
  }, 0)

  return `field_${String(highest + 1)}`
}

/** A value the way the report shows it and the paper prints it: "25 km", "ja", "Regen". */
export function fieldText(field: BlockField, value: FieldValue | undefined): string | null {
  if (value === undefined) {
    return null
  }

  switch (field.kind) {
    case 'text':
      return typeof value === 'string' && value.trim() !== '' ? value : null
    case 'number':
    case 'measurement':
      return typeof value === 'number' ? formatMeasured(value, field.unit, field.decimals) : null
    case 'choice':
      return field.options.find((option) => option.value === value)?.label ?? null
    case 'yes_no':
      return value === true ? 'ja' : value === false ? 'nein' : null
    case 'photo':
      return null
  }
}

/**
 * The fields of a report as the customer reads them before signing and the
 * frozen document prints them: label and text, in the order of the
 * definition, the empty ones left out.
 */
export function reportFieldLines(
  definition: FormDefinition | null,
  values: FormValues,
): readonly ReportFieldContent[] {
  return reportFieldsOf(definition).flatMap((field) => {
    const value = values[field.key]
    const text = fieldText(field, Array.isArray(value) ? undefined : (value as FieldValue))

    return text === null ? [] : [{ label: field.label, text }]
  })
}
