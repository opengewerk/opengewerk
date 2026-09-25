import type { CircuitFigures, OvercurrentDevice, RecordState } from '@opengewerk/domain'
import {
  cableInstallationMethodName,
  cableLengthText,
  cableSizeText,
  cableText,
  distributionBoardKindLabel,
  milliText,
  overcurrentText,
  rcdText,
  rcdTypeLabel,
  tripCharacteristicLabel,
} from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Pencil, Plus, Printer } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  Button,
  cardLink,
  Cell,
  Column,
  Confirm,
  isNarrow,
  Panel,
  PanelLabel,
  TablePanel,
  useBand,
} from '../../components/index.js'
import {
  asBoard,
  asEquipment,
  asSection,
  boardFields,
  boardKindOf,
  circuitChartAddress,
  CircuitForm,
  circuitsInWords,
  equipmentFields,
  figuresOf,
  moveAmong,
  newBoard,
  nextPosition,
  ordered,
  sectionFields,
  useBoards,
  useCircuits,
  useEquipment,
  useSections,
} from '../../app/electrical.js'
import { installationKindOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { RecordForm } from '../../app/record-form.js'
import { refusalFor } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useSync, useSyncStatus } from '../../sync/provider.js'
import { Crumbs, Empty, FactList, PageHead, Screen } from '../kit.js'
import { PathSlot } from '../top-bar.js'
import { Reorder, SmallIcon } from './boards.js'

/**
 * The structure of an installation, as the boards "Anlagenstruktur" of the
 * canvas draw it (#219): the tree of boards, sections and circuits at the
 * left, what is selected in it at the right, and the path to the
 * installation in the header instead of the navigation, because this is a
 * screen one works in, not one passed through.
 *
 * A board and a circuit have their own addresses, `/verteiler/<id>` and
 * `/stromkreise/<id>`, so that a link to either still leads there; both show
 * this screen with that part selected.
 */

/** The section the last new circuit of a board went into, for the next one. */
const lastSection = new Map<string, string | null>()

/**
 * Where the detail stands. Below 1024 pixels it is under the tree, and a tap
 * on a circuit, or on "Stromkreis" in the head, changed only what was out of
 * sight; the links of the tree carry it as their hash there, and the router
 * scrolls to it, 72 pixels short of it for the header that stays on top.
 */
const detailAnchor = 'auswahl'

type Making = { readonly kind: 'board' } | { readonly kind: 'circuit'; readonly boardId: string }

export function BoardScreen() {
  const { boardId } = useParams({ strict: false }) as { boardId?: string }
  const board = useRecord('distribution_boards', boardId)

  if (!board || !boardId) {
    return <Missing what="Diesen Verteiler" />
  }

  return (
    <StructureScreen
      installationId={text(board, 'installationId')}
      boardId={boardId}
      circuitId={null}
    />
  )
}

export function CircuitScreen() {
  const { circuitId } = useParams({ strict: false }) as { circuitId?: string }
  const circuit = useRecord('circuits', circuitId)
  const board = useRecord(
    'distribution_boards',
    maybeText(circuit, 'distributionBoardId') ?? undefined,
  )

  if (!circuit || !circuitId || !board) {
    return <Missing what="Diesen Stromkreis" />
  }

  return (
    <StructureScreen
      installationId={text(board, 'installationId')}
      boardId={String(board['id'])}
      circuitId={circuitId}
    />
  )
}

function Missing({ what }: { readonly what: string }) {
  return (
    <Screen>
      <PageHead title="Nicht gefunden" crumbs={[{ to: '/anlagen', label: 'Anlagen' }]} />
      <Empty>{`${what} gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.`}</Empty>
    </Screen>
  )
}

function StructureScreen({
  installationId,
  boardId,
  circuitId,
}: {
  readonly installationId: string
  readonly boardId: string
  readonly circuitId: string | null
}) {
  const installation = useRecord('installations', installationId)
  const site = useRecord('sites', maybeText(installation, 'siteId') ?? undefined)
  const customer = useRecord('customers', maybeText(site, 'customerId') ?? undefined)
  const writes = useMay('installation.write')
  const [making, setMaking] = useState<Making | null>(null)
  const slot = useContext(PathSlot)
  const narrow = isNarrow(useBand())

  useEffect(() => {
    if (making && narrow) {
      document.getElementById(detailAnchor)?.scrollIntoView({ block: 'start' })
    }
  }, [making, narrow])

  const path = [
    ...(customer
      ? [{ to: `/kunden/${String(customer['id'])}`, label: text(customer, 'name') }]
      : []),
    ...(site ? [{ to: `/objekte/${String(site['id'])}`, label: text(site, 'designation') }] : []),
  ]
  const here = text(installation, 'designation')

  const detail =
    making?.kind === 'board' ? (
      <NewBoard
        installationId={installationId}
        onDone={() => {
          setMaking(null)
        }}
      />
    ) : making?.kind === 'circuit' ? (
      <NewCircuit
        boardId={making.boardId}
        onDone={() => {
          setMaking(null)
        }}
      />
    ) : circuitId ? (
      <CircuitDetail key={circuitId} circuitId={circuitId} />
    ) : (
      <BoardDetail key={boardId} boardId={boardId} />
    )

  return (
    <Screen className="lg:grow">
      {/* In the header from 1024 pixels on, as the boards draw it; below
          that the header is a phone's, and the path stands on the page. */}
      {slot
        ? createPortal(
            <nav aria-label="Pfad" className="flex min-w-0 items-center gap-2 text-[13px]">
              {path.map((step) => (
                <span key={step.to} className="flex min-w-0 items-center gap-2">
                  <Link
                    to={step.to}
                    className="truncate text-top-muted underline underline-offset-2"
                  >
                    {step.label}
                  </Link>
                  <ChevronRight
                    size={13}
                    strokeWidth={2.2}
                    aria-hidden="true"
                    className="shrink-0 text-ink-faint"
                  />
                </span>
              ))}
              <Link
                to={`/anlagen/${installationId}`}
                className="truncate font-semibold text-top-ink no-underline"
              >
                {here}
              </Link>
            </nav>,
            slot,
          )
        : null}
      <div className="lg:hidden">
        <Crumbs
          items={[
            { to: '/', label: 'Kunden' },
            ...path,
            { to: `/anlagen/${installationId}`, label: here },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[24px] font-semibold text-ink">Anlagenstruktur</h1>
        <span className="text-[14px] text-ink-faint">
          Anlage, Verteiler, Feld, Stromkreis, Betriebsmittel
        </span>
        <div className="grow" />
        <ChartLink installationId={installationId} boardId={boardId} />
        {writes ? (
          <Button
            tone="primary"
            icon={Plus}
            onClick={() => {
              setMaking({ kind: 'circuit', boardId })
            }}
          >
            Stromkreis
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 lg:min-h-0 lg:grow lg:flex-row">
        <StructureTree
          installation={installation}
          installationId={installationId}
          boardId={making ? null : boardId}
          circuitId={making ? null : circuitId}
          hash={narrow ? detailAnchor : undefined}
          onNewBoard={
            writes
              ? () => {
                  setMaking({ kind: 'board' })
                }
              : undefined
          }
        />
        {detail}
      </div>
    </Screen>
  )
}

/** The chart of the board that is selected, as a button with a printer. */
function ChartLink({
  installationId,
  boardId,
}: {
  readonly installationId: string
  readonly boardId: string
}) {
  const { online } = useSyncStatus()

  if (!online) {
    return (
      <Button
        icon={Printer}
        disabled
        title="Das Stromkreisverzeichnis druckt der Server, dafür braucht es Verbindung."
      >
        Stromkreisverzeichnis
      </Button>
    )
  }

  return (
    <a
      href={circuitChartAddress(installationId, boardId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap"
    >
      <Printer size={15} strokeWidth={2.3} aria-hidden="true" />
      Stromkreisverzeichnis
    </a>
  )
}

/** "B20", as the tree writes a breaker beside its circuit. */
function protectionShort(circuit: RecordState): string {
  const figures = figuresOf(circuit)
  const curve =
    figures.tripCharacteristic === null ? '' : tripCharacteristicLabel[figures.tripCharacteristic]
  const amps = figures.ratedCurrentMilli === null ? '' : milliText(figures.ratedCurrentMilli)

  if (curve && amps) {
    return `${curve}${amps}`
  }

  return amps ? `${amps} A` : curve
}

/**
 * The tree, `tree()` of the canvas: every board, under it its sections and
 * under those their circuits, a circuit on the board directly right under the
 * board. The board that is selected, or holds the circuit that is, stands
 * open; the others show how much is in them.
 */
function StructureTree({
  installation,
  installationId,
  boardId,
  circuitId,
  hash,
  onNewBoard,
}: {
  readonly installation: RecordState | null
  readonly installationId: string
  readonly boardId: string | null
  readonly circuitId: string | null
  /** Where a link of the tree scrolls to, on a phone and a tablet. */
  readonly hash: string | undefined
  readonly onNewBoard: (() => void) | undefined
}) {
  const boards = useBoards(installationId)
  const sections = useRecords('board_sections')
  const circuits = useRecords('circuits')

  return (
    <section
      aria-label="Struktur der Anlage"
      className="flex shrink-0 flex-col rounded-[5px] border border-line bg-surface lg:w-[360px]"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <PanelLabel>{text(installation, 'designation')}</PanelLabel>
        <div className="grow" />
        {onNewBoard ? (
          <Button size="small" icon={Plus} onClick={onNewBoard}>
            Verteiler
          </Button>
        ) : null}
      </div>
      <ul className="flex grow flex-col gap-0.5 px-3 py-2.5">
        {boards.map((board) => {
          const id = String(board['id'])
          const own = ordered(
            sections.filter((section) => text(section, 'distributionBoardId') === id),
          )
          const onBoard = circuits.filter((circuit) => text(circuit, 'distributionBoardId') === id)
          const holdsSelected = onBoard.some((circuit) => String(circuit['id']) === circuitId)
          const open = id === boardId || holdsSelected
          const known = new Set(own.map((section) => String(section['id'])))
          const direct = ordered(
            onBoard.filter((circuit) => {
              const section = maybeText(circuit, 'boardSectionId')

              return section === null || !known.has(section)
            }),
          )

          return (
            <li key={id}>
              <TreeItem
                to={`/verteiler/${id}`}
                hash={hash}
                level={0}
                chevron={open ? 'down' : 'right'}
                strong
                selected={id === boardId && circuitId === null}
                meta={
                  own.length > 0
                    ? own.length === 1
                      ? '1 Feld'
                      : `${String(own.length)} Felder`
                    : circuitsInWords(onBoard.length)
                }
              >
                {text(board, 'designation')}
              </TreeItem>
              {open ? (
                <ul className="flex flex-col gap-0.5">
                  {direct.map((circuit) => (
                    <li key={String(circuit['id'])}>
                      <CircuitItem
                        circuit={circuit}
                        level={1}
                        selected={String(circuit['id']) === circuitId}
                        hash={hash}
                      />
                    </li>
                  ))}
                  {own.map((section) => {
                    const inside = ordered(
                      onBoard.filter(
                        (circuit) => text(circuit, 'boardSectionId') === String(section['id']),
                      ),
                    )

                    return (
                      <li key={String(section['id'])}>
                        <TreeItem
                          level={1}
                          chevron={inside.length > 0 ? 'down' : 'right'}
                          strong={inside.length > 0}
                        >
                          {text(section, 'designation')}
                        </TreeItem>
                        {inside.length > 0 ? (
                          <ul className="flex flex-col gap-0.5">
                            {inside.map((circuit) => (
                              <li key={String(circuit['id'])}>
                                <CircuitItem
                                  circuit={circuit}
                                  level={2}
                                  selected={String(circuit['id']) === circuitId}
                                  hash={hash}
                                />
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
        {boards.length === 0 ? (
          <li className="px-2.5 py-1.5 text-[13px] leading-[1.4] text-ink-muted">
            Noch kein Verteiler.
          </li>
        ) : null}
      </ul>
      {installationKindOf(installation) === 'meter_cabinet' ? (
        <p className="border-t border-line px-3.5 py-2.5 text-[13px] leading-[1.4] text-ink-muted">
          Kein Zählerschrank als Verteiler: der Schrank ist die Anlage, darin hängen HV und UV.
        </p>
      ) : null}
    </section>
  )
}

const indents = ['pl-2.5', 'pl-7', 'pl-[46px]'] as const

function TreeItem({
  to,
  hash,
  level,
  chevron,
  strong = false,
  selected = false,
  code,
  meta,
  children,
}: {
  readonly to?: string
  readonly hash?: string | undefined
  readonly level: 0 | 1 | 2
  readonly chevron?: 'down' | 'right'
  readonly strong?: boolean
  readonly selected?: boolean
  readonly code?: string
  readonly meta?: string
  readonly children: ReactNode
}) {
  const Chevron = chevron === 'down' ? ChevronDown : chevron === 'right' ? ChevronRight : null
  const className = clsx(
    'flex items-center gap-[7px] rounded-control py-1.5 pr-2.5 text-[14px] no-underline',
    indents[level],
    selected ? 'bg-ink font-semibold text-ground' : clsx('text-ink', strong && 'font-semibold'),
  )
  const inner = (
    <>
      {Chevron ? (
        <Chevron size={14} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
      ) : (
        <span aria-hidden="true" className="w-3.5 shrink-0" />
      )}
      {code ? (
        <span className="w-[22px] shrink-0 font-condensed text-[13px] font-semibold">{code}</span>
      ) : null}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      {meta ? (
        <span
          className={clsx(
            'ml-auto shrink-0 text-[12px] font-semibold',
            selected ? 'text-ground' : 'text-ink-faint',
          )}
        >
          {meta}
        </span>
      ) : null}
    </>
  )

  return to ? (
    <Link to={to} hash={hash} aria-current={selected ? 'page' : undefined} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  )
}

function CircuitItem({
  circuit,
  level,
  selected,
  hash,
}: {
  readonly circuit: RecordState
  readonly level: 1 | 2
  readonly selected: boolean
  readonly hash: string | undefined
}) {
  return (
    <TreeItem
      to={`/stromkreise/${String(circuit['id'])}`}
      hash={hash}
      level={level}
      selected={selected}
      code={text(circuit, 'designation')}
      meta={protectionShort(circuit)}
    >
      {maybeText(circuit, 'consumer') ?? ''}
    </TreeItem>
  )
}

/** The frame of what is selected: its name and a line, what can be done, and the rest. */
function Detail({
  title,
  sub,
  actions,
  children,
}: {
  readonly title: ReactNode
  readonly sub?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section
      id={detailAnchor}
      aria-label={typeof title === 'string' ? title : undefined}
      className="flex min-w-0 grow scroll-mt-[4.5rem] flex-col rounded-[5px] border border-line bg-surface [--surface-here:var(--color-surface)]"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-line px-4 py-3">
        <h2 className="text-[18px] font-semibold [overflow-wrap:anywhere]">{title}</h2>
        {sub ? <span className="text-[13px] text-ink-faint">{sub}</span> : null}
        <div className="grow" />
        {actions}
      </div>
      <div className="flex grow flex-col gap-3 px-4 py-3.5">{children}</div>
    </section>
  )
}

/** "Verteiler löschen", a little lower than a button of the head, as the board draws it. */
function RemoveButton({
  onClick,
  children,
}: {
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Button tone="danger" onClick={onClick} className="lg:h-7 lg:min-h-7">
      {children}
    </Button>
  )
}

function BoardDetail({ boardId }: { readonly boardId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const writes = useMay('installation.write')
  const board = useRecord('distribution_boards', boardId)
  const installationId = text(board, 'installationId')
  const installation = useRecord('installations', installationId)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!board) {
    return null
  }

  async function remove() {
    setRemoving(false)

    const result = await client.remove('distribution_boards', boardId)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await navigate({ to: `/anlagen/${installationId}` })
  }

  const known = new Set(sections.map((section) => String(section['id'])))
  const direct = ordered(
    circuits.filter((circuit) => {
      const section = maybeText(circuit, 'boardSectionId')

      return section === null || !known.has(section)
    }),
  )

  return (
    <Detail
      title={text(board, 'designation')}
      sub={[distributionBoardKindLabel[boardKindOf(board)], maybeText(board, 'location')]
        .filter((part): part is string => part !== null)
        .join(', ')}
      actions={
        writes ? (
          <>
            <Button size="small" icon={Pencil} onClick={() => setEditing(true)}>
              Bearbeiten
            </Button>
            <RemoveButton onClick={() => setRemoving(true)}>Verteiler löschen</RemoveButton>
          </>
        ) : null
      }
    >
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <Panel title="Verteiler">
        {editing ? (
          <RecordForm
            fields={boardFields}
            record={board}
            submitLabel="Speichern"
            onCancel={() => {
              setEditing(false)
            }}
            onSubmit={async (values) => {
              const saved = await client.update('distribution_boards', boardId, asBoard(values))

              if (saved.outcome === 'queued') {
                setEditing(false)
              }

              return saved
            }}
          />
        ) : (
          <FactList
            keyWidth={90}
            facts={[
              {
                label: 'Anlage',
                value: installation ? (
                  <Link
                    to={`/anlagen/${installationId}`}
                    className="text-copper-text underline underline-offset-2"
                  >
                    {text(installation, 'designation')}
                  </Link>
                ) : null,
              },
              { label: 'Art', value: distributionBoardKindLabel[boardKindOf(board)] },
              { label: 'Ort', value: maybeText(board, 'location') },
            ]}
          />
        )}
      </Panel>

      <SectionsTable boardId={boardId} sections={sections} circuits={circuits} writes={writes} />

      <TablePanel
        title="Stromkreise ohne Feld"
        caption="Stromkreise ohne Feld"
        cards={direct.map((circuit) => {
          const figures = figuresOf(circuit)

          return {
            key: String(circuit['id']),
            title: (
              <Link to={`/stromkreise/${String(circuit['id'])}`} className={cardLink}>
                {[text(circuit, 'designation'), maybeText(circuit, 'consumer')]
                  .filter(Boolean)
                  .join(', ')}
              </Link>
            ),
            sub: [overcurrentText(figures), rcdText(figures), cableText(figures)]
              .filter((part): part is string => part !== null)
              .join(' · '),
          }
        })}
        cardsEmpty="Jeder Stromkreis dieses Verteilers steht in einem Feld."
      >
        <thead>
          <tr>
            <Column className="w-[90px]">Stromkreis</Column>
            <Column>Verbraucher</Column>
            <Column className="w-[140px]">Schutzeinrichtung</Column>
            <Column className="w-[110px]">RCD</Column>
            <Column className="w-[150px]">Leitung</Column>
          </tr>
        </thead>
        <tbody>
          {direct.length === 0 ? (
            <tr>
              <Cell colSpan={5} className="text-ink-muted">
                Jeder Stromkreis dieses Verteilers steht in einem Feld.
              </Cell>
            </tr>
          ) : (
            direct.map((circuit) => {
              const figures = figuresOf(circuit)

              return (
                <tr key={String(circuit['id'])}>
                  <Cell>
                    <Link
                      to={`/stromkreise/${String(circuit['id'])}`}
                      className="text-inherit no-underline hover:underline"
                    >
                      {text(circuit, 'designation')}
                    </Link>
                  </Cell>
                  <Cell>{maybeText(circuit, 'consumer') ?? ''}</Cell>
                  <Cell>{overcurrentText(figures) ?? ''}</Cell>
                  <Cell>
                    {rcdText(figures) ?? <span className="text-ink-faint">nicht angegeben</span>}
                  </Cell>
                  <Cell>{cableText(figures) ?? ''}</Cell>
                </tr>
              )
            })
          )}
        </tbody>
      </TablePanel>

      <Confirm
        open={removing}
        title={`${text(board, 'designation')} löschen?`}
        confirm="Löschen"
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(false)
        }}
      >
        {`Mit dem Verteiler gehen ${sectionsInWords(sections.length)} und ${circuitsInWords(
          circuits.length,
        )} samt ihren Betriebsmitteln.`}
      </Confirm>
    </Detail>
  )
}

/** "2 Felder", "1 Feld", "kein Feld". */
function sectionsInWords(count: number): string {
  if (count === 0) {
    return 'kein Feld'
  }

  return count === 1 ? '1 Feld' : `${String(count)} Felder`
}

/** "Felder": the sections of a board, in order, to rename, move and remove. */
function SectionsTable({
  boardId,
  sections,
  circuits,
  writes,
}: {
  readonly boardId: string
  readonly sections: readonly RecordState[]
  readonly circuits: readonly RecordState[]
  readonly writes: boolean
}) {
  const client = useSync()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{
    readonly id: string
    readonly name: string
    readonly inside: number
  } | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'board_sections', sections, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('board_sections', id)

    setTrouble(result.outcome === 'refused' ? refusalFor(result) : null)
  }

  const editForm = (section: RecordState) => {
    const id = String(section['id'])

    return (
      <RecordForm
        fields={sectionFields}
        record={section}
        submitLabel="Speichern"
        onCancel={() => {
          setEditing(null)
        }}
        onSubmit={async (values) => {
          const saved = await client.update('board_sections', id, asSection(values))

          if (saved.outcome === 'queued') {
            setEditing(null)
          }

          return saved
        }}
      />
    )
  }

  const reorder = (section: RecordState, index: number) => {
    const id = String(section['id'])
    const name = text(section, 'designation')
    const inside = circuits.filter((circuit) => circuit['boardSectionId'] === id).length

    return (
      <Reorder
        name={name}
        canUp={index > 0}
        canDown={index < sections.length - 1}
        onMove={(step) => void move(id, step)}
        onEdit={() => setEditing(id)}
        onRemove={() => setRemoving({ id, name, inside })}
      />
    )
  }

  const cards = sections.map((section, index) => {
    const id = String(section['id'])

    return editing === id
      ? { key: id, title: text(section, 'designation'), form: editForm(section) }
      : {
          key: id,
          title: text(section, 'designation'),
          sub: circuitsInWords(
            circuits.filter((circuit) => circuit['boardSectionId'] === id).length,
          ),
          actions: writes ? reorder(section, index) : null,
        }
  })

  const form = adding ? (
    <RecordForm
      fields={sectionFields}
      submitLabel="Feld anlegen"
      onCancel={() => {
        setAdding(false)
      }}
      onSubmit={async (values) => {
        const made = await client.create('board_sections', {
          ...asSection(values),
          distributionBoardId: boardId,
          position: nextPosition(sections),
        })

        if (made.outcome === 'queued') {
          setAdding(false)
        }

        return made
      }}
    />
  ) : null

  const table = (
    <TablePanel
      title="Felder"
      caption="Felder des Verteilers"
      lead={
        trouble || form ? (
          <>
            {trouble ? (
              <p role="alert" className="text-[13px] font-semibold text-conflict">
                {trouble}
              </p>
            ) : null}
            {form}
          </>
        ) : null
      }
      action={
        writes && !adding ? (
          <Button size="small" icon={Plus} onClick={() => setAdding(true)}>
            Feld anlegen
          </Button>
        ) : null
      }
      cards={cards}
      cardsEmpty="Keine Felder. Ein kleiner Verteiler braucht keine, seine Stromkreise hängen direkt an ihm."
    >
      <thead>
        <tr>
          <Column>Bezeichnung</Column>
          <Column numeric className="w-[110px]">
            Stromkreise
          </Column>
          {writes ? (
            <Column numeric className="w-[120px]">
              Ändern
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {sections.length === 0 ? (
          <tr>
            <Cell colSpan={writes ? 3 : 2} className="text-ink-muted">
              Keine Felder. Ein kleiner Verteiler braucht keine, seine Stromkreise hängen direkt an
              ihm.
            </Cell>
          </tr>
        ) : (
          sections.map((section, index) => {
            const id = String(section['id'])
            const name = text(section, 'designation')
            const inside = circuits.filter((circuit) => circuit['boardSectionId'] === id).length

            if (editing === id) {
              return (
                <tr key={id}>
                  <Cell colSpan={writes ? 3 : 2}>{editForm(section)}</Cell>
                </tr>
              )
            }

            return (
              <tr key={id}>
                <Cell>{name}</Cell>
                <Cell numeric>{inside}</Cell>
                {writes ? <Cell numeric>{reorder(section, index)}</Cell> : null}
              </tr>
            )
          })
        )}
      </tbody>
    </TablePanel>
  )

  // Beside the table rather than in it: on a phone the table is not drawn,
  // and a question inside it would never open.
  return (
    <>
      {table}
      <Confirm
        open={removing !== null}
        title={`${removing?.name ?? 'Feld'} entfernen?`}
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
        {removing && removing.inside > 0
          ? `Mit dem Feld gehen ${circuitsInWords(removing.inside)} samt ihren Betriebsmitteln.`
          : 'Das Feld ist leer, es geht nichts mit.'}
      </Confirm>
    </>
  )
}

/**
 * The device in the words of the card "Schutzeinrichtung": "LS-Schalter",
 * where the list of choices says "Leitungsschutzschalter (LS)" and the chart
 * "LS".
 */
const deviceWord: Readonly<Record<OvercurrentDevice, string>> = {
  circuit_breaker: 'LS-Schalter',
  rcbo: 'FI/LS-Schalter',
  fuse_d: 'Schmelzsicherung D (DIAZED)',
  fuse_d0: 'Schmelzsicherung D0 (NEOZED)',
  fuse_nh: 'NH-Sicherung',
}

/** "Typ A, 30 mA", as the card writes the RCD on a line of its own. */
function rcdLine(figures: CircuitFigures): string | null {
  const parts = [
    figures.rcdType === null ? null : `Typ ${rcdTypeLabel[figures.rcdType]}`,
    figures.ratedResidualCurrentMilli === null
      ? null
      : `${String(figures.ratedResidualCurrentMilli)} mA`,
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? null : parts.join(', ')
}

/** The facts of a circuit in two cards, as `stromkreis_detail()` draws them. */
function CircuitDetail({ circuitId }: { readonly circuitId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const writes = useMay('installation.write')
  const circuit = useRecord('circuits', circuitId)
  const boardId = text(circuit, 'distributionBoardId')
  const board = useRecord('distribution_boards', boardId)
  const section = useRecord('board_sections', maybeText(circuit, 'boardSectionId') ?? undefined)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)
  const equipment = useEquipment(circuitId)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!circuit) {
    return null
  }

  const name = [text(circuit, 'designation'), maybeText(circuit, 'consumer')]
    .filter(Boolean)
    .join(', ')
  const figures = figuresOf(circuit)
  // The circuits of its own group, the section or the board directly, for
  // moving it among them.
  const group = ordered(
    circuits.filter(
      (other) =>
        (maybeText(other, 'boardSectionId') ?? null) ===
        (maybeText(circuit, 'boardSectionId') ?? null),
    ),
  )
  const index = group.findIndex((other) => String(other['id']) === circuitId)

  async function move(step: -1 | 1) {
    const refused = await moveAmong(client, 'circuits', group, circuitId, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  async function remove() {
    setRemoving(false)

    const result = await client.remove('circuits', circuitId)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await navigate({ to: `/verteiler/${boardId}` })
  }

  if (editing) {
    return (
      <Detail title={`${name} bearbeiten`}>
        <CircuitForm
          record={circuit}
          sections={sections}
          submitLabel="Speichern"
          onCancel={() => {
            setEditing(false)
          }}
          onSubmit={async (values) => {
            const saved = await client.update('circuits', circuitId, values)

            if (saved.outcome === 'queued') {
              setEditing(false)
            }

            return saved
          }}
        />
      </Detail>
    )
  }

  const empty = <span className="text-ink-faint">nicht angegeben</span>

  return (
    <Detail
      title={name}
      sub={[text(board, 'designation'), section ? text(section, 'designation') : null]
        .filter(Boolean)
        .join(', ')}
      actions={
        writes ? (
          <>
            {/* Not drawn on the canvas, and needed: the order of a board is
                the order of its chart. */}
            <SmallIcon
              compact
              label={`${text(circuit, 'designation')} nach oben`}
              disabled={index <= 0}
              onClick={() => void move(-1)}
            >
              <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
            </SmallIcon>
            <SmallIcon
              compact
              label={`${text(circuit, 'designation')} nach unten`}
              disabled={index < 0 || index === group.length - 1}
              onClick={() => void move(1)}
            >
              <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
            </SmallIcon>
            <Button size="small" icon={Pencil} onClick={() => setEditing(true)}>
              Bearbeiten
            </Button>
            <RemoveButton onClick={() => setRemoving(true)}>Stromkreis löschen</RemoveButton>
          </>
        ) : null
      }
    >
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      {client.isPending('circuits', circuitId) ? (
        <p className="text-[13px] text-ink-muted">Noch nicht übertragen.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Schutzeinrichtung" onGround>
          <FactList
            facts={[
              {
                label: 'Sicherung',
                value:
                  figures.overcurrentDevice === null ? null : deviceWord[figures.overcurrentDevice],
              },
              {
                label: 'Nennstrom',
                value:
                  figures.ratedCurrentMilli === null
                    ? null
                    : `${milliText(figures.ratedCurrentMilli)} A`,
              },
              {
                label: 'Charakteristik',
                value:
                  figures.tripCharacteristic === null
                    ? null
                    : tripCharacteristicLabel[figures.tripCharacteristic],
              },
              { label: 'RCD', value: rcdLine(figures) ?? empty },
            ]}
          />
        </Panel>
        {/* The consumer is in the name above, as the card leaves it out. */}
        <Panel title="Leitung und Verbraucher" onGround>
          <FactList
            facts={[
              { label: 'Typ', value: figures.cableType },
              { label: 'Querschnitt', value: cableSizeText(figures) },
              { label: 'Länge', value: cableLengthText(figures) },
              {
                label: 'Verlegeart',
                value:
                  figures.cableInstallationMethod === null
                    ? null
                    : cableInstallationMethodName[figures.cableInstallationMethod],
              },
            ]}
          />
        </Panel>
      </div>

      <EquipmentTable circuitId={circuitId} equipment={equipment} writes={writes} />

      <Confirm
        open={removing}
        title={`${text(circuit, 'designation')} löschen?`}
        confirm="Löschen"
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(false)
        }}
      >
        {equipment.length === 0
          ? 'Der Stromkreis hat kein Betriebsmittel, es geht nichts mit.'
          : equipment.length === 1
            ? 'Mit dem Stromkreis geht sein Betriebsmittel.'
            : `Mit dem Stromkreis gehen seine ${String(equipment.length)} Betriebsmittel.`}
      </Confirm>
    </Detail>
  )
}

/** "Betriebsmittel": what hangs on a circuit, in order. */
function EquipmentTable({
  circuitId,
  equipment,
  writes,
}: {
  readonly circuitId: string
  readonly equipment: readonly RecordState[]
  readonly writes: boolean
}) {
  const client = useSync()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ readonly id: string; readonly name: string } | null>(
    null,
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const columns = writes ? 6 : 5

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'equipment', equipment, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('equipment', id)

    setTrouble(result.outcome === 'refused' ? refusalFor(result) : null)
  }

  const editForm = (item: RecordState) => {
    const id = String(item['id'])

    return (
      <RecordForm
        fields={equipmentFields}
        record={item}
        submitLabel="Speichern"
        onCancel={() => {
          setEditing(null)
        }}
        onSubmit={async (values) => {
          const saved = await client.update('equipment', id, asEquipment(values))

          if (saved.outcome === 'queued') {
            setEditing(null)
          }

          return saved
        }}
      />
    )
  }

  const reorder = (item: RecordState, index: number) => {
    const id = String(item['id'])
    const name = text(item, 'designation')

    return (
      <Reorder
        name={name}
        canUp={index > 0}
        canDown={index < equipment.length - 1}
        onMove={(step) => void move(id, step)}
        onEdit={() => {
          setAdding(false)
          setEditing(id)
        }}
        onRemove={() => setRemoving({ id, name })}
      />
    )
  }

  const cards = equipment.map((item, index) => {
    const id = String(item['id'])
    const serial = maybeText(item, 'serialNumber')

    return editing === id
      ? { key: id, title: text(item, 'designation'), form: editForm(item) }
      : {
          key: id,
          title: text(item, 'designation'),
          sub: [
            maybeText(item, 'kind'),
            maybeText(item, 'manufacturer'),
            maybeText(item, 'model'),
            serial ? `SN ${serial}` : null,
          ]
            .filter((part): part is string => part !== null && part !== '')
            .join(' · '),
          right: client.isPending('equipment', id) ? 'noch nicht übertragen' : null,
          actions: writes ? reorder(item, index) : null,
        }
  })

  const form = adding ? (
    <RecordForm
      fields={equipmentFields}
      submitLabel="Betriebsmittel anlegen"
      onCancel={() => {
        setAdding(false)
      }}
      onSubmit={async (values) => {
        const made = await client.create('equipment', {
          ...asEquipment(values),
          circuitId,
          position: nextPosition(equipment),
        })

        if (made.outcome === 'queued') {
          setAdding(false)
        }

        return made
      }}
    />
  ) : null

  const table = (
    <TablePanel
      title="Betriebsmittel"
      caption="Betriebsmittel des Stromkreises"
      lead={
        trouble || form ? (
          <>
            {trouble ? (
              <p role="alert" className="text-[13px] font-semibold text-conflict">
                {trouble}
              </p>
            ) : null}
            {form}
          </>
        ) : null
      }
      action={
        writes && !adding ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              setEditing(null)
              setAdding(true)
            }}
          >
            Betriebsmittel anlegen
          </Button>
        ) : null
      }
      cards={cards}
      cardsEmpty="Noch kein Betriebsmittel an diesem Stromkreis."
    >
      <thead>
        <tr>
          <Column>Bezeichnung</Column>
          <Column className="w-[120px]">Art</Column>
          <Column className="w-[110px]">Hersteller</Column>
          <Column className="w-[110px]">Typ</Column>
          <Column className="w-[120px]">Seriennummer</Column>
          {writes ? (
            <Column numeric className="w-[110px]">
              Ändern
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {equipment.length === 0 ? (
          <tr>
            <Cell colSpan={columns} className="text-ink-muted">
              Noch kein Betriebsmittel an diesem Stromkreis.
            </Cell>
          </tr>
        ) : (
          equipment.map((item, index) => {
            const id = String(item['id'])
            const name = text(item, 'designation')

            if (editing === id) {
              return (
                <tr key={id}>
                  <Cell colSpan={columns}>{editForm(item)}</Cell>
                </tr>
              )
            }

            return (
              <tr key={id}>
                <Cell>
                  {name}
                  {client.isPending('equipment', id) ? (
                    <span className="block text-[13px] text-ink-faint">noch nicht übertragen</span>
                  ) : null}
                </Cell>
                <Cell>{maybeText(item, 'kind') ?? ''}</Cell>
                <Cell>{maybeText(item, 'manufacturer') ?? ''}</Cell>
                <Cell>{maybeText(item, 'model') ?? ''}</Cell>
                <Cell className="numeric">{maybeText(item, 'serialNumber') ?? ''}</Cell>
                {writes ? <Cell numeric>{reorder(item, index)}</Cell> : null}
              </tr>
            )
          })
        )}
      </tbody>
    </TablePanel>
  )

  // Beside the table rather than in it: on a phone the table is not drawn,
  // and a question inside it would never open.
  return (
    <>
      {table}
      <Confirm
        open={removing !== null}
        title={`${removing?.name ?? 'Betriebsmittel'} entfernen?`}
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
        Das Betriebsmittel steht danach nicht mehr am Stromkreis.
      </Confirm>
    </>
  )
}

/** A new board of the installation, in the place of the detail. */
function NewBoard({
  installationId,
  onDone,
}: {
  readonly installationId: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const boards = useBoards(installationId)

  return (
    <Detail title="Neuer Verteiler">
      <RecordForm
        fields={boardFields}
        record={newBoard(boards)}
        submitLabel="Verteiler anlegen"
        onCancel={onDone}
        onSubmit={async (values) => {
          const made = await client.create('distribution_boards', {
            ...asBoard(values),
            installationId,
            position: nextPosition(boards),
          })

          if (made.outcome === 'queued') {
            onDone()
            await navigate({ to: `/verteiler/${made.id}` })
          }

          return made
        }}
      />
    </Detail>
  )
}

/**
 * A new circuit on a board, in the place of the detail. It starts in the
 * section the last one went into: somebody writing down a field of twelve
 * circuits picks it once, not twelve times.
 */
function NewCircuit({
  boardId,
  onDone,
}: {
  readonly boardId: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const board = useRecord('distribution_boards', boardId)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)

  return (
    <Detail title={`Neuer Stromkreis in ${text(board, 'designation')}`}>
      <CircuitForm
        sections={sections}
        section={lastSection.get(boardId) ?? null}
        submitLabel="Stromkreis anlegen"
        onCancel={onDone}
        onSubmit={async (values) => {
          const section =
            typeof values['boardSectionId'] === 'string' ? values['boardSectionId'] : null
          const made = await client.create('circuits', {
            ...values,
            distributionBoardId: boardId,
            position: nextPosition(
              ordered(
                circuits.filter(
                  (circuit) => (maybeText(circuit, 'boardSectionId') ?? null) === section,
                ),
              ),
            ),
          })

          if (made.outcome === 'queued') {
            lastSection.set(boardId, section)
            onDone()
            await navigate({ to: `/stromkreise/${made.id}` })
          }

          return made
        }}
      />
    </Detail>
  )
}
