import type { NumberRangeKey } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/** One sequence of the business, as the server keeps it. */
export interface NumberRangeView {
  readonly key: NumberRangeKey
  readonly pattern: string
  /** The counter the next document gets. */
  readonly nextValue: number
  /** What the next document would be called, issued now. */
  readonly next: string
}

const path = '/settings/number-ranges'

/**
 * Read at the route like the other settings. A device never numbers a
 * document; the number is handed out on the server, when it is issued.
 */
export function numberRanges(): Promise<readonly NumberRangeView[]> {
  return request<readonly NumberRangeView[]>(path)
}

/**
 * A new pattern, and a new next number when one was typed. Left out, the
 * counter stays where the server has it, which matters: a document issued in
 * the meantime has moved it on, and sending the number the screen loaded
 * would be refused as going back.
 */
export function changeNumberRange(
  key: NumberRangeKey,
  wanted: { readonly pattern: string; readonly nextValue?: number },
): Promise<NumberRangeView> {
  return request<NumberRangeView>(`${path}/${key}`, {
    method: 'PUT',
    body: JSON.stringify(wanted),
  })
}
