import type { DocumentKind } from '../model/document.js'
import type { InstructionContent, IssuerContent } from '../model/document-content.js'
import type { IsoDate } from '../model/identifier.js'
import {
  type ContractBlocks,
  filledInstruction,
  type Instruction,
  type InstructionChoices,
  type InstructionForDocument,
  type InstructionTemplate,
  placeholdersIn,
  proposedFor,
  unfilledPlaceholders,
  type WithdrawalVariant,
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

/** "28.05.2022", the way a German reads a date. */
function day(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** "die Telefonnummer", "die Telefonnummer und die E-Mail-Adresse". */
function inWords(parts: readonly string[]): string {
  return parts.length <= 1
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} und ${parts.at(-1) ?? ''}`
}

/** Whether an instruction goes with a document: the office's choice, else the proposal. */
export function includedIn(
  instruction: Pick<InstructionForDocument, 'id' | 'kinds' | 'consumersOnly'>,
  choices: InstructionChoices,
  document: { readonly kind: DocumentKind; readonly recipientIsBusiness: boolean },
): boolean {
  if (choices.switchedOff.includes(instruction.id)) {
    return false
  }

  return choices.switchedOn.includes(instruction.id) || proposedFor(instruction, document)
}

/**
 * The way out that every refusal over an instruction shares: the instruction
 * was proposed, and a proposal can be wrong for this one document.
 */
const switchOff =
  ' Gehört die Belehrung nicht zu diesem Beleg, lässt sie sich am Beleg unter „Belehrungen“ ' +
  'abschalten.'

/** Something a document lacks before its instructions can go out, as a sentence. */
export interface InstructionGap {
  readonly detail: 'instruction'
  /** German, and it says where to fix it. */
  readonly message: string
}

/**
 * The instructions of a document, put together the way it goes out, and what
 * is still missing for them.
 *
 * Every instruction of the business is asked whether it goes with this
 * document, in the business's order. The one that does gets its words of the
 * document's date, and its placeholders filled from the letterhead and from
 * the kind of contract chosen on the document.
 *
 * What cannot be filled is not printed as a gap in the text, it is a reason
 * not to issue: an instruction on withdrawal without the business's telephone
 * number is not the model filled in correctly, and only the model filled in
 * correctly is a safe harbour. A shipped instruction on a day before its
 * first version is left out and said to be missing, because printing today's
 * words under an old date would be a statement about a law that did not say
 * them.
 *
 * Pure, like `documentContent`: the caller reads the instructions, the
 * choices and the letterhead, and a draft and its issuing come to the same
 * answer.
 */
export function documentInstructions(
  instructions: readonly InstructionForDocument[],
  choices: InstructionChoices,
  document: {
    readonly kind: DocumentKind
    readonly documentDate: IsoDate
    readonly recipientIsBusiness: boolean
  },
  issuer: IssuerContent,
  wordings: readonly ShippedWording[] = shippedWordings,
): { readonly contents: readonly InstructionContent[]; readonly gaps: readonly InstructionGap[] } {
  const contents: InstructionContent[] = []
  const gaps: InstructionGap[] = []
  const on = document.documentDate

  for (const instruction of instructions) {
    if (!includedIn(instruction, choices, document)) {
      continue
    }

    const words = instructionWordingAt(instruction, on, wordings)
    const named = `Die Belehrung „${instruction.title}“`

    if (words === null) {
      const first = instruction.template
        ? wordings
            .filter((wording) => wording.template === instruction.template)
            .map((wording) => wording.validFrom)
            .sort()[0]
        : undefined

      gaps.push({
        detail: 'instruction',
        message:
          `${named} ist für den ${day(on)} nicht hinterlegt` +
          (first ? `, die erste mitgelieferte Fassung gilt ab dem ${day(first)}.` : '.') +
          switchOff,
      })
      continue
    }

    const blocks = contractBlocksAt(choices.variant, on, wordings)
    const usesContract = placeholdersIn(words.text).some(
      (token) => token === '{fristbeginn}' || token === '{folgen}',
    )

    if (usesContract && blocks === null) {
      gaps.push({
        detail: 'instruction',
        message:
          `${named} hängt von der Art des Vertrags ab, und für den ${day(on)} ist dafür keine ` +
          `Fassung des Musters hinterlegt.${switchOff}`,
      })
      continue
    }

    const unfilled = unfilledPlaceholders(words.text, issuer)

    if (unfilled.length > 0) {
      gaps.push({
        detail: 'instruction',
        message:
          `Für die Belehrung „${instruction.title}“ ${unfilled.length === 1 ? 'fehlt' : 'fehlen'} ` +
          `im Briefkopf ${inWords(unfilled.map((entry) => entry.missing))}. Eintragen lässt sich ` +
          `das unter „Einstellungen“, „Briefkopf“.${switchOff}`,
      })
    }

    contents.push({
      title: words.title,
      text: filledInstruction(words.text, {
        issuer,
        blocks: blocks ?? { fristbeginn: '', folgen: '' },
      }),
      withDocument: instruction.withDocument,
      model:
        instruction.template && words.wording
          ? {
              template: instruction.template,
              validFrom: words.wording.validFrom,
              source: words.wording.source,
              changed: words.changed,
            }
          : null,
      variant: choices.variant,
    })
  }

  return { contents, gaps }
}
