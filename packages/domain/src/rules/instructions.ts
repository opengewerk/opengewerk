import type { DocumentKind } from '../model/document.js'
import type { IsoDate } from '../model/identifier.js'
import type {
  ContractBlocks,
  Instruction,
  InstructionTemplate,
  WithdrawalVariant,
} from '../model/instruction.js'
import shipped from './data/instructions.json' with { type: 'json' }

/**
 * One version of a shipped instruction, for the time it was the law's.
 *
 * The same idea as a rule record, with a text where a record has a number:
 * a period of validity, inclusive at both ends, and the place in the law it
 * comes from. A rule package holds numbers only and says so, see `taxNotes`;
 * an instruction is a text somebody prints, and it gets a package of its own
 * rather than a text valued rule.
 */
export interface ShippedWording {
  readonly template: InstructionTemplate
  readonly validFrom: IsoDate
  readonly validUntil: IsoDate | null
  readonly source: string
  readonly title: string
  /** The words with their placeholders, in the markup `instructionBlocks` reads. */
  readonly text: string
  /**
   * The sentences the two contract placeholders stand for, per kind of
   * contract. Only the instruction on withdrawal has them; they are the notes
   * on design of its model, filled in.
   */
  readonly contract?: Readonly<Record<WithdrawalVariant, ContractBlocks>>
  /** German, because whoever reads it is deciding whether it is right. */
  readonly note?: string
}

export interface WordingPackage {
  readonly package: string
  readonly note: string
  readonly wordings: readonly ShippedWording[]
}

/**
 * The wordings that ship with this version.
 *
 * JSON for the reason the rule packages are JSON: whoever checks the words
 * against the law reads a data file, not a piece of logic, and a new version
 * of the model is an entry and not a change to the code.
 */
export const wordingPackage: WordingPackage = shipped as WordingPackage

export const shippedWordings: readonly ShippedWording[] = wordingPackage.wordings

function covers(wording: ShippedWording, on: IsoDate): boolean {
  // ISO dates sort like the days they name, as in the rule engine.
  return wording.validFrom <= on && (wording.validUntil === null || on <= wording.validUntil)
}

/**
 * The version of a shipped instruction in force on a day, or null when none
 * was. Asked with the date of the document, never with today: a quote from
 * before a change in the law gets the words of its own day.
 */
export function wordingAt(
  template: InstructionTemplate,
  on: IsoDate,
  wordings: readonly ShippedWording[] = shippedWordings,
): ShippedWording | null {
  return wordings.find((wording) => wording.template === template && covers(wording, on)) ?? null
}

/**
 * The newest version of a shipped instruction, which may not be in force yet.
 * An update can bring a version that applies from a day to come, and the
 * business that changed the wording should hear about it before that day.
 */
export function latestWording(
  template: InstructionTemplate,
  wordings: readonly ShippedWording[] = shippedWordings,
): ShippedWording | null {
  return (
    wordings
      .filter((wording) => wording.template === template)
      .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0] ?? null
  )
}

/**
 * The sentences a kind of contract puts in for the two contract placeholders
 * on a day, from the instruction on withdrawal in force then. Null when none
 * was, and then an instruction that uses them cannot be printed for that day.
 */
export function contractBlocksAt(
  variant: WithdrawalVariant,
  on: IsoDate,
  wordings: readonly ShippedWording[] = shippedWordings,
): ContractBlocks | null {
  return wordingAt('withdrawal', on, wordings)?.contract?.[variant] ?? null
}

/**
 * How a shipped instruction starts out in a business that has not touched it.
 *
 * The instruction on withdrawal and its form are proposed for the quote and
 * the estimate to a customer who is not a business, because that is where a
 * trade business concludes a contract at the customer's home, and they go out
 * with the document: both have to reach the customer in text form. The sheet
 * for an early start is proposed with them and kept at the document, to be
 * printed when the customer wants the work to begin within the fourteen days.
 */
export const shippedInstructionDefaults: Readonly<
  Record<
    InstructionTemplate,
    {
      readonly kinds: readonly DocumentKind[]
      readonly consumersOnly: boolean
      readonly withDocument: boolean
      readonly position: number
    }
  >
> = {
  withdrawal: {
    kinds: ['cost_estimate', 'quote'],
    consumersOnly: true,
    withDocument: true,
    position: 1,
  },
  withdrawal_form: {
    kinds: ['cost_estimate', 'quote'],
    consumersOnly: true,
    withDocument: true,
    position: 2,
  },
  early_start: {
    kinds: ['cost_estimate', 'quote'],
    consumersOnly: true,
    withDocument: false,
    position: 3,
  },
}

/**
 * A wording the way it is kept and compared: plain line endings, no spaces at
 * the end of a line, no empty lines at the start or the end. Two wordings
 * that differ only in that are the same wording, and a business that pasted
 * the model back in has not changed it.
 */
export function normalizedWording(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

/** What an instruction says on a day, before its placeholders are filled. */
export interface InstructionWording {
  readonly title: string
  readonly text: string
  /**
   * The shipped version it is or was changed from: the one in force on that
   * day. Null for an instruction the business wrote.
   */
  readonly wording: ShippedWording | null
  /** Whether the words are the business's own and not the model's. */
  readonly changed: boolean
}

/**
 * The words of an instruction on a day.
 *
 * A shipped one nobody changed has the model's words of that day; a changed
 * one has the business's, under the model's heading; one the business wrote
 * has its own heading and words. Null for a shipped one on a day before its
 * first version, which the caller has to refuse rather than print empty.
 */
export function instructionWordingAt(
  instruction: Pick<Instruction, 'template' | 'title' | 'body'>,
  on: IsoDate,
  wordings: readonly ShippedWording[] = shippedWordings,
): InstructionWording | null {
  if (instruction.template === null) {
    return {
      title: instruction.title,
      text: instruction.body ?? '',
      wording: null,
      changed: false,
    }
  }

  const wording = wordingAt(instruction.template, on, wordings)

  if (instruction.body !== null) {
    return { title: instruction.title, text: instruction.body, wording, changed: true }
  }

  return wording ? { title: wording.title, text: wording.text, wording, changed: false } : null
}
