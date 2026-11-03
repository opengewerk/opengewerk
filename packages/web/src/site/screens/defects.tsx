import {
  defectDescriptionProblem,
  defectIsOpen,
  defectWarrantyText,
  nextDefectSteps,
  type RecordState,
  remedyDueProblem,
} from '@opengewerk/domain'
import { Button, Field, Panel, SelectField, TextArea } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import {
  SignaturePad,
  SiteActionBar,
  SiteFacts,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import { maybeText, refusalFor, text, useRecord, useSync } from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Camera, Check, ChevronRight, Signature, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { AddFiles, AttachmentList } from '../../app/attachments.js'
import {
  DefectHistory,
  DefectStatusMark,
  recordDefect,
  statusOf,
  takeStep,
  useDefectHome,
  useDefectPhotos,
  useDefectSteps,
  useDefectWarranty,
  useJobDefects,
  useOrigin,
  useStatuses,
  useAuthorName,
} from '../../app/defects.js'
import { noteMoment } from '../../app/job-notes.js'
import { useMay } from '../../app/queries.js'
import { SiteHeader } from '../header.js'

/**
 * Defects on site (#311), as the boards "Auftrag mit Mängeln", "Mangel
 * erfassen", "Mangel in Bearbeitung" and "Mangel abnehmen lassen" draw them:
 * the card at the job, a screen to record one without a network with its
 * photos, and a screen for each defect with its steps, where the customer
 * signs the acceptance of the remedy on the device.
 */

export function newDefectPath(jobId: string): string {
  return `/auftraege/${jobId}/maengel/neu`
}

export function defectPath(jobId: string, defectId: string): string {
  return `/auftraege/${jobId}/maengel/${defectId}`
}

/** The card "Mängel" at a job: each defect with where it stands, the newest first, and recording one. */
export function JobDefects({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const defects = useJobDefects(jobId)
  const statuses = useStatuses(defects)
  const writes = useMay('job.progress')
  const navigate = useNavigate()
  const client = useSync()
  const author = useAuthorName()
  const open = defects.filter((defect) =>
    defectIsOpen(statuses.get(String(defect['id'])) ?? 'reported'),
  ).length

  return (
    <Panel
      title="Mängel"
      action={
        defects.length > 0 ? (
          <span className="text-[14px] text-ink-muted">{`${String(open)} offen`}</span>
        ) : null
      }
    >
      <div className="flex flex-col gap-2">
        {defects.length === 0 ? (
          <SiteText muted>Zu diesem Auftrag gibt es keinen Mangel.</SiteText>
        ) : (
          <ul aria-label="Mängel" className="flex flex-col">
            {defects.map((defect) => {
              const id = String(defect['id'])

              return (
                <li key={id} className="border-b border-row">
                  <Link
                    to={defectPath(jobId, id)}
                    className="flex min-h-14 w-full items-start gap-2.5 py-[9px] text-left text-ink no-underline"
                  >
                    <span className="min-w-0 grow">
                      <span className="block text-[17px] leading-[1.35] font-semibold [overflow-wrap:anywhere]">
                        {text(defect, 'description')}
                      </span>
                      <span className="numeric mt-[3px] block text-[15px] text-ink-muted">
                        <Reported defect={defect} author={author} />
                        {client.isPending('defects', id) ? ', noch nicht übertragen' : ''}
                      </span>
                      <span className="mt-1.5 block">
                        <DefectStatusMark status={statuses.get(id) ?? 'reported'} />
                      </span>
                    </span>
                    <ChevronRight
                      size={20}
                      strokeWidth={2.2}
                      className="mt-1 shrink-0 text-ink-faint"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        {writes ? (
          <Button
            wide
            height={52}
            icon={TriangleAlert}
            onClick={() => {
              void navigate({ to: newDefectPath(jobId) })
            }}
          >
            Mangel erfassen
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}

/** Who reported a defect and when, or the acceptance it is a reservation of. */
function Reported({
  defect,
  author,
}: {
  readonly defect: RecordState
  readonly author: (userId: unknown) => string
}) {
  const origin = useOrigin(defect)

  return (
    <>{origin ?? `${author(defect['createdBy'])}, ${noteMoment(text(defect, 'reportedAt'))}`}</>
  )
}

/** A photo chosen for a defect that is not recorded yet, as a preview. */
function ChosenPhoto({ file, index }: { readonly file: File; readonly index: number }) {
  const href = useMemo(() => URL.createObjectURL(file), [file])

  useEffect(
    () => () => {
      URL.revokeObjectURL(href)
    },
    [href],
  )

  return (
    <img
      src={href}
      alt={`Foto ${String(index + 1)}`}
      className="size-16 rounded-[6px] border border-line object-cover"
    />
  )
}

/**
 * Recording a defect, the board "Mangel erfassen": what is wrong, the
 * installation of the job, the customer's deadline and photos taken here.
 * Everything goes into the outbox with the moment it was recorded; who
 * reported it, the server writes.
 */
export function SiteNewDefectScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const job = useRecord('jobs', jobId)
  const installation = useRecord('installations', maybeText(job, 'installationId') ?? undefined)
  const home = useDefectHome(jobId ?? null, maybeText(job, 'installationId'))
  const [description, setDescription] = useState('')
  // What the form holds once somebody chose; before that, the installation of the job.
  const [chosen, setInstallationId] = useState<string | null | undefined>(undefined)
  const installationId = chosen === undefined ? maybeText(job, 'installationId') : chosen
  const [due, setDue] = useState('')
  const [photos, setPhotos] = useState<readonly File[]>([])
  const [problems, setProblems] = useState<{ description?: string; due?: string }>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const shooter = useRef<HTMLInputElement>(null)
  const formId = useId()

  if (!job || !jobId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen Auftrag hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  function back() {
    void navigate({ to: `/auftraege/${String(jobId)}` })
  }

  async function save(event: FormEvent) {
    event.preventDefault()

    const said = description.trim()
    const found = {
      description: defectDescriptionProblem(said) ?? undefined,
      due: remedyDueProblem(due === '' ? null : due) ?? undefined,
    }

    setProblems(found)

    if (found.description || found.due) {
      return
    }

    setTrouble(null)
    setWorking(true)

    try {
      const { made, problem } = await recordDefect(
        client,
        {
          jobId: String(jobId),
          installationId,
          description: said,
          remedyDueOn: due === '' ? null : due,
        },
        { ...home, installationId: installationId ?? home.installationId },
        photos,
      )

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      if (problem) {
        setTrouble(problem)
      }

      void navigate({ to: defectPath(String(jobId), made.id) })
    } finally {
      setWorking(false)
    }
  }

  const installationName = text(installation, 'designation')

  return (
    <SiteScreen gap={14}>
      <SiteHeader title="Mangel erfassen" sub={text(job, 'designation')} />

      <form
        id={formId}
        className="contents"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <TextArea
          label="Was mangelhaft ist"
          rows={3}
          value={description}
          problem={problems.description}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
        <SelectField
          label="Anlage"
          value={installationId ?? ''}
          options={[
            ...(installationName
              ? [{ value: String(installation?.['id']), label: installationName }]
              : []),
            { value: '', label: 'Keine Anlage' },
          ]}
          hint="Die Anlage des Auftrags. Ohne Anlage steht der Mangel nur am Auftrag."
          onChange={(value) => {
            setInstallationId(value === '' ? null : value)
          }}
        />
        <Field
          label="Frist des Kunden zur Beseitigung"
          type="date"
          value={due}
          problem={problems.due}
          hint="Nur wenn der Kunde eine Frist gesetzt hat. Daraus wird die Frist „Mangel beseitigen“ unter „Fristen“."
          onChange={(event) => {
            setDue(event.target.value)
          }}
        />
      </form>

      <Panel title="Fotos">
        <div className="flex flex-col gap-2.5">
          {photos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {photos.map((file, index) => (
                <ChosenPhoto key={`${file.name}-${String(index)}`} file={file} index={index} />
              ))}
            </div>
          ) : null}
          <input
            ref={shooter}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            aria-label="Foto aufnehmen"
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])]

              setPhotos((before) => [...before, ...chosen])
              event.target.value = ''
            }}
          />
          <Button
            tone="primary"
            wide
            height={52}
            icon={Camera}
            onClick={() => {
              shooter.current?.click()
            }}
          >
            Foto aufnehmen
          </Button>
          <SiteText muted size={15}>
            Die Fotos liegen danach bei den Dateien des Auftrags und gehören zu diesem Mangel.
          </SiteText>
        </div>
      </Panel>

      <SiteText muted size={16}>
        Der Mangel steht mit Ihrem Namen und der Uhrzeit am Auftrag. Das Büro sieht ihn, sobald das
        Gerät Netz hat.
      </SiteText>

      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      <SiteActionBar>
        <Button wide className="flex-1 basis-0" disabled={working} onClick={back}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          form={formId}
          tone="primary"
          wide
          icon={Check}
          className="flex-2 basis-0"
          disabled={working}
        >
          Mangel sichern
        </Button>
      </SiteActionBar>
    </SiteScreen>
  )
}

/**
 * A defect on site: where it stands, what is wrong, its facts, photos and
 * steps, and the next step. A remedied defect shows the acceptance by the
 * customer, signed on the device, and "Doch nicht behoben".
 */
export function SiteDefectScreen() {
  const { defectId } = useParams({ strict: false }) as { defectId?: string }
  const client = useSync()
  const defect = useRecord('defects', defectId)
  const job = useRecord('jobs', maybeText(defect, 'jobId') ?? undefined)
  const installation = useRecord('installations', maybeText(defect, 'installationId') ?? undefined)
  const steps = useDefectSteps(defectId)
  const photos = useDefectPhotos(defectId)
  const origin = useOrigin(defect)
  const warranty = defectWarrantyText(useDefectWarranty(defect))
  const author = useAuthorName()
  const home = useDefectHome(maybeText(defect, 'jobId'), maybeText(defect, 'installationId'))
  const writes = useMay('job.progress')
  const files = useMay('attachment.write')
  const [signer, setSigner] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  if (!defect || !defectId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen Mangel hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  const status = statusOf(steps)
  const next = nextDefectSteps[status]
  const due = maybeText(defect, 'remedyDueOn')

  async function step(to: 'in_progress' | 'resolved' | 'accepted') {
    setTrouble(null)

    if (to === 'accepted' && (signer.trim() === '' || path === null)) {
      setTrouble('Die Abnahme braucht den Namen und die Unterschrift des Kunden.')

      return
    }

    setWorking(true)

    try {
      const taken = await takeStep(
        client,
        String(defectId),
        to,
        to === 'accepted' && path !== null ? { name: signer, path } : null,
      )

      if (taken.outcome === 'refused') {
        setTrouble(refusalFor(taken))
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <SiteScreen gap={12}>
      <SiteHeader
        title="Mangel"
        sub={text(job, 'designation') || text(installation, 'designation')}
      />

      <Panel>
        <div className="flex flex-col gap-3">
          <div>
            <DefectStatusMark status={status} />
          </div>
          <p className="text-[18px] leading-[1.45] font-semibold [overflow-wrap:anywhere]">
            {text(defect, 'description')}
          </p>
          <SiteFacts
            facts={[
              ...(installation
                ? [{ label: 'Anlage', value: text(installation, 'designation') }]
                : []),
              {
                label: 'Gemeldet',
                value:
                  origin ??
                  `${author(defect['createdBy'])}, ${noteMoment(text(defect, 'reportedAt'))}`,
              },
              ...(due ? [{ label: 'Frist des Kunden', value: date(due) }] : []),
              ...(warranty ? [{ label: 'Gewährleistung', value: warranty }] : []),
            ]}
          />
        </div>
      </Panel>

      <Panel title="Fotos">
        <div className="flex flex-col gap-2.5">
          <AttachmentList
            attachments={photos}
            writes={files && status !== 'accepted'}
            empty="Noch kein Foto."
          />
          {files && status !== 'accepted' ? (
            <AddFiles
              home={{ ...home, defectId }}
              camera
              cameraTone="secondary"
              height={48}
              keepChoice={false}
            />
          ) : null}
        </div>
      </Panel>

      <Panel title="Verlauf">
        <DefectHistory defect={defect} steps={steps} origin={origin} />
      </Panel>

      {writes && status === 'resolved' ? (
        <Panel title="Abnahme durch den Kunden">
          <div className="flex flex-col gap-3">
            <SiteText size={16}>
              Mit der Unterschrift bestätigt der Kunde, dass der Mangel beseitigt ist. Danach ändert
              sich der Mangel nicht mehr.
            </SiteText>
            <Field
              label="Name"
              value={signer}
              onChange={(event) => {
                setSigner(event.target.value)
              }}
            />
            <SignaturePad label="Unterschriftsfeld" onChange={setPath} />
          </div>
        </Panel>
      ) : (
        <SiteText muted size={15}>
          {status === 'accepted'
            ? 'Der Mangel ist abgenommen und ändert sich nicht mehr.'
            : 'Jeder Schritt steht mit Name und Uhrzeit im Verlauf und bleibt dort.'}
        </SiteText>
      )}

      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      {writes && next.length > 0 ? (
        <SiteActionBar stacked>
          {status === 'resolved' ? (
            <>
              <Button
                tone="primary"
                wide
                icon={Signature}
                disabled={working}
                onClick={() => void step('accepted')}
              >
                Unterschreiben
              </Button>
              <Button wide height={48} disabled={working} onClick={() => void step('in_progress')}>
                Doch nicht behoben
              </Button>
            </>
          ) : (
            <>
              <Button
                tone="primary"
                wide
                icon={Check}
                disabled={working}
                onClick={() => void step('resolved')}
              >
                Behoben
              </Button>
              {next.includes('in_progress') ? (
                <Button
                  wide
                  height={48}
                  disabled={working}
                  onClick={() => void step('in_progress')}
                >
                  In Bearbeitung
                </Button>
              ) : null}
            </>
          )}
        </SiteActionBar>
      ) : null}
    </SiteScreen>
  )
}
