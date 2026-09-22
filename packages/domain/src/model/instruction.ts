import type { Address } from './address.js'
import type { DocumentKind } from './document.js'
import type { IssuerContent } from './document-content.js'
import type {
  DocumentId,
  DocumentInstructionChoicesId,
  InstructionId,
  IsoDate,
  TenantOwned,
} from './identifier.js'

/**
 * The instructions OpenGewerk ships, one key per wording.
 *
 * `withdrawal` is the model instruction on withdrawal of annex 1 to
 * Art. 246a EGBGB, `withdrawal_form` the model withdrawal form of annex 2,
 * `early_start` the sheet on which a consumer asks for the work to begin
 * before the fourteen days are over, and `withdrawal_notes` what
 * Art. 246a § 1 (3) EGBGB asks for beyond the model: when there is no right
 * of withdrawal, and when it ends early. The first two are the law's own
 * words. The other two have no model in the law; their words are the ones
 * Moritz uses on msk-solutions.de, and they go to #31 for review like a rule
 * package.
 */
export const instructionTemplates = [
  'withdrawal',
  'withdrawal_form',
  'early_start',
  'withdrawal_notes',
] as const

export type InstructionTemplate = (typeof instructionTemplates)[number]

/**
 * What a contract is about, as far as the model instruction asks: work, or
 * goods that are delivered and installed. Its notes on design give different
 * sentences for the two, one for when the period starts and one for what
 * happens to what was done or delivered before the customer withdraws.
 *
 * `service` is the default. A trade business mostly contracts for work, and
 * work is a service in the sense of the directive even when material comes
 * with it; a delivery with installation is the case somebody chooses on the
 * document it applies to.
 */
export const withdrawalVariants = ['service', 'goods'] as const

export type WithdrawalVariant = (typeof withdrawalVariants)[number]

/**
 * A text a business hands its customers together with a document: the
 * instruction on withdrawal, the form that goes with it, and whatever the
 * business writes for itself.
 *
 * One row per instruction and business. The shipped ones exist for every
 * business the moment it first asks for its instructions; its own ones when
 * it writes them.
 *
 * A shipped instruction keeps no wording as long as the business leaves it as
 * it is. `body` stays empty, and the words come from the package that shipped
 * with this version, in the version in force on the date of the document. That
 * way a change in the law arrives as an update and not as a task for every
 * business, and a document from before the change still gets the words of its
 * own day.
 */
export interface Instruction extends TenantOwned {
  readonly id: InstructionId
  /** The shipped wording this one is, or null for one the business wrote. */
  readonly template: InstructionTemplate | null
  /** The heading it is printed under. A shipped instruction keeps the one of its model. */
  readonly title: string
  /**
   * The words as the business keeps them, placeholders and all. Null for a
   * shipped instruction nobody changed, which means the model as the law has
   * it; never null for one the business wrote.
   */
  readonly body: string | null
  /**
   * For a shipped instruction the business changed: the day the version it
   * was changed from came into force. When a later version ships, the screen
   * can say that the changed wording is older than the law.
   */
  readonly basedOn: IsoDate | null
  /** The kinds of document it is proposed for. Empty means for none. */
  readonly kinds: readonly DocumentKind[]
  /** Proposed only when the customer is not a business. */
  readonly consumersOnly: boolean
  /**
   * Whether it goes out with the document: printed in its PDF after the
   * document itself, and therefore on paper and in the mail as well. One that
   * does not is kept at the document as a sheet of its own, printed when it is
   * needed. The sheet for an early start is the case: it is signed and handed
   * back, and only when the customer wants the work to begin early.
   */
  readonly withDocument: boolean
  /** Where it stands in the list and in the PDF, lowest first. */
  readonly position: number
}

/**
 * What the office chose on a document: the kind of contract, and the
 * instructions it switched on or off against the proposal. An instruction in
 * neither list follows the proposal, so that a document written before an
 * instruction existed gets it proposed like any other.
 */
export interface InstructionChoices {
  readonly variant: WithdrawalVariant
  readonly switchedOn: readonly string[]
  readonly switchedOff: readonly string[]
}

/** A document nobody chose anything on: a contract about work, and the proposal. */
export const noInstructionChoices: InstructionChoices = {
  variant: 'service',
  switchedOn: [],
  switchedOff: [],
}

/**
 * An instruction as far as a document needs it. The id is plain text here,
 * because the choices on a document name instructions the same way.
 */
export type InstructionForDocument = Pick<
  Instruction,
  'template' | 'title' | 'body' | 'kinds' | 'consumersOnly' | 'withDocument'
> & { readonly id: string }

/**
 * The choices of one document, as they are kept: one row per document, and
 * only once somebody chose something. A document without a row gets
 * `noInstructionChoices`.
 *
 * The ids in the two lists are not held by a key. An instruction the business
 * deleted leaves its id behind here, where it names nothing and changes
 * nothing, and a document that was issued has its instructions in its
 * snapshot anyway.
 */
export interface DocumentInstructionChoices extends TenantOwned, InstructionChoices {
  readonly id: DocumentInstructionChoicesId
  readonly documentId: DocumentId
}

/**
 * The placeholders an instruction may carry, and what each of them stands for.
 *
 * Four for the business, because the model instruction wants its name, its
 * address, its telephone number and its e-mail address (note 2 to annex 1),
 * and a business that moves should not have to find every instruction it
 * wrote the old address into. They are filled from the letterhead as it
 * stands when the document is issued.
 *
 * Two for the contract, because the model has sentences that depend on what
 * the contract is about (notes 1, 5 and 6). They are filled from the shipped
 * model for the kind of contract chosen on the document, so that an
 * instruction the business rewrote keeps doing the right thing for both.
 */
export const instructionPlaceholders = {
  '{name}': 'der Name des Betriebs aus dem Briefkopf',
  '{anschrift}': 'die Anschrift des Betriebs aus dem Briefkopf',
  '{telefon}': 'die Telefonnummer aus dem Briefkopf',
  '{email}': 'die E-Mail-Adresse aus dem Briefkopf',
  '{fristbeginn}':
    'wann die Widerrufsfrist beginnt, je nachdem, ob der Vertrag Arbeit oder Waren betrifft',
  '{folgen}': 'was mit getaner Arbeit oder gelieferten Waren geschieht, wenn der Kunde widerruft',
} as const

export type InstructionPlaceholder = keyof typeof instructionPlaceholders

/** The two placeholders the kind of contract decides. */
export type ContractBlock = 'fristbeginn' | 'folgen'

/** The sentences one kind of contract puts in for the two contract placeholders. */
export type ContractBlocks = Readonly<Record<ContractBlock, string>>

/** The longest heading an instruction may have. A heading, not a paragraph. */
export const longestInstructionTitle = 200

/**
 * The longest wording an instruction may have. The model instruction is
 * about three thousand characters; a business that writes out its own terms
 * needs more, and this leaves room for a few pages without inviting a manual.
 */
export const longestInstructionBody = 30_000

/**
 * The placeholders written in a text, in the order they first appear, known
 * or not. `{Name}` counts as written and is not one of the known ones.
 */
export function placeholdersIn(text: string): readonly string[] {
  return [...new Set(text.match(/\{[^{}\n]*\}/g) ?? [])]
}

/**
 * The placeholders in a text that are not among the known ones.
 *
 * Refused when the text is saved, not when the first customer reads a
 * sentence with `{adresse}` in it: the same reasoning as for the signature
 * under a mail.
 */
export function unknownInstructionPlaceholders(text: string): readonly string[] {
  return placeholdersIn(text).filter((token) => !(token in instructionPlaceholders))
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === ''
}

/** Whether an address has what a letter needs to arrive: street, postal code and town. */
function addressIsComplete(address: Address): boolean {
  return !blank(address.street) && !blank(address.postalCode) && !blank(address.city)
}

const regions = new Intl.DisplayNames(['de'], { type: 'region' })

/**
 * The address of the business on one line, the way the model instruction has
 * it between the brackets: street and number, then postal code and town, and
 * the country only when it is not Germany.
 */
export function addressLine(address: Address): string {
  const street = [address.street, address.houseNumber].filter((part) => !blank(part)).join(' ')
  const town = [address.postalCode, address.city].filter((part) => !blank(part)).join(' ')
  const country = address.country === 'DE' ? '' : (regions.of(address.country) ?? address.country)

  return [street, town, country].filter((part) => part !== '').join(', ')
}

/**
 * The value of each placeholder for the business, or null where the
 * letterhead has nothing to put in.
 */
function issuerValues(issuer: IssuerContent): Readonly<Record<string, string | null>> {
  return {
    '{name}': blank(issuer.name) ? null : issuer.name.trim(),
    '{anschrift}': addressIsComplete(issuer) ? addressLine(issuer) : null,
    '{telefon}': blank(issuer.phone) ? null : (issuer.phone ?? '').trim(),
    '{email}': blank(issuer.email) ? null : (issuer.email ?? '').trim(),
  }
}

/** What a placeholder is called in a sentence that says it is missing. */
const missingWords: Readonly<Record<string, string>> = {
  '{name}': 'der Name des Betriebs',
  '{anschrift}': 'die vollständige Anschrift des Betriebs mit Straße, Postleitzahl und Ort',
  '{telefon}': 'die Telefonnummer des Betriebs',
  '{email}': 'die E-Mail-Adresse des Betriebs',
}

/**
 * The placeholders of the business that a text uses and the letterhead cannot
 * fill, as sentences for the person issuing.
 *
 * An instruction that says "write to us at" and then nothing is worse than
 * none: the model instruction is only a safe harbour when it is filled in
 * correctly, and note 2 asks for all four. So a document that carries such an
 * instruction is not issued until the letterhead has what it needs, and the
 * sentence says where to add it.
 */
export function unfilledPlaceholders(
  text: string,
  issuer: IssuerContent,
): readonly { readonly placeholder: string; readonly missing: string }[] {
  const values = issuerValues(issuer)

  return placeholdersIn(text)
    .filter((token) => token in values && values[token] === null)
    .map((token) => ({ placeholder: token, missing: missingWords[token] ?? token }))
}

/**
 * An instruction as it is printed: every placeholder replaced.
 *
 * A placeholder of the business without a value is left out, so that the
 * text reads as well as it can; whether that is acceptable is decided before
 * issuing, by `unfilledPlaceholders`, and not here. The contract placeholders
 * come from the shipped model and always have a value.
 *
 * Line endings are made plain, and more than one empty line in a row closes
 * up, the same as under a mail.
 */
export function filledInstruction(
  text: string,
  facts: { readonly issuer: IssuerContent; readonly blocks: ContractBlocks },
): string {
  const values: Readonly<Record<string, string | null>> = {
    ...issuerValues(facts.issuer),
    '{fristbeginn}': facts.blocks.fristbeginn,
    '{folgen}': facts.blocks.folgen,
  }

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\{[^{}\n]*\}/g, (token) => (token in values ? (values[token] ?? '') : token))
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * One piece of an instruction as it is laid out on paper.
 *
 * The markup is small on purpose, because the person writing it runs a trade
 * business and not a website: a line that starts with `# ` is a heading, one
 * that starts with `- ` is a point in a list, a line of three or more
 * underscores is a line to write on, and an empty line ends a paragraph. The
 * form of annex 2 needs all of it, and nothing an instruction needs goes
 * beyond it.
 */
export type InstructionBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'item'; readonly text: string }
  | { readonly kind: 'line' }

/**
 * An instruction in the pieces it is printed as. Lines inside a paragraph
 * stay lines, so an address written over three lines is printed over three.
 */
export function instructionBlocks(text: string): readonly InstructionBlock[] {
  const blocks: InstructionBlock[] = []
  let paragraph: string[] = []

  const close = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
      paragraph = []
    }
  }

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()

    if (line.trim() === '') {
      close()
    } else if (/^#\s+\S/.test(line)) {
      close()
      blocks.push({ kind: 'heading', text: line.replace(/^#\s+/, '') })
    } else if (/^-\s+\S/.test(line)) {
      close()
      blocks.push({ kind: 'item', text: line.replace(/^-\s+/, '') })
    } else if (/^\s*_{3,}\s*$/.test(line)) {
      close()
      blocks.push({ kind: 'line' })
    } else {
      paragraph.push(line)
    }
  }

  close()

  return blocks
}

/**
 * The kinds of document a shipped instruction always goes with when the
 * customer is not a business, whatever anybody switched.
 *
 * The instruction on withdrawal, its form and the notes on when the right
 * ends go with every quote to a consumer: a trade business writes its quotes
 * for the customer's home or sends them by mail, and a quote without them
 * lets the right of withdrawal run for a year and two weeks. An estimate does
 * not need them, it is no offer the customer accepts. Decided by Moritz on
 * 22.09.2026.
 *
 * Not the sheet for an early start. It is needed when a customer wants the
 * work to begin within the fourteen days, and not otherwise.
 */
export const requiredWith: Readonly<Partial<Record<InstructionTemplate, readonly DocumentKind[]>>> =
  {
    withdrawal: ['quote'],
    withdrawal_form: ['quote'],
    withdrawal_notes: ['quote'],
  }

/** The kinds a shipped instruction always goes with, none for one the business wrote. */
export function requiredKinds(template: InstructionTemplate | null): readonly DocumentKind[] {
  return template === null ? [] : (requiredWith[template] ?? [])
}

/**
 * Whether an instruction has to go with a document: a shipped one the law
 * asks for, on a kind it is required with, to a customer who is not a
 * business. A business has no right of withdrawal, so nothing is required
 * for one.
 */
export function requiredFor(
  instruction: Pick<Instruction, 'template'>,
  document: { readonly kind: DocumentKind; readonly recipientIsBusiness: boolean },
): boolean {
  return (
    !document.recipientIsBusiness && requiredKinds(instruction.template).includes(document.kind)
  )
}

/**
 * Whether an instruction is proposed for a document: its kind is among the
 * instruction's, and a customer who is a business is left out where the
 * instruction is only for consumers.
 *
 * A proposal, which the office switches on or off per document, because
 * whether a contract is concluded away from the business premises or at a
 * distance is something the software cannot know. The exception is what
 * `requiredFor` names; that goes with the document either way.
 */
export function proposedFor(
  instruction: Pick<Instruction, 'kinds' | 'consumersOnly'>,
  document: { readonly kind: DocumentKind; readonly recipientIsBusiness: boolean },
): boolean {
  return (
    instruction.kinds.includes(document.kind) &&
    !(instruction.consumersOnly && document.recipientIsBusiness)
  )
}
