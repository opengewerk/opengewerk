import {
  berlinClock,
  defectDescriptionProblem,
  defectWarrantyText,
  nextDefectSteps,
  type RecordState,
  remedyDueProblem,
} from '@opengewerk/domain'
import {
  Button,
  Cell,
  Column,
  Confirm,
  Field,
  Panel,
  SelectField,
  TablePanel,
  TextArea,
  cardLink,
} from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  FactList,
  PageHead,
  RecordColumns,
  Screen,
} from '@opengewerk/platform-web/office'
import {
  maybeText,
  refusalFor,
  text,
  useRecord,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, Eye, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { AddFiles, AttachmentList } from '../../app/attachments.js'
import {
  DefectHistory,
  DefectStatusMark,
  defectReportAddress,
  recordDefect,
  statusOf,
  takeStep,
  useAuthorName,
  useDefectHome,
  useDefectPhotos,
  useDefectSteps,
  useDefectWarranty,
  useInstallationDefects,
  useJobDefects,
  useOrigin,
  useStatuses,
  useWarrantyWindow,
} from '../../app/defects.js'
import { useMay } from '../../app/queries.js'

/**
 * Defects and complaints in the office (#311), as the boards "Auftrag mit
 * Mängeln", "Auftrag: Mangel erfassen", "Reklamation in der Gewährleistung"
 * and "Anlage mit Mängeln und Reklamationen" draw them: the card at a job with
 * the report, the card at an installation with whether each lies within the
 * warranty, and a page for each defect with its photos and steps. The
 * acceptance by the customer is signed on the device; the office takes the
 * other steps.
 */

const link =
  'inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap'

function defectAddress(defectId: string): string {
  return `/maengel/${defectId}`
}

/** The first line of a defect, which names it in a table and over its page. */
function headline(defect: RecordState): string {
  return text(defect, 'description').split('\n')[0] ?? ''
}

function reportedOn(defect: RecordState): string {
  return date(berlinClock(new Date(text(defect, 'reportedAt'))).day)
}

/** A new defect or complaint in its card: what is wrong, the installation where a job has one, the deadline. */
function NewDefectForm({
  jobId,
  installationId,
  choose,
  onDone,
}: {
  readonly jobId: string | null
  readonly installationId: string | null
  /** Whether the installation of a job may be left off. */
  readonly choose: boolean
  readonly onDone: () => void
}) {
  const client = useSync()
  const installation = useRecord('installations', installationId ?? undefined)
  const home = useDefectHome(jobId, installationId)
  const [description, setDescription] = useState('')
  const [onInstallation, setOnInstallation] = useState(installationId)
  const [due, setDue] = useState('')
  const [problems, setProblems] = useState<{ description?: string; due?: string }>({})
  const [trouble, setTrouble] = useState<string | null>(null)

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

    const { made } = await recordDefect(
      client,
      {
        jobId,
        installationId: onInstallation,
        description: said,
        remedyDueOn: due === '' ? null : due,
      },
      home,
      [],
    )

    if (made.outcome === 'refused') {
      setTrouble(refusalFor(made))

      return
    }

    onDone()
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <p className="text-[14px] font-semibold">{jobId ? 'Neuer Mangel' : 'Neue Reklamation'}</p>
      <TextArea
        label="Was mangelhaft ist"
        starred
        rows={3}
        value={description}
        problem={problems.description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {choose && installation ? (
          <SelectField
            label="Anlage"
            value={onInstallation ?? ''}
            options={[
              { value: String(installation['id']), label: text(installation, 'designation') },
              { value: '', label: 'Keine Anlage' },
            ]}
            hint="Ohne Anlage steht der Mangel nur am Auftrag."
            onChange={(value) => {
              setOnInstallation(value === '' ? null : value)
            }}
          />
        ) : null}
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
      </div>
      <p className="text-[13px] leading-[1.4] text-ink-muted">
        Fotos kommen am Mangel dazu, aus den Dateien des Auftrags oder neu.
      </p>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Abbrechen</Button>
        <Button type="submit" tone="primary" icon={Check}>
          {jobId ? 'Mangel sichern' : 'Reklamation sichern'}
        </Button>
      </div>
    </form>
  )
}

/** The card "Mängel" of a job, with recording one and the report. */
export function JobDefectsSection({ jobId }: { readonly jobId: string }) {
  const job = useRecord('jobs', jobId)
  const defects = useJobDefects(jobId)
  const statuses = useStatuses(defects)
  const writes = useMay('job.progress')
  const { online } = useSyncStatus()
  const [adding, setAdding] = useState(false)
  const names = useInstallationNames()

  return (
    <TablePanel
      title="Mängel"
      caption="Mängel"
      action={
        <div className="flex flex-wrap gap-1.5">
          {online && defects.length > 0 ? (
            <a
              href={defectReportAddress(jobId)}
              target="_blank"
              rel="noopener noreferrer"
              className={link}
            >
              <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
              Mängelbericht
            </a>
          ) : (
            <span className={`${link} text-ink-faint`} aria-disabled="true">
              <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
              Mängelbericht
            </span>
          )}
          {writes ? (
            <Button
              icon={Plus}
              disabled={adding}
              onClick={() => {
                setAdding(true)
              }}
            >
              Mangel erfassen
            </Button>
          ) : null}
        </div>
      }
      lead={
        adding ? (
          <NewDefectForm
            jobId={jobId}
            installationId={maybeText(job, 'installationId')}
            choose
            onDone={() => {
              setAdding(false)
            }}
          />
        ) : null
      }
      cards={defects.map((defect) => ({
        key: String(defect['id']),
        title: (
          <Link to={defectAddress(String(defect['id']))} className={cardLink}>
            {headline(defect)}
          </Link>
        ),
        sub: [
          names.get(text(defect, 'installationId')),
          reportedOn(defect),
          maybeText(defect, 'remedyDueOn') ? `Frist ${date(text(defect, 'remedyDueOn'))}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        right: <DefectStatusMark status={statuses.get(String(defect['id'])) ?? 'reported'} />,
      }))}
      cardsEmpty={
        <p className="px-3.5 py-3 text-[13px] text-ink-muted">
          Zu diesem Auftrag gibt es keinen Mangel.
        </p>
      }
      note="Mit der Unterschrift des Kunden auf dem Gerät ist ein Mangel abgenommen; ohne bleibt er „behoben“."
    >
      <thead>
        <tr>
          <Column>Mangel</Column>
          <Column className="w-[130px]">Anlage</Column>
          <Column className="w-[100px]">Gemeldet</Column>
          <Column className="w-[96px]">Frist</Column>
          <Column className="w-[136px]">Status</Column>
        </tr>
      </thead>
      <tbody>
        {defects.length === 0 ? (
          <tr>
            <Cell colSpan={5} className="text-ink-muted">
              Zu diesem Auftrag gibt es keinen Mangel.
            </Cell>
          </tr>
        ) : (
          defects.map((defect) => (
            <tr key={String(defect['id'])}>
              <Cell>
                <Link
                  to={defectAddress(String(defect['id']))}
                  className="font-medium text-copper-text underline underline-offset-2 [overflow-wrap:anywhere]"
                >
                  {headline(defect)}
                </Link>
                {maybeText(defect, 'acceptanceRecordId') ? (
                  <span className="mt-0.5 block text-[12px] text-ink-faint">
                    Vorbehalt der Abnahme
                  </span>
                ) : null}
              </Cell>
              <Cell>{names.get(text(defect, 'installationId')) ?? ''}</Cell>
              <Cell numeric>{reportedOn(defect)}</Cell>
              <Cell numeric>
                {maybeText(defect, 'remedyDueOn') ? date(text(defect, 'remedyDueOn')) : ''}
              </Cell>
              <Cell>
                <DefectStatusMark status={statuses.get(String(defect['id'])) ?? 'reported'} />
              </Cell>
            </tr>
          ))
        )}
      </tbody>
    </TablePanel>
  )
}

/** The names of the installations the device holds, by id. */
function useInstallationNames(): ReadonlyMap<string, string> {
  const installations = useRecords('installations')

  return useMemo(
    () =>
      new Map(
        installations.map((installation) => [
          String(installation['id']),
          text(installation, 'designation'),
        ]),
      ),
    [installations],
  )
}

/** What the card at an installation says about the warranty of one: within, after, before the acceptance. */
function WarrantyCell({ defect }: { readonly defect: RecordState }) {
  const warranty = useDefectWarranty(defect)

  if (warranty === null) {
    return null
  }

  return (
    <>
      {warranty.kind === 'before_acceptance'
        ? 'vor der Abnahme'
        : warranty.kind === 'within'
          ? 'in der Gewährleistung'
          : 'nach der Gewährleistung'}
    </>
  )
}

function JobName({ jobId }: { readonly jobId: string | null }) {
  const job = useRecord('jobs', jobId ?? undefined)

  return job ? (
    <Link
      to={`/auftraege/${String(job['id'])}`}
      className="text-copper-text underline underline-offset-2"
    >
      {text(job, 'designation')}
    </Link>
  ) : null
}

/** The card "Mängel und Reklamationen" of an installation, with recording a complaint. */
export function InstallationDefectsSection({
  installationId,
}: {
  readonly installationId: string
}) {
  const defects = useInstallationDefects(installationId)
  const statuses = useStatuses(defects)
  const writes = useMay('job.progress')
  const window = useWarrantyWindow(undefined, installationId)
  const [adding, setAdding] = useState(false)

  return (
    <TablePanel
      title="Mängel und Reklamationen"
      caption="Mängel und Reklamationen"
      action={
        writes ? (
          <Button
            icon={Plus}
            disabled={adding}
            onClick={() => {
              setAdding(true)
            }}
          >
            Reklamation erfassen
          </Button>
        ) : null
      }
      lead={
        adding ? (
          <NewDefectForm
            jobId={null}
            installationId={installationId}
            choose={false}
            onDone={() => {
              setAdding(false)
            }}
          />
        ) : null
      }
      cards={defects.map((defect) => ({
        key: String(defect['id']),
        title: (
          <Link to={defectAddress(String(defect['id']))} className={cardLink}>
            {headline(defect)}
          </Link>
        ),
        sub: (
          <>
            {reportedOn(defect)}
            {' · '}
            <WarrantyCell defect={defect} />
          </>
        ),
        right: <DefectStatusMark status={statuses.get(String(defect['id'])) ?? 'reported'} />,
      }))}
      cardsEmpty={
        <p className="px-3.5 py-3 text-[13px] text-ink-muted">
          An dieser Anlage gibt es keinen Mangel.
        </p>
      }
      note={
        window
          ? `Die Gewährleistung der Anlage läuft bis ${date(window.endsOn)}${window.acceptedOn ? `, aus der Abnahme vom ${date(window.acceptedOn)}` : ''}. Maßgeblich ist der Tag der Meldung.`
          : 'Für die Anlage ist keine Gewährleistung bekannt: keine Abnahme eines Auftrags an ihr und kein eingetragenes Ende.'
      }
    >
      <thead>
        <tr>
          <Column>Mangel</Column>
          <Column className="w-[130px]">Auftrag</Column>
          <Column className="w-[90px]">Gemeldet</Column>
          <Column className="w-[140px]">Gewährleistung</Column>
          <Column className="w-[130px]">Status</Column>
        </tr>
      </thead>
      <tbody>
        {defects.length === 0 ? (
          <tr>
            <Cell colSpan={5} className="text-ink-muted">
              An dieser Anlage gibt es keinen Mangel.
            </Cell>
          </tr>
        ) : (
          defects.map((defect) => (
            <tr key={String(defect['id'])}>
              <Cell>
                <Link
                  to={defectAddress(String(defect['id']))}
                  className="font-medium text-copper-text underline underline-offset-2 [overflow-wrap:anywhere]"
                >
                  {headline(defect)}
                </Link>
                {maybeText(defect, 'acceptanceRecordId') ? (
                  <span className="mt-0.5 block text-[12px] text-ink-faint">
                    Vorbehalt der Abnahme
                  </span>
                ) : null}
              </Cell>
              <Cell>
                <JobName jobId={maybeText(defect, 'jobId')} />
              </Cell>
              <Cell numeric>{reportedOn(defect)}</Cell>
              <Cell>
                <WarrantyCell defect={defect} />
              </Cell>
              <Cell>
                <DefectStatusMark status={statuses.get(String(defect['id'])) ?? 'reported'} />
              </Cell>
            </tr>
          ))
        )}
      </tbody>
    </TablePanel>
  )
}

/** The facts of a defect corrected in its card: what is wrong and the customer's deadline. */
function DefectForm({
  defect,
  onDone,
}: {
  readonly defect: RecordState
  readonly onDone: () => void
}) {
  const client = useSync()
  const [description, setDescription] = useState(text(defect, 'description'))
  const [due, setDue] = useState(text(defect, 'remedyDueOn'))
  const [problems, setProblems] = useState<{ description?: string; due?: string }>({})
  const [trouble, setTrouble] = useState<string | null>(null)

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

    const changed = await client.update('defects', String(defect['id']), {
      description: said,
      remedyDueOn: due === '' ? null : due,
    })

    if (changed.outcome === 'refused') {
      setTrouble(refusalFor(changed))

      return
    }

    onDone()
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <TextArea
        label="Was mangelhaft ist"
        starred
        rows={3}
        value={description}
        problem={problems.description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      <Field
        label="Frist des Kunden zur Beseitigung"
        type="date"
        value={due}
        problem={problems.due}
        onChange={(event) => {
          setDue(event.target.value)
        }}
      />
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-row pt-2.5">
        <Button onClick={onDone}>Abbrechen</Button>
        <Button type="submit" tone="primary" icon={Check}>
          Speichern
        </Button>
      </div>
    </form>
  )
}

/** A defect or complaint in the office: whether it lies within the warranty, its facts, photos and steps. */
export function DefectScreen() {
  const { defectId } = useParams({ strict: false }) as { defectId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const defect = useRecord('defects', defectId)
  const job = useRecord('jobs', maybeText(defect, 'jobId') ?? undefined)
  const installation = useRecord('installations', maybeText(defect, 'installationId') ?? undefined)
  const site = useRecord('sites', maybeText(installation, 'siteId') ?? undefined)
  const customer = useRecord('customers', maybeText(job, 'customerId') ?? undefined)
  const steps = useDefectSteps(defectId)
  const photos = useDefectPhotos(defectId)
  const origin = useOrigin(defect)
  const warranty = useDefectWarranty(defect)
  const window = useWarrantyWindow(
    maybeText(defect, 'jobId') ?? undefined,
    maybeText(defect, 'installationId') ?? undefined,
  )
  const author = useAuthorName()
  const home = useDefectHome(maybeText(defect, 'jobId'), maybeText(defect, 'installationId'))
  const writes = useMay('job.progress')
  // Correcting and removing ask for the right on the job itself (#311).
  const corrects = useMay('job.write')
  const files = useMay('attachment.write')
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!defect || !defectId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/auftraege', label: 'Aufträge' }]} />
      </Screen>
    )
  }

  const status = statusOf(steps)
  const next = nextDefectSteps[status]
  const removable = status === 'reported' && !maybeText(defect, 'acceptanceRecordId')
  const due = maybeText(defect, 'remedyDueOn')
  const warrantyText = defectWarrantyText(warranty)

  async function step(to: 'in_progress' | 'resolved') {
    setTrouble(null)

    const taken = await takeStep(client, String(defectId), to)

    if (taken.outcome === 'refused') {
      setTrouble(refusalFor(taken))
    }
  }

  return (
    <Screen>
      <PageHead
        title={headline(defect)}
        crumbs={
          job
            ? [
                { to: '/auftraege', label: 'Aufträge' },
                ...(customer
                  ? [{ to: `/kunden/${String(customer['id'])}`, label: text(customer, 'name') }]
                  : []),
                { to: `/auftraege/${String(job['id'])}`, label: text(job, 'designation') },
              ]
            : [
                { to: '/anlagen', label: 'Anlagen' },
                ...(installation
                  ? [
                      {
                        to: `/anlagen/${String(installation['id'])}`,
                        label: text(installation, 'designation'),
                      },
                    ]
                  : []),
              ]
        }
        badges={<DefectStatusMark status={status} />}
        actions={
          <>
            <ChangesButton table="defects" id={defectId} />
            {corrects && status !== 'accepted' ? (
              <Button
                icon={Pencil}
                disabled={editing}
                onClick={() => {
                  setEditing(true)
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
            {corrects && removable ? (
              <Button
                icon={Trash2}
                onClick={() => {
                  setRemoving(true)
                }}
              >
                Entfernen
              </Button>
            ) : null}
            {writes && next.includes('in_progress') && status === 'reported' ? (
              <Button onClick={() => void step('in_progress')}>In Bearbeitung</Button>
            ) : null}
            {writes && status === 'resolved' ? (
              <Button onClick={() => void step('in_progress')}>Doch nicht behoben</Button>
            ) : null}
            {writes && next.includes('resolved') ? (
              <Button tone="primary" icon={Check} onClick={() => void step('resolved')}>
                Behoben
              </Button>
            ) : null}
          </>
        }
      />

      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <RecordColumns
        main={
          <>
            <Panel title="Mangel">
              {editing ? (
                <DefectForm
                  defect={defect}
                  onDone={() => {
                    setEditing(false)
                  }}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {warranty && warranty.kind !== 'before_acceptance' && window ? (
                    <div
                      className={
                        warranty.kind === 'within'
                          ? 'flex gap-2.5 rounded-[6px] border border-l-4 border-done-edge border-l-done bg-done-fill px-3 py-2.5'
                          : 'flex gap-2.5 rounded-[6px] border border-l-4 border-conflict-edge border-l-conflict bg-conflict-fill px-3 py-2.5'
                      }
                    >
                      <ShieldCheck
                        size={18}
                        strokeWidth={2.2}
                        aria-hidden="true"
                        className="mt-px shrink-0"
                      />
                      <p className="text-[14px] leading-[1.45]">
                        <b>
                          {warranty.kind === 'within'
                            ? 'In der Gewährleistung.'
                            : 'Nach der Gewährleistung.'}
                        </b>
                        {` Gemeldet am ${reportedOn(defect)}, die Gewährleistung ${warranty.kind === 'within' ? 'läuft bis' : 'endete am'} ${date(window.endsOn)}${window.acceptedOn ? `, aus der Abnahme vom ${date(window.acceptedOn)}` : ''}.`}
                      </p>
                    </div>
                  ) : null}
                  {/* The rest of a description the heading shows the first line of. */}
                  {text(defect, 'description') !== headline(defect) ? (
                    <p className="text-[14px] leading-[1.45] whitespace-pre-line [overflow-wrap:anywhere]">
                      {text(defect, 'description')}
                    </p>
                  ) : null}
                  <FactList
                    facts={[
                      ...(installation
                        ? [
                            {
                              label: 'Anlage',
                              value: (
                                <Link
                                  to={`/anlagen/${String(installation['id'])}`}
                                  className="text-copper-text underline underline-offset-2"
                                >
                                  {text(installation, 'designation')}
                                </Link>
                              ),
                            },
                          ]
                        : []),
                      ...(job
                        ? [{ label: 'Auftrag', value: <JobName jobId={String(job['id'])} /> }]
                        : []),
                      {
                        label: 'Gemeldet',
                        value: origin ?? `${author(defect['createdBy'])}, ${reportedOn(defect)}`,
                      },
                      ...(due
                        ? [
                            {
                              label: 'Frist des Kunden',
                              value: `${date(due)}, steht unter „Fristen“`,
                            },
                          ]
                        : []),
                      ...(warrantyText && !window
                        ? [{ label: 'Gewährleistung', value: warrantyText }]
                        : []),
                    ]}
                  />
                </div>
              )}
            </Panel>
            <Panel title="Fotos">
              <div className="flex flex-col gap-2.5">
                <AttachmentList
                  attachments={photos}
                  writes={files && status !== 'accepted'}
                  empty="Noch kein Foto."
                />
                {files && status !== 'accepted' ? (
                  <AddFiles home={{ ...home, defectId }} keepChoice={false} />
                ) : null}
              </div>
            </Panel>
            <Panel title="Verlauf">
              <DefectHistory defect={defect} steps={steps} origin={origin} />
              <p className="mt-2 text-[13px] leading-[1.4] text-ink-muted">
                Jeder Schritt steht mit Name und Uhrzeit im Verlauf und bleibt dort. Abgenommen wird
                auf dem Gerät mit der Unterschrift des Kunden.
              </p>
            </Panel>
          </>
        }
        side={
          installation ? (
            <Panel title="Anlage">
              <FactList
                facts={[
                  ...(site
                    ? [
                        {
                          label: 'Objekt',
                          value: (
                            <Link
                              to={`/objekte/${String(site['id'])}`}
                              className="text-copper-text underline underline-offset-2"
                            >
                              {text(site, 'designation')}
                            </Link>
                          ),
                        },
                      ]
                    : []),
                  { label: 'Hersteller', value: text(installation, 'manufacturer') },
                  { label: 'Typ', value: text(installation, 'model') },
                  ...(window
                    ? [{ label: 'Gewährleistung', value: `bis ${date(window.endsOn)}` }]
                    : []),
                  ...(maybeText(installation, 'manufacturerWarrantyEndsOn')
                    ? [
                        {
                          label: 'Herstellergarantie',
                          value: `bis ${date(text(installation, 'manufacturerWarrantyEndsOn'))}`,
                        },
                      ]
                    : []),
                ].filter((fact) => fact.value !== '')}
              />
            </Panel>
          ) : null
        }
      />

      <Confirm
        open={removing}
        title="Mangel entfernen?"
        confirm="Entfernen"
        onCancel={() => {
          setRemoving(false)
        }}
        onConfirm={() => {
          void client.remove('defects', String(defectId)).then((removed) => {
            setRemoving(false)

            if (removed.outcome === 'refused') {
              setTrouble(refusalFor(removed))

              return
            }

            void navigate({
              to: job
                ? `/auftraege/${String(job['id'])}`
                : `/anlagen/${text(defect, 'installationId')}`,
            })
          })
        }}
      >
        Ein Mangel, der noch gemeldet ist, lässt sich entfernen, etwa wenn er versehentlich erfasst
        wurde. Im Änderungsprotokoll bleibt er stehen.
      </Confirm>
    </Screen>
  )
}
