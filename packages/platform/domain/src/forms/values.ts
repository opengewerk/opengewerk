/** A signature given in a form: the path drawn, the name typed beside it, the moment. */
export interface SignatureValue {
  readonly name: string
  readonly path: string
  readonly signedAt: string
}

/**
 * The value of one field as a filled form holds it. Numbers and measured
 * values are whole thousandths of their unit, like every figure in the
 * applications of the organisation: 0,85 Ω is 850. A photo is the id of a
 * file of what the form hangs on. Nothing filled in is the key left out, not
 * an empty value.
 */
export type FieldValue = string | number | boolean | SignatureValue

/**
 * One block of a repeating group: its own values, and, for a group over a
 * list of the application, the item it is about. Under which keys a block
 * keeps the item and its id the application says (`blockKeys` of the
 * engine), because what is stored stays readable as it was written.
 */
export interface GroupBlock {
  readonly values: Readonly<Record<string, FieldValue>>
}

export type FormValue = FieldValue | readonly GroupBlock[]

/** A filled form: its values by key. */
export type FormValues = Readonly<Record<string, FormValue>>

/** Long enough for a list of findings, short enough for one transmission. */
export const longestFormText = 4000

/**
 * The longest the values of one form may be as text. Far above any form a
 * person fills in, a hundred blocks with a remark on every one included, and
 * still a size one transmission carries twice, as `from` and `to`. A table
 * that keeps filled forms holds the same length in a check.
 */
export const longestFormValues = 1_000_000

/**
 * The values of a filled form as a record carries them: JSON text. The sync
 * carries plain values and compares a field by what a device saw in it, so
 * the text a device wrote is the text it gets back, character for character.
 */
export function formValuesText(values: FormValues): string {
  return JSON.stringify(values)
}

/**
 * The values of a filled form read from the text a record carries, or null
 * when it is not the text of an object. Whether the values fit their
 * definition is `valuesProblem` of the engine, asked after this.
 */
export function readFormValues<Values extends FormValues = FormValues>(
  text: unknown,
): Values | null {
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
    ? (parsed as Values)
    : null
}

/** The states a filled form goes through: written while a draft, fixed once signed. */
export const formRecordStatuses = ['draft', 'signed'] as const

export type FormRecordStatus = (typeof formRecordStatuses)[number]
