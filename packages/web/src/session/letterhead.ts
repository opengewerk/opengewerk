import type { LetterheadField } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * The letterhead of the business, as the server keeps it.
 *
 * Read and written straight at the route, like the other settings. It is not a
 * record a device carries into a cellar: a document is printed on the server,
 * and the letterhead is only ever changed at a desk.
 */
export type LetterheadView = Readonly<Record<LetterheadField, string | null>> & {
  /**
   * The name of the business, as the top bar and the choice of business show
   * it, and printed when the name for the documents is empty (#276).
   */
  readonly businessName: string
  readonly logo: { readonly mediaType: string; readonly sizeBytes: number } | null
}

const path = '/settings/letterhead'

/** Where the logo can be looked at, for an `<img>` on the settings screen. */
export const logoAddress = `${path}/logo`

export function letterhead(): Promise<LetterheadView> {
  return request<LetterheadView>(path)
}

/** The whole letterhead, and the name of the business that goes with it. */
export function saveLetterhead(
  values: Readonly<Record<LetterheadField, string>>,
  businessName: string,
): Promise<LetterheadView> {
  return request<LetterheadView>(path, {
    method: 'PUT',
    body: JSON.stringify({ ...values, businessName }),
  })
}

/**
 * Sends the logo as the image it is. The server reads PNG and JPEG from the
 * bytes and refuses anything else, whatever the type says.
 */
export function uploadLogo(file: Blob): Promise<LetterheadView> {
  return request<LetterheadView>(logoAddress, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
}

export function removeLogo(): Promise<LetterheadView> {
  return request<LetterheadView>(logoAddress, { method: 'DELETE' })
}
