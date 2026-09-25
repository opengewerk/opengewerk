import type { RecordState } from '@opengewerk/domain'
import { Image, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Button, Confirm, Panel } from '../../components/index.js'
import {
  addAttachment,
  addVersion,
  type AttachmentHome,
  openVersion,
  usePreview,
  useVersions,
  versionLine,
} from '../../app/attachments.js'
import { useMay } from '../../app/queries.js'
import { refusalFor } from '../../sync/client.js'
import { count, maybeText, text } from '../../sync/fields.js'
import { useRelated, useSync } from '../../sync/provider.js'
import { fileSize } from '../../app/format.js'

/**
 * The files at a customer, a site, an installation or a job, on its screen in
 * the office (#77), as `files_card()` of the canvas draws them (#219): a row
 * per file with its picture or its kind, "Öffnen" and "Neue Fassung" beside
 * it and the cross to remove it, "Datei hinzufügen" in the head of the card.
 *
 * `field` and `id` say which files are listed, `home` where a new one hangs:
 * at a job that is the job and everything the job is about, so the plan added
 * there is found at its installation later as well.
 */
export function FilesPanel({
  field,
  id,
  home,
  empty,
}: {
  readonly field: 'customerId' | 'siteId' | 'installationId' | 'jobId'
  readonly id: string
  readonly home: AttachmentHome
  readonly empty: string
}) {
  const reads = useMay('attachment.read')
  const writes = useMay('attachment.write')
  const client = useSync()
  const attachments = useRelated('attachments', field, id)
  const versions = useVersions()
  const picker = useRef<HTMLInputElement>(null)
  const replacing = useRef<HTMLInputElement>(null)
  // Which file the next version is for. A ref and not state: it is read by the
  // handler of the file dialog, which may run before a render would have
  // handed it a new value.
  const replacingFor = useRef<string | null>(null)
  const [keepOriginal, setKeepOriginal] = useState(false)
  const [working, setWorking] = useState(false)
  const [problems, setProblems] = useState<readonly string[]>([])
  const [removing, setRemoving] = useState<{ readonly id: string; readonly title: string } | null>(
    null,
  )

  const ordered = useMemo(
    () =>
      [...attachments].sort((left, right) => {
        const newest = (row: RecordState) =>
          String(versions.get(String(row['id']))?.[0]?.['id'] ?? row['id'])

        return newest(right).localeCompare(newest(left))
      }),
    [attachments, versions],
  )

  if (!reads) {
    return null
  }

  /** Several at once, each on its own: a file that is too large is named, the rest go on. */
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

  async function replace(files: FileList | null) {
    const file = files?.[0]
    const attachmentId = replacingFor.current

    // A dialog closed without a choice is no answer, and the button pressed
    // before it still stands.
    if (!file || !attachmentId) {
      return
    }

    replacingFor.current = null

    const problem = await addVersion(client, attachmentId, file, keepOriginal)

    setProblems(problem ? [problem] : [])
  }

  async function remove(attachmentId: string) {
    setRemoving(null)

    const result = await client.remove('attachments', attachmentId)

    setProblems(result.outcome === 'refused' ? [refusalFor(result)] : [])
  }

  return (
    <Panel
      title="Dateien"
      action={
        writes ? (
          <Button
            size="small"
            icon={Upload}
            disabled={working}
            onClick={() => {
              picker.current?.click()
            }}
          >
            {working ? 'Wird abgelegt' : 'Datei hinzufügen'}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-2.5">
        {problems.map((problem) => (
          <p key={problem} role="alert" className="text-[13px] font-semibold text-conflict">
            {problem}
          </p>
        ))}

        {ordered.length === 0 ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">{empty}</p>
        ) : (
          <ul>
            {ordered.map((attachment) => {
              const attachmentId = String(attachment['id'])
              const title = text(attachment, 'title')
              const all = versions.get(attachmentId) ?? []
              const [latest, ...earlier] = all

              return (
                <li
                  key={attachmentId}
                  className="flex flex-wrap items-center gap-3 border-b border-row py-2"
                >
                  <FilePreview version={latest} title={title} />
                  <div className="min-w-0 grow basis-40">
                    <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{title}</div>
                    <div className="text-[13px] text-ink-faint">
                      {latest
                        ? versionLine(client, latest, all.length)
                        : 'Die Datei ist noch unterwegs.'}
                    </div>
                    {earlier.length > 0 ? (
                      <details className="text-[13px]">
                        <summary className="cursor-pointer text-ink-muted">
                          {earlier.length === 1
                            ? 'Eine frühere Fassung'
                            : `${String(earlier.length)} frühere Fassungen`}
                        </summary>
                        <ul className="mt-1 flex flex-col gap-1">
                          {earlier.map((version, index) => (
                            <li
                              key={String(version['id'])}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span>
                                {`Fassung ${String(earlier.length - index)}: ${text(version, 'fileName')}, ${fileSize(count(version, 'sizeBytes'))}`}
                              </span>
                              <Button
                                size="small"
                                onClick={() => void openVersion(client, version)}
                              >
                                Öffnen
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {latest ? (
                      <Button size="small" onClick={() => void openVersion(client, latest)}>
                        Öffnen
                      </Button>
                    ) : null}
                    {writes ? (
                      <Button
                        size="small"
                        onClick={() => {
                          replacingFor.current = attachmentId
                          replacing.current?.click()
                        }}
                      >
                        Neue Fassung
                      </Button>
                    ) : null}
                    {writes ? (
                      <button
                        type="button"
                        aria-label={`${title} entfernen`}
                        title="Entfernen"
                        onClick={() => {
                          setProblems([])
                          setRemoving({ id: attachmentId, title })
                        }}
                        className="flex size-7 cursor-pointer items-center justify-center rounded-control text-conflict max-lg:size-tap"
                      >
                        <X size={15} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {writes ? (
          <label className="flex items-start gap-[9px] text-[14px] leading-[1.4] text-ink">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(event) => {
                setKeepOriginal(event.target.checked)
              }}
              className="mt-0.5 size-4 shrink-0 accent-copper-solid"
            />
            Fotos in voller Größe behalten
          </label>
        ) : null}
      </div>

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
      <input
        ref={replacing}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Neue Fassung wählen"
        onChange={(event) => {
          void replace(event.target.files)
          event.target.value = ''
        }}
      />

      <Confirm
        open={removing !== null}
        title={`„${removing?.title ?? 'Datei'}“ entfernen?`}
        confirm="Entfernen"
        onConfirm={() => {
          if (removing) {
            void remove(removing.id)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        Die Datei verschwindet hier und überall, wo sie sonst noch hängt. Ihre Fassungen bleiben
        gespeichert.
      </Confirm>
    </Panel>
  )
}

/** The picture of a file, or its kind in capitals where it has none, 48 pixels square. */
function FilePreview({
  version,
  title,
}: {
  readonly version: RecordState | undefined
  readonly title: string
}) {
  const href = usePreview(version)
  const kind = (maybeText(version, 'fileName')?.split('.').pop() ?? '').slice(0, 4).toUpperCase()
  const picture = maybeText(version, 'previewSha256') !== null

  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-sunken text-ink-faint">
      {href ? (
        <img src={href} alt={`Vorschau von ${title}`} className="size-full object-cover" />
      ) : picture || !kind ? (
        <Image size={20} strokeWidth={1.9} aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className="font-condensed text-[13px] font-semibold text-ink-muted"
        >
          {kind}
        </span>
      )}
    </span>
  )
}

/** The name the screens use until each of them is rebuilt after its template. */
export const AttachmentsSection = FilesPanel
