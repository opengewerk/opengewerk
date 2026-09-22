import type { DocumentKind, InstructionTemplate, IsoDate } from '@opengewerk/domain'

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
