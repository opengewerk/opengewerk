import type { OfferDecline } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The offers the customer turned down (#841) as the server keeps them: a
 * mark beside the document, which goes to no device.
 */

export type OfferDeclineEntry = OfferDecline & {
  readonly createdAt: string
  readonly updatedAt: string
}

const path = '/offer-declines'

export const offerDeclinesKey = ['offer-declines'] as const

export function offerDeclines(): Promise<readonly OfferDeclineEntry[]> {
  return request<readonly OfferDeclineEntry[]>(path)
}

/** Marks the offer as declined on the day, with a reason or none. */
export function declineOffer(
  documentId: string,
  declinedOn: string,
  reason: string | null,
): Promise<OfferDeclineEntry> {
  return request<OfferDeclineEntry>(`${path}/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    body: JSON.stringify({ declinedOn, reason }),
  })
}

/** Takes the mark back: the customer wants the offer after all. */
export function withdrawDecline(documentId: string): Promise<unknown> {
  return request<unknown>(`${path}/${encodeURIComponent(documentId)}`, { method: 'DELETE' })
}
