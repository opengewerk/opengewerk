import {
  attachmentMediaType,
  attachmentSizeProblem,
  attachmentTitleOf,
  isPhoto,
  isPicture,
  photoLongEdge,
  photoQuality,
  previewLongEdge,
  previewQuality,
  type RecordState,
} from '@opengewerk/domain'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button, IconButton } from '../components/index.js'
import { refusalText, type SyncClient } from '../sync/client.js'
import { count, maybeText, text } from '../sync/fields.js'
import { useRecords, useSync } from '../sync/provider.js'
import { fileSize, moment } from './format.js'
import { shrinkPicture } from './pictures.js'

/**
 * Where a new file hangs (#77): the places of the screen it is added on. A
 * job hands on its customer, site and installation, so that the photo taken
 * there turns up on all of their screens as well.
 */
export interface AttachmentHome {
  readonly customerId?: string | null
  readonly siteId?: string | null
  readonly installationId?: string | null
  readonly jobId?: string | null
}

function placesOf(home: AttachmentHome): Record<string, string> {
  return Object.fromEntries(
    Object.entries(home).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  )
}

/** A version as it is written, before anything knows its id. */
interface Prepared {
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
async function prepare(
  client: SyncClient,
  file: File,
  keepOriginal: boolean,
): Promise<Prepared | { readonly problem: string }> {
  const declared = attachmentMediaType(file.type)
  let bytes = await file.arrayBuffer()
  let mediaType = declared
  let fileName = file.name

  if (isPhoto(declared) && !keepOriginal) {
    const smaller = await shrinkPicture(file, photoLongEdge, photoQuality)

    if (smaller && smaller.byteLength < bytes.byteLength) {
      bytes = smaller
      mediaType = 'image/jpeg'
      fileName = `${attachmentTitleOf(file.name)}.jpg`
    }
  }

  const problem = attachmentSizeProblem(bytes.byteLength)

  if (problem) {
    return { problem: `${file.name}: ${problem}` }
  }

  const preview = isPicture(declared)
    ? await shrinkPicture(file, previewLongEdge, previewQuality)
    : null
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

/** A new file at a place, through the outbox. The sentence to show, or null when it is queued. */
export async function addAttachment(
  client: SyncClient,
  home: AttachmentHome,
  file: File,
  keepOriginal: boolean,
): Promise<string | null> {
  const prepared = await prepare(client, file, keepOriginal)

  if ('problem' in prepared) {
    return prepared.problem
  }

  const made = await client.create('attachments', {
    ...placesOf(home),
    title: attachmentTitleOf(file.name),
  })

  if (made.outcome === 'refused') {
    return refusalText[made.reason]
  }

  const version = await client.create('attachment_versions', {
    attachmentId: made.id,
    ...prepared,
  })

  return version.outcome === 'refused' ? refusalText[version.reason] : null
}

/** A new version of a file, laid over the ones before it. */
export async function addVersion(
  client: SyncClient,
  attachmentId: string,
  file: File,
  keepOriginal: boolean,
): Promise<string | null> {
  const prepared = await prepare(client, file, keepOriginal)

  if ('problem' in prepared) {
    return prepared.problem
  }

  const version = await client.create('attachment_versions', { attachmentId, ...prepared })

  return version.outcome === 'refused' ? refusalText[version.reason] : null
}

/**
 * The versions of each file, newest first. Ids are UUIDv7 and minted when a
 * version is made, so the newest is the one with the highest id, on a device
 * that has not sent it yet as much as on the server.
 */
export function useVersions(): ReadonlyMap<string, readonly RecordState[]> {
  const versions = useRecords('attachment_versions')

  return useMemo(() => {
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
  }, [versions])
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

      if (!file && !client.isPending('attachment_versions', id)) {
        try {
          const response = await fetch(`/attachments/versions/${encodeURIComponent(id)}/preview`, {
            credentials: 'include',
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
    window.open(
      `/attachments/versions/${encodeURIComponent(String(version['id']))}/content`,
      '_blank',
      'noopener',
    )

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
    client.isPending('attachment_versions', String(version['id']))
      ? 'noch nicht übertragen'
      : moment(maybeText(version, 'createdAt')),
  )

  return parts.join(', ')
}

function Preview({
  version,
  title,
}: {
  readonly version: RecordState | undefined
  readonly title: string
}) {
  const href = usePreview(version)

  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-sunken">
      {href ? (
        <img src={href} alt={`Vorschau von ${title}`} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true" className="text-table text-ink-muted">
          {(maybeText(version, 'fileName')?.split('.').pop() ?? 'Datei').slice(0, 4).toUpperCase()}
        </span>
      )}
    </span>
  )
}

/**
 * The files at a place, newest first, with a preview where there is a
 * picture, a way to open each, a new version, and, where `manage` says so,
 * removing one. Removing marks the file as deleted; its versions and bytes
 * stay, which is what the records are for.
 */
export function AttachmentList({
  attachments,
  writes,
  empty,
}: {
  readonly attachments: readonly RecordState[]
  readonly writes: boolean
  readonly empty: string
}) {
  const client = useSync()
  const versions = useVersions()
  const [removing, setRemoving] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const replacing = useRef<HTMLInputElement>(null)
  // Which file the next version is for. A ref and not state: it is read by
  // the handler of the file dialog, which may run before a render would have
  // handed it a new value.
  const replacingFor = useRef<string | null>(null)

  const ordered = useMemo(
    () =>
      [...attachments].sort((left, right) => {
        const newest = (row: RecordState) =>
          String(versions.get(String(row['id']))?.[0]?.['id'] ?? row['id'])

        return newest(right).localeCompare(newest(left))
      }),
    [attachments, versions],
  )

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('attachments', id)

    setTrouble(result.outcome === 'refused' ? refusalText[result.reason] : null)
  }

  async function replace(files: FileList | null) {
    const file = files?.[0]
    const attachmentId = replacingFor.current

    // A dialog closed without a choice is no answer, and the button pressed
    // before it still stands.
    if (!file || !attachmentId) {
      return
    }

    replacingFor.current = null

    setTrouble(await addVersion(client, attachmentId, file, false))
  }

  if (ordered.length === 0) {
    return <p className="text-body text-ink-muted">{empty}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <input
        ref={replacing}
        type="file"
        className="sr-only"
        aria-label="Neue Fassung wählen"
        tabIndex={-1}
        onChange={(event) => {
          void replace(event.target.files)
          event.target.value = ''
        }}
      />

      <ul className="flex flex-col gap-3">
        {ordered.map((attachment) => {
          const id = String(attachment['id'])
          const title = text(attachment, 'title')
          const all = versions.get(id) ?? []
          const [latest, ...earlier] = all

          return (
            <li key={id} className="flex items-start gap-3">
              <Preview version={latest} title={title} />

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-body font-semibold break-words">{title}</span>
                {latest ? (
                  <span className="text-table text-ink-muted">
                    {versionLine(client, latest, all.length)}
                  </span>
                ) : (
                  <span className="text-table text-ink-muted">Die Datei ist noch unterwegs.</span>
                )}

                <span className="flex flex-wrap items-center gap-2">
                  {latest ? (
                    <Button tone="secondary" onClick={() => void openVersion(client, latest)}>
                      Öffnen
                    </Button>
                  ) : null}
                  {writes ? (
                    <Button
                      tone="quiet"
                      onClick={() => {
                        replacingFor.current = id
                        replacing.current?.click()
                      }}
                    >
                      Neue Fassung
                    </Button>
                  ) : null}
                  {writes ? (
                    removing === id ? (
                      <>
                        <Button tone="danger" onClick={() => void remove(id)}>
                          Entfernen
                        </Button>
                        <Button
                          tone="quiet"
                          onClick={() => {
                            setRemoving(null)
                          }}
                        >
                          Behalten
                        </Button>
                      </>
                    ) : (
                      <IconButton
                        label={`${title} entfernen`}
                        title="Entfernen"
                        tone="danger"
                        onClick={() => {
                          setTrouble(null)
                          setRemoving(id)
                        }}
                      >
                        ✕
                      </IconButton>
                    )
                  ) : null}
                </span>

                {earlier.length > 0 ? (
                  <details className="text-table">
                    <summary className="cursor-pointer text-ink-muted">
                      {earlier.length === 1
                        ? 'Eine frühere Fassung'
                        : `${String(earlier.length)} frühere Fassungen`}
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {earlier.map((version, index) => (
                        <li
                          key={String(version['id'])}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span>
                            {`Fassung ${String(earlier.length - index)}: ${text(version, 'fileName')}, ${fileSize(count(version, 'sizeBytes'))}`}
                          </span>
                          <Button tone="quiet" onClick={() => void openVersion(client, version)}>
                            Öffnen
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Adding files at a place. `camera` puts taking a photo first, for the site,
 * where it is the one thing somebody wants from this card; the office picks
 * files from the disk.
 *
 * Several at once, each on its own: a file that is too large is named, and the
 * others are still added.
 */
export function AddFiles({
  home,
  camera = false,
}: {
  readonly home: AttachmentHome
  readonly camera?: boolean
}) {
  const client = useSync()
  const picker = useRef<HTMLInputElement>(null)
  const shooter = useRef<HTMLInputElement>(null)
  const [keepOriginal, setKeepOriginal] = useState(false)
  const [working, setWorking] = useState(false)
  const [problems, setProblems] = useState<readonly string[]>([])

  async function add(files: FileList | null) {
    const chosen = [...(files ?? [])]

    if (chosen.length === 0) {
      return
    }

    setWorking(true)

    const found: string[] = []

    try {
      for (const file of chosen) {
        const problem = await addAttachment(client, home, file, keepOriginal)

        if (problem) {
          found.push(problem)
        }
      }
    } finally {
      setProblems(found)
      setWorking(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {camera ? (
          <Button
            tone="primary"
            wide
            disabled={working}
            onClick={() => {
              shooter.current?.click()
            }}
          >
            Foto aufnehmen
          </Button>
        ) : null}
        <Button
          tone={camera ? 'secondary' : 'primary'}
          wide={camera}
          disabled={working}
          onClick={() => {
            picker.current?.click()
          }}
        >
          {working ? 'Wird abgelegt' : 'Datei hinzufügen'}
        </Button>
      </div>

      <input
        ref={shooter}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Foto aufnehmen"
        onChange={(event) => {
          void add(event.target.files)
          event.target.value = ''
        }}
      />
      <input
        ref={picker}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Datei hinzufügen"
        onChange={(event) => {
          void add(event.target.files)
          event.target.value = ''
        }}
      />

      <label className="flex items-center gap-2 text-table text-ink-muted">
        <input
          type="checkbox"
          checked={keepOriginal}
          onChange={(event) => {
            setKeepOriginal(event.target.checked)
          }}
        />
        Fotos in voller Größe behalten
      </label>

      {problems.map((problem) => (
        <p key={problem} role="alert" className="text-body font-semibold text-conflict">
          {problem}
        </p>
      ))}
    </div>
  )
}
