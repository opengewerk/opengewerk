import {
  gridOperatorProblems,
  type IsoDate,
  type RecordState,
  registrationHolds,
} from '@opengewerk/domain'
import { Button, Confirm, Field, Panel, Status, TextArea } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  Empty,
  ListCard,
  ListScreen,
  NoteBox,
  PageHead,
  RecordColumns,
  Screen,
} from '@opengewerk/platform-web/office'
import type { ListColumn } from '@opengewerk/platform-web/office'
import { RequestRefused, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { CalendarClock, Check, Trash2, UtilityPole } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { useMay } from '../../app/queries.js'
import {
  createGridOperator,
  gridOperator,
  type GridOperatorEntry,
  gridOperators,
  type GridOperatorValues,
  removeGridOperator,
  updateGridOperator,
} from '../../session/grid-operators.js'

/** The lead of the deadline of an entry (`elektro.installer_registration`): from then on the list says it runs out soon. */
const soonDays = 90

/** Whether an entry has run out, runs out within the lead of its deadline, or holds. */
export function registrationState(
  entry: Pick<GridOperatorEntry, 'registrationNumber' | 'registeredUntil'>,
  on: IsoDate,
): 'none' | 'over' | 'soon' | 'holds' {
  if (entry.registrationNumber === null || entry.registrationNumber.trim() === '') {
    return 'none'
  }

  if (!registrationHolds(entry, on)) {
    return 'over'
  }

  if (entry.registeredUntil === null) {
    return 'holds'
  }

  const left = (Date.parse(entry.registeredUntil) - Date.parse(on)) / 86_400_000

  return left <= soonDays ? 'soon' : 'holds'
}

function RegistrationCell({ entry }: { readonly entry: GridOperatorEntry }) {
  const state = registrationState(entry, today())

  if (state === 'none') {
    return <span className="text-ink-faint">nicht eingetragen</span>
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        {entry.registeredUntil === null
          ? entry.registrationNumber
          : `${entry.registrationNumber ?? ''}, bis ${date(entry.registeredUntil)}`}
      </span>
      {state === 'soon' ? <Status tone="waiting">läuft bald ab</Status> : null}
      {state === 'over' ? <Status tone="conflict">abgelaufen</Status> : null}
    </span>
  )
}

function asRow(entry: GridOperatorEntry): RecordState {
  return entry as unknown as RecordState
}

function entryOf(row: RecordState): GridOperatorEntry {
  return row as unknown as GridOperatorEntry
}

/**
 * The grid operators of the business (#306), as the board "Netzbetreiber"
 * draws them: the name, the portal, the entry of the business in the
 * operator's installer directory and how many installations name it. Kept at
 * the desk and read from the server, so the list needs a connection.
 */
export function GridOperatorList() {
  const { online } = useSyncStatus()
  const creates = useMay('grid_operator.write')
  const navigate = useNavigate()
  const list = useQuery({ queryKey: ['grid-operators'], queryFn: gridOperators, enabled: online })
  const columns: readonly ListColumn[] = [
    { id: 'name', header: 'Name', value: (row) => entryOf(row).name },
    {
      id: 'portal',
      header: 'Portal',
      value: (row) => entryOf(row).portalUrl ?? '',
      cell: (row) => {
        const portal = entryOf(row).portalUrl

        return portal ? (
          <span className="break-all">{portal.replace(/^https?:\/\//, '')}</span>
        ) : (
          <span className="text-ink-faint">nicht angegeben</span>
        )
      },
      width: 'w-[250px]',
    },
    {
      id: 'registration',
      header: 'Eintragung im Installateurverzeichnis',
      value: (row) => entryOf(row).registeredUntil ?? '',
      cell: (row) => <RegistrationCell entry={entryOf(row)} />,
      width: 'w-[330px]',
    },
    {
      id: 'installations',
      header: 'Anlagen',
      value: (row) => entryOf(row).installations,
      align: 'right',
      width: 'w-[90px]',
    },
  ]

  return (
    <ListScreen
      title="Netzbetreiber"
      caption="Alle Netzbetreiber des Betriebs"
      rows={(list.data ?? []).map(asRow)}
      columns={columns}
      alsoSearched={(row) => entryOf(row).registrationNumber ?? ''}
      hrefFor={(row) => `/netzbetreiber/${entryOf(row).id}`}
      searchLabel="Netzbetreiber durchsuchen"
      searchPlaceholder="Name, Nummer …"
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
              label: 'Neuer Netzbetreiber',
              onPress: () => {
                void navigate({ to: '/netzbetreiber/neu' })
              },
            }
          : undefined
      }
      card={(row) => {
        const entry = entryOf(row)

        return (
          <ListCard
            to={`/netzbetreiber/${entry.id}`}
            title={entry.name}
            sub={
              entry.registrationNumber
                ? `Eingetragen unter ${entry.registrationNumber}${
                    entry.registeredUntil ? `, bis ${date(entry.registeredUntil)}` : ''
                  }`
                : 'Nicht eingetragen'
            }
          />
        )
      }}
      note={
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {online
            ? 'Für Arbeiten an einer Anlage reicht die Eintragung im Installateurverzeichnis eines Netzbetreibers (§ 13 Abs. 2 NAV). Vor dem letzten Tag einer Eintragung erinnert die Frist „Eintragung im Installateurverzeichnis läuft ab“.'
            : 'Die Netzbetreiber liegen auf dem Server, dafür braucht es Verbindung.'}
        </p>
      }
      empty={{
        icon: UtilityPole,
        title: 'Noch kein Netzbetreiber angelegt',
        text: 'Ein Netzbetreiber ist, wem eine PV-Anlage, ein Speicher oder eine Wallbox gemeldet wird: mit seinem Portal, dem Ansprechpartner dort und der Eintragung des Betriebs in seinem Installateurverzeichnis. Der erste entsteht über „Neuer Netzbetreiber“.',
      }}
    />
  )
}

interface Draft {
  readonly name: string
  readonly portalUrl: string
  readonly requirements: string
  readonly contactName: string
  readonly contactEmail: string
  readonly contactPhone: string
  readonly registrationNumber: string
  readonly registeredUntil: string
  readonly responsibleElectrician: string
}

function draftOf(entry: GridOperatorEntry | undefined): Draft {
  return {
    name: entry?.name ?? '',
    portalUrl: entry?.portalUrl ?? '',
    requirements: entry?.requirements ?? '',
    contactName: entry?.contactName ?? '',
    contactEmail: entry?.contactEmail ?? '',
    contactPhone: entry?.contactPhone ?? '',
    registrationNumber: entry?.registrationNumber ?? '',
    registeredUntil: entry?.registeredUntil ?? '',
    responsibleElectrician: entry?.responsibleElectrician ?? '',
  }
}

/**
 * What is sent: a text trimmed and empty as null, and a portal typed as a
 * bare host with "https://" before it, as the hint under the field says.
 */
export function asGridOperator(draft: Draft): GridOperatorValues {
  const or = (value: string) => (value.trim() === '' ? null : value.trim())
  const portal = or(draft.portalUrl)

  return {
    name: draft.name.trim(),
    portalUrl: portal === null || /^https?:\/\//i.test(portal) ? portal : `https://${portal}`,
    requirements: draft.requirements.trim() === '' ? null : draft.requirements,
    contactName: or(draft.contactName),
    contactEmail: or(draft.contactEmail),
    contactPhone: or(draft.contactPhone),
    registrationNumber: or(draft.registrationNumber),
    registeredUntil: or(draft.registeredUntil) as IsoDate | null,
    responsibleElectrician: or(draft.responsibleElectrician),
  }
}

function Frame({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Screen>
      <PageHead title={title} crumbs={[{ to: '/netzbetreiber', label: 'Netzbetreiber' }]} />
      <Empty>{children}</Empty>
    </Screen>
  )
}

/** A new grid operator: the form of the board, without the installations beside it. */
export function NewGridOperatorScreen() {
  const writes = useMay('grid_operator.write')

  return writes ? (
    <GridOperatorForm entry={undefined} />
  ) : (
    <Frame title="Netzbetreiber">Netzbetreiber anlegen darf dieser Zugang nicht.</Frame>
  )
}

/**
 * One grid operator as its form, the board "Netzbetreiber mit der Eintragung
 * im Installateurverzeichnis": who it is, what it asks for, whom to ask, and
 * the entry of the business in its directory, with the installations that
 * name it beside.
 */
export function GridOperatorScreen() {
  const { gridOperatorId } = useParams({ strict: false }) as { gridOperatorId?: string }
  const { online } = useSyncStatus()
  const one = useQuery({
    queryKey: ['grid-operator', gridOperatorId],
    queryFn: () => gridOperator(gridOperatorId ?? ''),
    enabled: online && gridOperatorId !== undefined,
    retry: false,
  })

  if (!online) {
    return (
      <Frame title="Netzbetreiber">
        Die Netzbetreiber liegen auf dem Server, dafür braucht es Verbindung.
      </Frame>
    )
  }

  if (one.isError) {
    return <Frame title="Nicht gefunden">Diesen Netzbetreiber gibt es nicht mehr.</Frame>
  }

  if (!one.data) {
    return null
  }

  return <GridOperatorForm key={one.data.id} entry={one.data} named={one.data.named} />
}

function GridOperatorForm({
  entry,
  named = [],
}: {
  readonly entry: GridOperatorEntry | undefined
  readonly named?: readonly {
    readonly id: string
    readonly designation: string
    readonly site: string
    readonly customer: string
    readonly reference: string | null
  }[]
}) {
  const writes = useMay('grid_operator.write')
  const { online } = useSyncStatus()
  const navigate = useNavigate()
  const queries = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const editing = entry !== undefined
  const state = entry ? registrationState(entry, today()) : 'none'

  const set = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const values = asGridOperator(draft)
    const found = gridOperatorProblems(values)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const saved = entry
        ? await updateGridOperator(entry.id, values)
        : await createGridOperator(values)

      await queries.invalidateQueries({ queryKey: ['grid-operators'] })
      await queries.invalidateQueries({ queryKey: ['grid-operator', saved.id] })

      if (!editing) {
        await navigate({ to: `/netzbetreiber/${saved.id}` })
      }
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Netzbetreiber werden mit Verbindung gespeichert.',
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
      await removeGridOperator(entry.id)
      await queries.invalidateQueries({ queryKey: ['grid-operators'] })
      await navigate({ to: '/netzbetreiber' })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : 'Das hat nicht geklappt.')
    }
  }

  const input = (
    field: keyof Draft,
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      label={label}
      value={draft[field]}
      problem={problems[field]}
      readOnly={!writes}
      onChange={(event) => {
        set(field)(event.target.value)
      }}
      {...extra}
    />
  )

  const form = (
    <div className="flex max-w-[760px] flex-col gap-3">
      <Panel title="Netzbetreiber" roomy>
        <div className="grid gap-3 sm:grid-cols-2">
          {input('name', 'Name', { required: true, starred: true })}
          {input('portalUrl', 'Portal', { hint: 'Wo er Anmeldungen annimmt.', inputMode: 'url' })}
        </div>
      </Panel>
      <Panel title="Was er verlangt" roomy>
        <TextArea
          label="Was er verlangt"
          rows={4}
          value={draft.requirements}
          problem={problems['requirements']}
          readOnly={!writes}
          hint="Seine Vordrucke und Unterlagen, wie er sie nennt. Steht oben auf jeder Anmeldung."
          onChange={(event) => {
            set('requirements')(event.target.value)
          }}
        />
      </Panel>
      <Panel title="Ansprechpartner" roomy>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          {input('contactName', 'Name')}
          {input('contactEmail', 'E-Mail', { type: 'email' })}
          {input('contactPhone', 'Telefon', { type: 'tel' })}
        </div>
      </Panel>
      <Panel title="Eintragung des Betriebs im Installateurverzeichnis" roomy>
        <div className="flex flex-col gap-2.5">
          <p className="-mt-[3px] text-[13px] text-ink-faint">
            Steht als Nachweis auf Anmeldung und Fertigmeldung.
          </p>
          {entry && (state === 'soon' || state === 'over') && entry.registeredUntil ? (
            <NoteBox tone={state === 'over' ? 'conflict' : 'waiting'} icon={CalendarClock}>
              {state === 'over'
                ? `Die Eintragung ist am ${date(entry.registeredUntil)} abgelaufen.`
                : `Die Eintragung läuft am ${date(entry.registeredUntil)} ab. Die Frist dazu steht unter „Fristen“.`}
            </NoteBox>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
            {input('registrationNumber', 'Nummer')}
            {input('registeredUntil', 'Gültig bis', {
              type: 'date',
              hint: 'Der letzte Tag, an dem sie gilt.',
            })}
            {input('responsibleElectrician', 'Verantwortliche Elektrofachkraft')}
          </div>
        </div>
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
          title={editing ? entry.name : 'Neuer Netzbetreiber'}
          crumbs={[{ to: '/netzbetreiber', label: 'Netzbetreiber' }]}
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
                      void navigate({ to: '/netzbetreiber' })
                    }}
                  >
                    Abbrechen
                  </Button>
                  <Button type="submit" tone="primary" icon={Check} disabled={working || !online}>
                    {working ? 'Wird gespeichert' : 'Netzbetreiber anlegen'}
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

        {editing ? (
          <RecordColumns
            main={form}
            side={
              <Panel title="Anlagen mit diesem Netzbetreiber">
                <div className="flex flex-col gap-2.5">
                  {named.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {named.map((installation) => (
                        <li
                          key={installation.id}
                          className="rounded-control border border-line bg-ground px-[11px] py-[9px]"
                        >
                          <Link
                            to={`/anlagen/${installation.id}`}
                            className="text-[14px] font-semibold text-copper-text underline underline-offset-2"
                          >
                            {installation.designation}
                          </Link>
                          <div className="text-[13px] text-ink-faint">
                            {[
                              installation.site,
                              installation.customer,
                              installation.reference ? `Kennung ${installation.reference}` : null,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] leading-[1.4] text-ink-muted">
                      Noch nennt keine Anlage diesen Netzbetreiber.
                    </p>
                  )}
                  <p className="text-[13px] leading-[1.4] text-ink-muted">
                    Solange eine Anlage ihn nennt, lässt er sich nicht entfernen.
                  </p>
                </div>
              </Panel>
            }
          />
        ) : (
          form
        )}
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
        Mit ihm geht die Frist seiner Eintragung im Installateurverzeichnis. Eine Anlage, die ihn
        nennt, hält ihn fest.
      </Confirm>
    </Screen>
  )
}
