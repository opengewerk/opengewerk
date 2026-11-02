import {
  declarationPlaceholders,
  type FundingEvidence,
  type FundingEvidenceSource,
  fundingEvidenceSources,
  type FundingKind,
  fundingKinds,
  fundingProgramProblems,
  fundingProgramsFor,
  fundingSourceLabel,
  type InstallationKind,
  installationKindLabel,
  type RecordState,
} from '@opengewerk/domain'
import {
  Button,
  Confirm,
  Field,
  IconButton,
  Panel,
  SelectField,
  TextArea,
} from '@opengewerk/platform-web'
import {
  Empty,
  ListCard,
  ListScreen,
  PageHead,
  RecordColumns,
  Screen,
} from '@opengewerk/platform-web/office'
import type { ListColumn } from '@opengewerk/platform-web/office'
import { RequestRefused, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Check, Eye, HandCoins, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { useMay } from '../../app/queries.js'
import {
  createFundingProgram,
  fundingPapersAddress,
  fundingProgram,
  type FundingProgramEntry,
  fundingPrograms,
  type FundingProgramValues,
  removeFundingProgram,
  updateFundingProgram,
} from '../../session/funding-programs.js'

function asRow(entry: FundingProgramEntry): RecordState {
  return entry as unknown as RecordState
}

function entryOf(row: RecordState): FundingProgramEntry {
  return row as unknown as FundingProgramEntry
}

/** "Wallbox", "Speicher, Wallbox": the kinds a programme is for, in the order of the list. */
function kindsText(kinds: readonly string[]): string {
  return fundingKinds
    .filter((kind) => kinds.includes(kind))
    .map((kind) => installationKindLabel[kind])
    .join(', ')
}

/**
 * The funding programmes of the business (#307), as the board
 * "Förderprogramme" draws them: the name, who funds it, what it is for and
 * how many proofs it asks for. Kept at the desk and read from the server, so
 * the list needs a connection.
 */
export function FundingProgramList() {
  const { online } = useSyncStatus()
  const creates = useMay('funding_program.write')
  const navigate = useNavigate()
  const list = useQuery({
    queryKey: ['funding-programs'],
    queryFn: fundingPrograms,
    enabled: online,
  })
  const columns: readonly ListColumn[] = [
    { id: 'name', header: 'Name', value: (row) => entryOf(row).name },
    {
      id: 'sponsor',
      header: 'Fördergeber',
      value: (row) => entryOf(row).sponsor ?? '',
      cell: (row) =>
        entryOf(row).sponsor ?? <span className="text-ink-faint">nicht angegeben</span>,
      width: 'w-[260px]',
    },
    {
      id: 'kinds',
      header: 'Für',
      value: (row) => kindsText(entryOf(row).kinds),
      width: 'w-[200px]',
    },
    {
      id: 'evidence',
      header: 'Nachweise',
      value: (row) => entryOf(row).evidence.length,
      align: 'right',
      width: 'w-[100px]',
    },
  ]

  return (
    <ListScreen
      title="Förderprogramme"
      caption="Alle Förderprogramme des Betriebs"
      rows={(list.data ?? []).map(asRow)}
      columns={columns}
      hrefFor={(row) => `/foerderprogramme/${entryOf(row).id}`}
      searchLabel="Förderprogramme durchsuchen"
      searchPlaceholder="Name, Fördergeber …"
      alsoSearched={(row) => entryOf(row).sponsor ?? ''}
      sorts={[
        {
          id: 'name',
          label: 'Name',
          compare: (left, right) => entryOf(left).name.localeCompare(entryOf(right).name, 'de'),
        },
      ]}
      primary={
        creates
          ? {
              label: 'Neues Förderprogramm',
              onPress: () => {
                void navigate({ to: '/foerderprogramme/neu' })
              },
            }
          : undefined
      }
      card={(row) => {
        const entry = entryOf(row)

        return (
          <ListCard
            to={`/foerderprogramme/${entry.id}`}
            title={entry.name}
            sub={[entry.sponsor, kindsText(entry.kinds)].filter(Boolean).join(', ')}
          />
        )
      }}
      note={
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {online
            ? 'Ein Förderprogramm ist eine Vorlage: was es als Nachweis verlangt, in seiner Reihenfolge. An einer Anlage stellt „Förderunterlagen“ daraus ein PDF zusammen. Ändert ein Programm seine Bedingungen, wird die Vorlage geändert, nicht OpenGewerk.'
            : 'Die Förderprogramme liegen auf dem Server, dafür braucht es Verbindung.'}
        </p>
      }
      empty={{
        icon: HandCoins,
        title: 'Noch kein Förderprogramm angelegt',
        text: 'Ein Förderprogramm sagt, welche Nachweise es für eine PV-Anlage, einen Speicher oder eine Wallbox verlangt. Das erste entsteht über „Neues Förderprogramm“.',
      }}
    />
  )
}

interface Draft {
  readonly name: string
  readonly sponsor: string
  readonly url: string
  readonly kinds: readonly FundingKind[]
  readonly evidence: readonly FundingEvidence[]
  readonly declaration: string
}

function draftOf(entry: FundingProgramEntry | undefined): Draft {
  return {
    name: entry?.name ?? '',
    sponsor: entry?.sponsor ?? '',
    url: entry?.url ?? '',
    kinds: entry?.kinds ?? [],
    evidence: entry?.evidence ?? [{ source: 'invoice', label: fundingSourceLabel.invoice }],
    declaration: entry?.declaration ?? '',
  }
}

/**
 * What is sent: a text trimmed and empty as null, a page typed as a bare host
 * with "https://" before it, and each proof with its name trimmed.
 */
export function asFundingProgram(draft: Draft): FundingProgramValues {
  const or = (value: string) => (value.trim() === '' ? null : value.trim())
  const url = or(draft.url)

  return {
    name: draft.name.trim(),
    sponsor: or(draft.sponsor),
    url: url === null || /^https?:\/\//i.test(url) ? url : `https://${url}`,
    kinds: draft.kinds,
    evidence: draft.evidence.map((entry) => ({ source: entry.source, label: entry.label.trim() })),
    declaration: draft.declaration.trim() === '' ? null : draft.declaration,
  }
}

function Frame({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Screen>
      <PageHead title={title} crumbs={[{ to: '/foerderprogramme', label: 'Förderprogramme' }]} />
      <Empty>{children}</Empty>
    </Screen>
  )
}

/** A new funding programme: the form of the board. */
export function NewFundingProgramScreen() {
  const writes = useMay('funding_program.write')

  return writes ? (
    <FundingProgramForm entry={undefined} />
  ) : (
    <Frame title="Förderprogramme">Förderprogramme anlegen darf dieser Zugang nicht.</Frame>
  )
}

/** One funding programme as its form, the board "Förderprogramm mit seinen Nachweisen". */
export function FundingProgramScreen() {
  const { fundingProgramId } = useParams({ strict: false }) as { fundingProgramId?: string }
  const { online } = useSyncStatus()
  const one = useQuery({
    queryKey: ['funding-program', fundingProgramId],
    queryFn: () => fundingProgram(fundingProgramId ?? ''),
    enabled: online && fundingProgramId !== undefined,
    retry: false,
  })

  if (!online) {
    return (
      <Frame title="Förderprogramme">
        Die Förderprogramme liegen auf dem Server, dafür braucht es Verbindung.
      </Frame>
    )
  }

  if (one.isError) {
    return <Frame title="Nicht gefunden">Dieses Förderprogramm gibt es nicht mehr.</Frame>
  }

  if (!one.data) {
    return null
  }

  return <FundingProgramForm key={one.data.id} entry={one.data} />
}

const sourceOptions = fundingEvidenceSources.map((source) => ({
  value: source,
  label: fundingSourceLabel[source],
}))

function FundingProgramForm({ entry }: { readonly entry: FundingProgramEntry | undefined }) {
  const writes = useMay('funding_program.write')
  const { online } = useSyncStatus()
  const navigate = useNavigate()
  const queries = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const editing = entry !== undefined

  const setEvidence = (
    change: (current: readonly FundingEvidence[]) => readonly FundingEvidence[],
  ) => {
    setDraft((current) => ({ ...current, evidence: change(current.evidence) }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const values = asFundingProgram(draft)
    const found = fundingProgramProblems(values)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const saved = entry
        ? await updateFundingProgram(entry.id, values)
        : await createFundingProgram(values)

      await queries.invalidateQueries({ queryKey: ['funding-programs'] })
      await queries.invalidateQueries({ queryKey: ['funding-program', saved.id] })

      if (!editing) {
        await navigate({ to: `/foerderprogramme/${saved.id}` })
      }
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Förderprogramme werden mit Verbindung gespeichert.',
      )
    } finally {
      setWorking(false)
    }
  }

  async function remove() {
    if (!entry) {
      return
    }

    setAsking(false)
    setTrouble(null)

    try {
      await removeFundingProgram(entry.id)
      await queries.invalidateQueries({ queryKey: ['funding-programs'] })
      await navigate({ to: '/foerderprogramme' })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : 'Das hat nicht geklappt.')
    }
  }

  const input = (
    field: 'name' | 'sponsor' | 'url',
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      label={label}
      value={draft[field]}
      problem={problems[field]}
      readOnly={!writes}
      onChange={(event) => {
        const value = event.target.value

        setDraft((current) => ({ ...current, [field]: value }))
      }}
      {...extra}
    />
  )

  const form = (
    <div className="flex max-w-[820px] flex-col gap-3">
      <Panel title="Förderprogramm" roomy>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {input('name', 'Name', { required: true, starred: true })}
            {input('sponsor', 'Fördergeber')}
          </div>
          {input('url', 'Seite im Internet', {
            hint: 'Wo das Programm seine Bedingungen nennt.',
            inputMode: 'url',
          })}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-semibold">
              Gilt für{' '}
              <span className="text-conflict" aria-hidden="true">
                *
              </span>
            </legend>
            <div className="flex flex-wrap gap-x-[18px] gap-y-1">
              {fundingKinds.map((kind) => (
                <label key={kind} className="flex min-h-[34px] items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={draft.kinds.includes(kind)}
                    disabled={!writes}
                    onChange={(event) => {
                      const checked = event.target.checked

                      setDraft((current) => ({
                        ...current,
                        kinds: fundingKinds.filter((each) =>
                          each === kind ? checked : current.kinds.includes(each),
                        ),
                      }))
                    }}
                  />
                  {installationKindLabel[kind]}
                </label>
              ))}
            </div>
            {problems['kinds'] ? (
              <p className="text-[13px] font-semibold text-conflict">{problems['kinds']}</p>
            ) : null}
          </fieldset>
        </div>
      </Panel>
      <Panel title="Nachweise" roomy>
        <div className="flex flex-col gap-2.5">
          <p className="-mt-[3px] text-[13px] text-ink-faint">
            In der Reihenfolge, in der das Programm sie verlangt. Was aus OpenGewerk kommt, legen
            die Förderunterlagen bei; was der Betreiber bringt, steht als Zeile auf der Liste.
          </p>
          <ol className="flex flex-col gap-2.5">
            {draft.evidence.map((proof, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <div className="w-full sm:w-[230px]">
                  <SelectField
                    label="Kommt aus"
                    value={proof.source}
                    options={sourceOptions}
                    disabled={!writes}
                    onChange={(value) => {
                      setEvidence((current) =>
                        current.map((each, at) =>
                          at === index ? { ...each, source: value as FundingEvidenceSource } : each,
                        ),
                      )
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Field
                    label="Wie das Programm ihn nennt"
                    value={proof.label}
                    readOnly={!writes}
                    onChange={(event) => {
                      const value = event.target.value

                      setEvidence((current) =>
                        current.map((each, at) =>
                          at === index ? { ...each, label: value } : each,
                        ),
                      )
                    }}
                  />
                </div>
                {writes ? (
                  <div className="flex gap-1">
                    <IconButton
                      label={`${proof.label || 'Nachweis'} nach oben`}
                      disabled={index === 0}
                      onClick={() => {
                        setEvidence((current) => moved(current, index, index - 1))
                      }}
                    >
                      <ArrowUp size={15} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`${proof.label || 'Nachweis'} nach unten`}
                      disabled={index === draft.evidence.length - 1}
                      onClick={() => {
                        setEvidence((current) => moved(current, index, index + 1))
                      }}
                    >
                      <ArrowDown size={15} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`${proof.label || 'Nachweis'} entfernen`}
                      onClick={() => {
                        setEvidence((current) => current.filter((_, at) => at !== index))
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {problems['evidence'] ? (
            <p className="text-[13px] font-semibold text-conflict">{problems['evidence']}</p>
          ) : null}
          {writes ? (
            <div>
              <Button
                size="small"
                icon={Plus}
                onClick={() => {
                  setEvidence((current) => [...current, { source: 'operator', label: '' }])
                }}
              >
                Nachweis hinzufügen
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
      <Panel title="Fachunternehmererklärung" roomy>
        <TextArea
          label="Text der Erklärung"
          rows={5}
          value={draft.declaration}
          problem={problems['declaration']}
          readOnly={!writes}
          hint={`Steht in den Förderunterlagen mit den Angaben der Anlage und Zeilen für die Unterschrift. Platzhalter: ${declarationPlaceholders
            .map((word) => `{${word}}`)
            .join(', ')}.`}
          onChange={(event) => {
            const value = event.target.value

            setDraft((current) => ({ ...current, declaration: value }))
          }}
        />
      </Panel>
    </div>
  )

  return (
    <Screen>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <PageHead
          title={editing ? entry.name : 'Neues Förderprogramm'}
          crumbs={[{ to: '/foerderprogramme', label: 'Förderprogramme' }]}
          actions={
            writes ? (
              editing ? (
                <>
                  <Button
                    icon={Trash2}
                    disabled={working || !online}
                    onClick={() => {
                      setAsking(true)
                    }}
                  >
                    Entfernen
                  </Button>
                  <Button type="submit" tone="primary" icon={Check} disabled={working || !online}>
                    {working ? 'Wird gespeichert' : 'Speichern'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={working}
                    onClick={() => {
                      void navigate({ to: '/foerderprogramme' })
                    }}
                  >
                    Abbrechen
                  </Button>
                  <Button type="submit" tone="primary" icon={Check} disabled={working || !online}>
                    {working ? 'Wird gespeichert' : 'Förderprogramm anlegen'}
                  </Button>
                </>
              )
            ) : null
          }
        />

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <RecordColumns
          main={form}
          side={
            <Panel title="So wird es benutzt">
              <div className="flex flex-col gap-2.5 text-[13px] leading-[1.4] text-ink-muted">
                <p>
                  Die Förderunterlagen entstehen an der Anlage, unter „Förderunterlagen“. Ein
                  Programm hängt an keiner Anlage; entfernt, fehlt es nur in der Auswahl.
                </p>
                <p>
                  Rechnungen sind die gestellten Rechnungen zur Anlage oder zu einem Auftrag an ihr,
                  Fotos die Bilder unter ihren Dateien.
                </p>
              </div>
            </Panel>
          }
        />
      </form>

      <Confirm
        open={asking}
        title={`„${entry?.name ?? ''}“ entfernen?`}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          void remove()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        Die Vorlage geht, mit ihren Nachweisen und dem Text der Erklärung. Förderunterlagen, die
        schon gedruckt sind, bleiben, wie sie sind.
      </Confirm>
    </Screen>
  )
}

/** The proofs with one moved to another place. */
function moved(
  evidence: readonly FundingEvidence[],
  from: number,
  to: number,
): readonly FundingEvidence[] {
  const list = [...evidence]
  const [taken] = list.splice(from, 1)

  if (taken !== undefined) {
    list.splice(to, 0, taken)
  }

  return list
}

/** "für eine Wallbox": what the card says where no programme is for the kind yet. */
const forKind: Readonly<Partial<Record<InstallationKind, string>>> = {
  pv_system: 'eine PV-Anlage',
  battery: 'einen Speicher',
  wallbox: 'eine Wallbox',
}

const link =
  'inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap'

/**
 * The card "Förderunterlagen" of a PV system, a battery or a wallbox (#307),
 * as the board "Wallbox" draws it: a programme for its kind and the PDF the
 * server puts together. With the right to the programmes, since the papers
 * lay in invoices.
 */
export function FundingSection({
  installationId,
  kind,
}: {
  readonly installationId: string
  readonly kind: InstallationKind
}) {
  const { online } = useSyncStatus()
  const list = useQuery({
    queryKey: ['funding-programs'],
    queryFn: fundingPrograms,
    enabled: online,
  })
  const offered = fundingProgramsFor(list.data ?? [], kind)
  const [chosen, setChosen] = useState('')
  const programId = offered.some((program) => program.id === chosen)
    ? chosen
    : (offered[0]?.id ?? '')

  return (
    <Panel title="Förderunterlagen">
      <div className="flex flex-col gap-2.5">
        {!online ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Die Förderunterlagen druckt der Server, dafür braucht es Verbindung.
          </p>
        ) : list.data && offered.length === 0 ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Noch kein Förderprogramm für {forKind[kind] ?? 'diese Anlage'}. Es entsteht unter
            Stammdaten, Förderprogramme.
          </p>
        ) : list.data ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full sm:w-[300px]">
                <SelectField
                  label="Förderprogramm"
                  value={programId}
                  options={offered.map((program) => ({
                    value: program.id,
                    label: [program.name, program.sponsor].filter(Boolean).join(', '),
                  }))}
                  onChange={setChosen}
                />
              </div>
              <a
                href={fundingPapersAddress(installationId, programId)}
                target="_blank"
                rel="noopener noreferrer"
                className={link}
              >
                <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
                Förderunterlagen
              </a>
            </div>
            <p className="text-[13px] leading-[1.4] text-ink-muted">
              Ein PDF mit der Liste der Nachweise, der Fachunternehmererklärung, den Seriennummern,
              dem Inbetriebnahmeprotokoll, den Fotos und den Rechnungen zur Anlage. Was der
              Betreiber bringt, steht auf der Liste.
            </p>
          </>
        ) : null}
      </div>
    </Panel>
  )
}
