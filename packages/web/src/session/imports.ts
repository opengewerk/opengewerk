import type { ArticleImport, ImportCharset, IsoDate } from '@opengewerk/domain'
import { request, RequestRefused, workingInHeaders } from '@opengewerk/platform-web/sync'

/**
 * The imports of a supplier from DATANORM (#297), at the routes of the
 * supplier: the files go up one by one, then the server reads them in the
 * background and keeps a preview until somebody takes it over or throws it
 * away. Only for whoever keeps purchase prices.
 */

const base = (supplierId: string) => `/suppliers/${encodeURIComponent(supplierId)}/imports`

/** The newest imports of a supplier, newest first. */
export function importsOf(supplierId: string): Promise<readonly ArticleImport[]> {
  return request<readonly ArticleImport[]>(base(supplierId))
}

export function importOf(supplierId: string, importId: string): Promise<ArticleImport> {
  return request<ArticleImport>(`${base(supplierId)}/${encodeURIComponent(importId)}`)
}

/** The hash a file is stored under, as the route of the files names it. */
export async function sha256Of(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Stores one file of a delivery and says how far it is, in hundredths. With
 * `XMLHttpRequest` and not `fetch`, which says nothing about a body going up;
 * a catalogue of a wholesaler takes a minute.
 */
export function uploadImportFile(
  supplierId: string,
  sha256: string,
  file: Blob,
  onProgress: (part: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sending = new XMLHttpRequest()

    sending.open('PUT', `${base(supplierId)}/files/${sha256}`)
    sending.withCredentials = true
    sending.setRequestHeader('Content-Type', 'application/octet-stream')
    sending.setRequestHeader('Accept', 'application/json')

    for (const [name, value] of Object.entries(workingInHeaders())) {
      sending.setRequestHeader(name, value)
    }

    sending.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.floor((event.loaded / event.total) * 100))
      }
    }
    sending.onload = () => {
      if (sending.status >= 200 && sending.status < 300) {
        resolve()

        return
      }

      let message = `Der Server hat die Datei abgelehnt (${String(sending.status)}).`

      try {
        const said = (JSON.parse(sending.responseText) as { message?: unknown }).message

        if (typeof said === 'string') {
          message = said
        }
      } catch {
        // The status says enough.
      }

      reject(new RequestRefused(sending.status, message))
    }
    sending.onerror = () => {
      reject(new TypeError('Failed to fetch'))
    }
    sending.send(file)
  })
}

/** Starts reading the uploaded files into a preview. */
export function startImport(
  supplierId: string,
  files: readonly { readonly name: string; readonly sha256: string }[],
): Promise<ArticleImport> {
  return request<ArticleImport>(base(supplierId), {
    method: 'POST',
    body: JSON.stringify({ files }),
  })
}

/** The options of a preview; the server reads the files again. */
export function changeImport(
  supplierId: string,
  importId: string,
  options: { readonly charset?: ImportCharset | null; readonly validFrom?: IsoDate },
): Promise<ArticleImport> {
  return request<ArticleImport>(`${base(supplierId)}/${encodeURIComponent(importId)}`, {
    method: 'PATCH',
    body: JSON.stringify(options),
  })
}

export function applyImport(supplierId: string, importId: string): Promise<ArticleImport> {
  return request<ArticleImport>(`${base(supplierId)}/${encodeURIComponent(importId)}/apply`, {
    method: 'POST',
    body: '{}',
  })
}

export function discardImport(supplierId: string, importId: string): Promise<ArticleImport> {
  return request<ArticleImport>(`${base(supplierId)}/${encodeURIComponent(importId)}/discard`, {
    method: 'POST',
    body: '{}',
  })
}
