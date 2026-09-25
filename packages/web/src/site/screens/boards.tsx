import type { RecordState } from '@opengewerk/domain'
import { distributionBoardKindLabel } from '@opengewerk/domain'
import { Link, useParams } from '@tanstack/react-router'
import { ChevronRight, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'

import { Button, Panel } from '../../components/index.js'
import {
  asBoard,
  asEquipment,
  boardFields,
  boardKindOf,
  boardTitle,
  circuitFacts,
  CircuitForm,
  circuitsInWords,
  circuitSummary,
  equipmentFields,
  newBoard,
  nextPosition,
  ordered,
  useBoards,
  useCircuits,
  useEquipment,
  useSections,
} from '../../app/electrical.js'
import { RecordForm } from '../../app/record-form.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useSync } from '../../sync/provider.js'
import { SiteHeader } from '../header.js'
import { NotSent, SiteFacts, SiteLabel, SiteRow, SiteRows, SiteScreen, SiteText } from '../kit.js'

/**
 * The structure of an installation on site: read it, and add what is missing.
 *
 * A technician stands in front of a board in which a circuit is not written
 * down, and writes it down, without a network like everything here. Moving
 * and removing parts is left to the office, where the whole board is on one
 * screen; a thumb on a roof should not be one tap away from deleting a field
 * with twelve circuits in it.
 */

/** The boards of the job's installation, in its card on the job's screen. */
export function InstallationBoards({
  jobId,
  installationId,
}: {
  readonly jobId: string
  readonly installationId: string
}) {
  const client = useSync()
  const boards = useBoards(installationId)
  const circuits = useRecords('circuits')
  const [adding, setAdding] = useState(false)

  // In the card "Anlage" as the board draws it: "Verteiler" in small
  // capitals over a row per board, and the way to one more under them.
  return (
    <>
      <section aria-label="Verteiler">
        <SiteLabel className="mt-1">Verteiler</SiteLabel>
        {boards.length === 0 ? (
          <p className="py-2 text-[16px] leading-[1.45] text-ink-muted">
            Für diese Anlage ist noch kein Verteiler erfasst.
          </p>
        ) : (
          <SiteRows>
            {boards.map((board) => {
              const id = String(board['id'])
              const count = circuits.filter(
                (circuit) => circuit['distributionBoardId'] === id,
              ).length

              return (
                <SiteRow
                  key={id}
                  to={`/auftraege/${jobId}/verteiler/${id}`}
                  title={text(board, 'designation')}
                  meta={
                    <>
                      {[
                        distributionBoardKindLabel[boardKindOf(board)],
                        maybeText(board, 'location'),
                        circuitsInWords(count),
                      ]
                        .filter((part): part is string => part !== null)
                        .join(', ')}
                      {client.isPending('distribution_boards', id) ? (
                        <>
                          {', '}
                          <NotSent />
                        </>
                      ) : null}
                    </>
                  }
                />
              )
            })}
          </SiteRows>
        )}
      </section>

      {adding ? (
        <RecordForm
          fields={boardFields}
          record={newBoard(boards)}
          submitLabel="Verteiler sichern"
          onCancel={() => {
            setAdding(false)
          }}
          onSubmit={async (values) => {
            const made = await client.create('distribution_boards', {
              ...asBoard(values),
              installationId,
              position: nextPosition(boards),
            })

            if (made.outcome === 'queued') {
              setAdding(false)
            }

            return made
          }}
        />
      ) : (
        <Button
          wide
          height={48}
          icon={Plus}
          onClick={() => {
            setAdding(true)
          }}
        >
          Verteiler nachtragen
        </Button>
      )}
    </>
  )
}

/** The circuits of one section, or of the board directly when `section` is null. */
function groupOf(circuits: readonly RecordState[], section: string | null): readonly RecordState[] {
  return ordered(
    circuits.filter((circuit) => (maybeText(circuit, 'boardSectionId') ?? null) === section),
  )
}

/**
 * A circuit of a board, `circuit_card()` of the board "Verteiler mit
 * Stromkreisen": its name on slate, as it is printed in the cabinet, what it
 * feeds, how it is protected and wired, and the chevron that opens it.
 */
function CircuitCard({
  jobId,
  boardId,
  circuit,
}: {
  readonly jobId: string
  readonly boardId: string
  readonly circuit: RecordState
}) {
  const client = useSync()
  const id = String(circuit['id'])
  const summary = circuitSummary(circuit)
  const consumer = maybeText(circuit, 'consumer')

  return (
    <li>
      <Link
        to={`/auftraege/${jobId}/verteiler/${boardId}/stromkreise/${id}`}
        className="flex min-h-16 items-center gap-2.5 rounded-[6px] border border-line bg-surface px-3 py-2.5 text-ink no-underline"
      >
        <span className="shrink-0 rounded-[4px] bg-top px-2 py-[3px] font-condensed text-[17px] font-semibold text-top-ink">
          {text(circuit, 'designation')}
        </span>
        {/* Heard as "F2 Steckdosen Küche" and not as one word. */}{' '}
        <span className="min-w-0 grow">
          <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
            {consumer ?? text(circuit, 'designation')}
          </span>
          <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">
            {summary ?? 'Noch nichts zu Sicherung und Leitung eingetragen'}
            {client.isPending('circuits', id) ? (
              <>
                {', '}
                <NotSent />
              </>
            ) : null}
          </span>
        </span>
        <ChevronRight
          size={20}
          strokeWidth={2.2}
          aria-hidden="true"
          className="shrink-0 text-ink-faint"
        />
      </Link>
    </li>
  )
}

/**
 * One board on site, the board "Verteiler mit Stromkreisen": its circuits,
 * section by section, and the way to add one at the top.
 */
export function SiteBoardScreen() {
  const { jobId, boardId } = useParams({ strict: false }) as { jobId?: string; boardId?: string }
  const client = useSync()
  const board = useRecord('distribution_boards', boardId)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)
  const [adding, setAdding] = useState(false)
  // The section the last circuit went into, so that a field of twelve is
  // picked once and not twelve times.
  const [lastSection, setLastSection] = useState<string | null>(null)

  if (!board || !boardId || !jobId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen Verteiler hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  const known = new Set(sections.map((section) => String(section['id'])))
  const direct = ordered(
    circuits.filter((circuit) => {
      const section = maybeText(circuit, 'boardSectionId')

      return section === null || !known.has(section)
    }),
  )
  const groups = [
    ...(direct.length > 0 || sections.length === 0
      ? [{ key: 'direct', title: sections.length > 0 ? 'Ohne Feld' : null, circuits: direct }]
      : []),
    ...sections.map((section) => ({
      key: String(section['id']),
      title: text(section, 'designation'),
      circuits: groupOf(circuits, String(section['id'])),
    })),
  ]

  return (
    <SiteScreen gap={10}>
      <SiteHeader
        title={text(board, 'designation')}
        sub={[distributionBoardKindLabel[boardKindOf(board)], maybeText(board, 'location')]
          .filter(Boolean)
          .join(', ')}
      />

      {adding ? (
        <Panel title="Stromkreis nachtragen">
          <CircuitForm
            sections={sections}
            section={lastSection}
            submitLabel="Stromkreis sichern"
            onCancel={() => {
              setAdding(false)
            }}
            onSubmit={async (values) => {
              const section =
                typeof values['boardSectionId'] === 'string' ? values['boardSectionId'] : null
              const made = await client.create('circuits', {
                ...values,
                distributionBoardId: boardId,
                position: nextPosition(groupOf(circuits, section)),
              })

              if (made.outcome === 'queued') {
                setLastSection(section)
                setAdding(false)
              }

              return made
            }}
          />
        </Panel>
      ) : (
        <>
          <Button
            tone="primary"
            wide
            height={52}
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            Stromkreis nachtragen
          </Button>

          {circuits.length === 0 ? (
            <Panel title="Keine Stromkreise">
              <SiteText>In diesem Verteiler ist noch kein Stromkreis erfasst.</SiteText>
            </Panel>
          ) : (
            groups.map((group) => (
              <section
                key={group.key}
                aria-label={group.title ?? boardTitle(board)}
                className="flex flex-col gap-2.5"
              >
                {group.title ? (
                  <h2 className="mt-1.5 text-[19px] font-bold">{group.title}</h2>
                ) : null}
                {group.circuits.length === 0 ? (
                  <SiteText muted>In diesem Feld ist noch kein Stromkreis.</SiteText>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {group.circuits.map((circuit) => (
                      <CircuitCard
                        key={String(circuit['id'])}
                        jobId={jobId}
                        boardId={boardId}
                        circuit={circuit}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}
        </>
      )}
    </SiteScreen>
  )
}

/**
 * One circuit on site, the board "Stromkreis mit Betriebsmitteln": what is
 * known, a way to fill in the rest, and its equipment. Filling in is the
 * board "Stromkreis, Angaben ergänzen", the form alone with its two buttons
 * at the foot.
 */
export function SiteCircuitScreen() {
  const { circuitId } = useParams({ strict: false }) as { circuitId?: string }
  const client = useSync()
  const circuit = useRecord('circuits', circuitId)
  const boardId = circuit ? String(circuit['distributionBoardId']) : undefined
  const sections = useSections(boardId)
  const section = useRecord('board_sections', maybeText(circuit, 'boardSectionId') ?? undefined)
  const board = useRecord('distribution_boards', boardId)
  const equipment = useEquipment(circuitId)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)

  if (!circuit || !circuitId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen Stromkreis hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  const facts = circuitFacts(circuit)

  return (
    <SiteScreen>
      <SiteHeader
        title={text(circuit, 'designation')}
        sub={
          editing
            ? 'Angaben ergänzen'
            : [
                'Stromkreis',
                section ? text(section, 'designation') : '',
                board ? text(board, 'designation') : '',
              ]
                .filter((part) => part !== '')
                .join(', ')
        }
      />

      {editing ? (
        <CircuitForm
          record={circuit}
          sections={sections}
          submitLabel="Angaben sichern"
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
      ) : (
        <>
          <Panel title="Was bekannt ist">
            {facts.length === 0 ? (
              <SiteText muted>
                Zu diesem Stromkreis ist noch nichts eingetragen außer der Bezeichnung.
              </SiteText>
            ) : (
              <SiteFacts facts={facts} />
            )}
          </Panel>
          <Button
            tone="primary"
            wide
            height={52}
            icon={Pencil}
            onClick={() => {
              setEditing(true)
            }}
          >
            Angaben ergänzen
          </Button>

          <Panel title="Betriebsmittel">
            <div className="flex flex-col gap-2">
              {equipment.length === 0 ? (
                <SiteText muted>Noch kein Betriebsmittel an diesem Stromkreis.</SiteText>
              ) : (
                <ul aria-label="Betriebsmittel" className="flex flex-col">
                  {equipment.map((item) => (
                    <li
                      key={String(item['id'])}
                      className="flex min-h-14 flex-col justify-center border-b border-row py-2"
                    >
                      <span className="text-[17px] font-semibold [overflow-wrap:anywhere]">
                        {text(item, 'designation')}
                      </span>
                      <span className="mt-0.5 text-[15px] leading-[1.35] text-ink-muted">
                        {[
                          maybeText(item, 'kind'),
                          maybeText(item, 'manufacturer'),
                          maybeText(item, 'model'),
                          maybeText(item, 'serialNumber')
                            ? `SN ${text(item, 'serialNumber')}`
                            : null,
                        ]
                          .filter((part): part is string => part !== null)
                          .join(', ')}
                        {client.isPending('equipment', String(item['id'])) ? (
                          <>
                            {', '}
                            <NotSent />
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {adding ? (
                <RecordForm
                  fields={equipmentFields}
                  submitLabel="Betriebsmittel sichern"
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
              ) : (
                <Button
                  wide
                  height={48}
                  icon={Plus}
                  onClick={() => {
                    setAdding(true)
                  }}
                >
                  Betriebsmittel nachtragen
                </Button>
              )}
            </div>
          </Panel>
        </>
      )}
    </SiteScreen>
  )
}
