import {
  attachmentEntity,
  attachmentTitleOf,
  attachmentVersionEntity,
  fileMediaType,
  fileSizeProblem,
  isPhoto,
  isPicture,
  photoLongEdge,
  photoQuality,
  previewLongEdge,
  previewQuality,
  type RecordState,
} from '@opengewerk/platform-domain'
import { useEffect, useMemo, useState } from 'react'

import { fileSize, moment } from '../format.js'
import { type Draft, refusalFor, type SyncClient } from '../sync/client.js'
import { count, maybeText, text } from '../sync/fields.js'
import { useRecords, useSync } from '../sync/provider.js'
import { workingInHeaders } from '../sync/transport.js'
import { shrinkPicture } from './pictures.js'

/** How a picture is made smaller: as a JPEG, or null when it cannot be decoded. */
export type ShrinkPicture = (
  file: Blob,
  longEdge: number,
  quality: number,
) => Promise<ArrayBuffer | null>

/** How a chosen file is filed. */
export interface FilingOptions {
  /** Keeps a photo at its full size instead of making it smaller. */
  readonly keepOriginal?: boolean
  /**
   * How a picture is made smaller. The canvas of the browser, unless
   * something is put in its place: a browser in a test has no canvas that
   * draws.
   */
  readonly shrink?: ShrinkPicture
  /** What a file is called whose name says nothing. */
  readonly untitled?: string
}

/** A version as it is written, before anything knows its id. */
export interface PreparedVersion {
  readonly sha256: string
  readonly sizeBytes: number
  readonly mediaType: string
  readonly fileName: string
  readonly previewSha256: string | null
}

/**
 * What becomes of one chosen file before anything is queued.
 *
 * A photo is made smaller unless somebody keeps the original, and only when
 * the smaller one really is smaller. Every picture gets a preview, a small
 * JPEG a list can show without fetching the file. Both go into the local
 * store and onto the list of uploads; the size is checked on what is kept,
 * against the same limit the server holds.
 */
export async function prepareVersion(
  client: SyncClient,
  file: File,
  options: FilingOptions = {},
): Promise<PreparedVersion | { readonly problem: string }> {
  const shrink = options.shrink ?? shrinkPicture
  const declared = fileMediaType(file.type)
  let bytes = await file.arrayBuffer()
  let mediaType = declared
  let fileName = file.name

  if (isPhoto(declared) && options.keepOriginal !== true) {
    const smaller = await shrink(file, photoLongEdge, photoQuality)

    if (smaller && smaller.byteLength < bytes.byteLength) {
      bytes = smaller
      mediaType = 'image/jpeg'
      fileName = `${attachmentTitleOf(file.name, options.untitled)}.jpg`
    }
  }

  const problem = fileSizeProblem(bytes.byteLength)

  if (problem) {
    return { problem: `${file.name}: ${problem}` }
  }

  const preview = isPicture(declared) ? await shrink(file, previewLongEdge, previewQuality) : null
  const kept = await client.keepFile(bytes, mediaType)
  const previewKept = preview ? await client.keepFile(preview, 'image/jpeg') : null

  return {
    sha256: kept.sha256,
    sizeBytes: kept.sizeBytes,
    mediaType,
    fileName,
    previewSha256: previewKept?.sha256 ?? null,
  }
}

/**
 * A new file in the records, through the outbox. `own` is what the
 * application says of it: the places it hangs on, taken from the screen it is
 * added on, and whatever else a file of its own carries. The sentence to
 * show, or null when it is queued.
 *
 * It works without a network like everything else that goes through the
 * outbox: the bytes wait on the device and go up ahead of the two records at
 * the next exchange.
 */
export async function addAttachment(
  client: SyncClient,
  own: Draft,
  file: File,
  options: FilingOptions = {},
): Promise<string | null> {
  const prepared = await prepareVersion(client, file, options)

  if ('problem' in prepared) {
    return prepared.problem
  }

  const made = await client.create(attachmentEntity, {
    ...own,
    title: attachmentTitleOf(file.name, options.untitled),
  })

  if (made.outcome === 'refused') {
    return refusalFor(made)
  }

  const version = await client.create(attachmentVersionEntity, {
    attachmentId: made.id,
    ...prepared,
  })

  return version.outcome === 'refused' ? refusalFor(version) : null
}

/**
 * A new version of a file, laid over the ones before it. `own` is what the
 * application writes on a version of its own beside that, if anything.
 */
export async function addVersion(
  client: SyncClient,
  attachmentId: string,
  file: File,
  options: FilingOptions = {},
  own: Draft = {},
): Promise<string | null> {
  const prepared = await prepareVersion(client, file, options)

  if ('problem' in prepared) {
    return prepared.problem
  }

  const version = await client.create(attachmentVersionEntity, {
    ...own,
    attachmentId,
    ...prepared,
  })

  return version.outcome === 'refused' ? refusalFor(version) : null
}

/**
 * The versions of each file, newest first. Ids are UUIDv7 and minted when a
 * version is made, so the newest is the one with the highest id, on a device
 * that has not sent it yet as much as on the server.
 */
export function versionsByAttachment(
  versions: readonly RecordState[],
): ReadonlyMap<string, readonly RecordState[]> {
  const byAttachment = new Map<string, RecordState[]>()

  for (const version of versions) {
    const key = text(version, 'attachmentId')
    const list = byAttachment.get(key) ?? []

    list.push(version)
    byAttachment.set(key, list)
  }

  for (const list of byAttachment.values()) {
    list.sort((left, right) => String(right['id']).localeCompare(String(left['id'])))
  }

  return byAttachment
}

/** The versions of each file as the device holds them, newest first. */
export function useVersions(): ReadonlyMap<string, readonly RecordState[]> {
  const versions = useRecords(attachmentVersionEntity)

  return useMemo(() => versionsByAttachment(versions), [versions])
}

/** Where the server hands out the file of a version, and its preview. */
export function versionPath(versionId: string, which: 'content' | 'preview'): string {
  return `/attachments/versions/${encodeURIComponent(versionId)}/${which}`
}

/**
 * The preview of a version as an address the page can show, or null.
 *
 * From this device when it has the picture, which it does for every photo it
 * took and every preview it fetched before; otherwise fetched once and kept,
 * so that a list opened in a cellar shows the pictures it showed upstairs.
 * The large file is never fetched for this, only when somebody opens it.
 */
export function usePreview(version: RecordState | undefined): string | null {
  const client = useSync()
  const hash = maybeText(version, 'previewSha256')
  const id = version ? String(version['id']) : null
  const [shown, setShown] = useState<{ readonly hash: string; readonly href: string } | null>(null)

  useEffect(() => {
    if (!hash || !id) {
      return undefined
    }

    let live = true
    let made: string | null = null

    void (async () => {
      let file = await client.readFile(hash)

      if (!file && !client.isPending(attachmentVersionEntity, id)) {
        try {
          const response = await fetch(versionPath(id, 'preview'), {
            credentials: 'include',
            headers: workingInHeaders(),
          })

          if (response.ok) {
            const bytes = await response.arrayBuffer()
            const mediaType = response.headers.get('content-type') ?? 'image/jpeg'

            await client.rememberFile(hash, bytes, mediaType)
            file = { sha256: hash, bytes, mediaType }
          }
        } catch {
          // Without a network there is no preview this time. The list still
          // shows the name, and the next time the picture is fetched.
        }
      }

      if (!file || !live) {
        return
      }

      made = URL.createObjectURL(new Blob([file.bytes], { type: file.mediaType }))
      setShown({ hash, href: made })
    })()

    return () => {
      live = false

      if (made) {
        URL.revokeObjectURL(made)
      }
    }
  }, [client, hash, id])

  return shown && shown.hash === hash ? shown.href : null
}

/**
 * Opens a version: from this device when it holds the file, which it does for
 * everything made here and so works without a network, and from the server
 * otherwise. In a new window, from the click that asked for it.
 */
export async function openVersion(client: SyncClient, version: RecordState): Promise<void> {
  const local = await client.readFile(text(version, 'sha256'))

  if (!local) {
    window.open(versionPath(String(version['id']), 'content'), '_blank', 'noopener')

    return
  }

  const href = URL.createObjectURL(new Blob([local.bytes], { type: local.mediaType }))

  window.open(href, '_blank', 'noopener')
  window.setTimeout(() => {
    URL.revokeObjectURL(href)
  }, 60_000)
}

/** The line under a file's name: name, size, version, and whether it is up yet. */
export function versionLine(client: SyncClient, version: RecordState, versions: number): string {
  const parts = [text(version, 'fileName'), fileSize(count(version, 'sizeBytes'))]

  if (versions > 1) {
    parts.push(`Fassung ${String(versions)}`)
  }

  parts.push(
    client.isPending(attachmentVersionEntity, String(version['id']))
      ? 'noch nicht übertragen'
      : moment(maybeText(version, 'createdAt')),
  )

  return parts.join(', ')
}
