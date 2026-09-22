import type {
  DocumentKind,
  InstructionTemplate,
  IsoDate,
  WithdrawalVariant,
} from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * The instructions of the business, as the server keeps them.
 *
 * Read and written straight at the route, like the letterhead. They are kept
 * at a desk, and a document takes a copy of their words when it is issued,
 * which is what travels.
 */

/** A version of a shipped model: from when it applies, and where it is in the law. */
export interface ModelVersion {
  readonly validFrom: IsoDate
  readonly source: string
}

export interface InstructionView {
  readonly id: string
  /** The shipped wording, or null for one the business wrote. */
  readonly template: InstructionTemplate | null
  readonly title: string
  /** The words as they stand today, placeholders and all. */
  readonly body: string
  /** A shipped one whose words the business changed. */
  readonly changed: boolean
  /** The model in force today, for a shipped one. */
  readonly model: (ModelVersion & { readonly text: string }) | null
  /** A version of the model newer than the one a changed wording came from. */
  readonly newerModel: ModelVersion | null
  readonly kinds: readonly DocumentKind[]
  /** The kinds it always goes with, to a customer who is not a business. */
  readonly requiredWith: readonly DocumentKind[]
  readonly consumersOnly: boolean
  readonly withDocument: boolean
  readonly position: number
}

export interface InstructionSettings {
  readonly kinds: readonly DocumentKind[]
  readonly consumersOnly: boolean
  readonly withDocument: boolean
}

export interface InstructionValues extends Partial<InstructionSettings> {
  readonly title?: string
  readonly body?: string
}

const path = '/settings/instructions'

function one(id: string): string {
  return `${path}/${encodeURIComponent(id)}`
}

export function instructions(): Promise<readonly InstructionView[]> {
  return request<readonly InstructionView[]>(path)
}

export function createInstruction(
  values: InstructionSettings & { readonly title: string; readonly body: string },
): Promise<InstructionView> {
  return request<InstructionView>(path, { method: 'POST', body: JSON.stringify(values) })
}

export function updateInstruction(id: string, values: InstructionValues): Promise<InstructionView> {
  return request<InstructionView>(one(id), { method: 'PATCH', body: JSON.stringify(values) })
}

export function restoreInstruction(id: string): Promise<InstructionView> {
  return request<InstructionView>(`${one(id)}/restore`, { method: 'POST' })
}

export function removeInstruction(id: string): Promise<unknown> {
  return request(one(id), { method: 'DELETE' })
}

/** One instruction of the business, and whether it goes with a document. */
export interface InstructionChoice {
  readonly id: string
  readonly title: string
  readonly template: InstructionTemplate | null
  readonly proposed: boolean
  readonly included: boolean
  /** Goes with it whatever anybody chooses. */
  readonly required: boolean
  readonly withDocument: boolean
  readonly changed: boolean
}

/** An instruction the way it is printed with a document; the index names its sheet. */
export interface PrintedInstruction {
  readonly index: number
  readonly title: string
  readonly withDocument: boolean
  readonly changed: boolean
  readonly source: string | null
}

export interface DocumentInstructions {
  /** Nothing left to choose: issued, or signed on site. */
  readonly fixed: boolean
  readonly variant: WithdrawalVariant
  readonly choices: readonly InstructionChoice[]
  readonly printed: readonly PrintedInstruction[]
  /** What stands in the way of issuing with these instructions. */
  readonly gaps: readonly string[]
}

function ofDocument(documentId: string): string {
  return `/documents/${encodeURIComponent(documentId)}/instructions`
}

/**
 * The instructions of a document. Read at the server, which is where the
 * instructions of the business are and where an issued document keeps what
 * went out with it.
 */
export function documentInstructions(documentId: string): Promise<DocumentInstructions> {
  return request<DocumentInstructions>(ofDocument(documentId))
}

/** One choice on a draft: the kind of contract, or one instruction on or off. */
export function chooseInstructions(
  documentId: string,
  choice:
    | { readonly variant: WithdrawalVariant }
    | { readonly instructionId: string; readonly included: boolean },
): Promise<DocumentInstructions> {
  return request<DocumentInstructions>(ofDocument(documentId), {
    method: 'PUT',
    body: JSON.stringify(choice),
  })
}

/** Where one instruction of a document can be opened as a sheet of its own. */
export function instructionSheetAddress(documentId: string, index: number): string {
  return `${ofDocument(documentId)}/${String(index)}/pdf`
}
