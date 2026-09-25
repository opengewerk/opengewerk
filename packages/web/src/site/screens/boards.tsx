import type { RecordState } from '@opengewerk/domain'
import { distributionBoardKindLabel } from '@opengewerk/domain'
import { Link, useParams } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, FieldLabel } from '../../components/index.js'
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
import { NotSent, SiteLabel, SiteRow, SiteRows } from '../kit.js'

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

  return (
    <li>
      <Link
        to={`/auftraege/${jobId}/verteiler/${boardId}/stromkreise/${id}`}
        className="flex flex-col gap-1 p-4 rounded-card border border-line bg-surface min-h-tap"
      >
        <span className="text-body">
          <span className="font-semibold">{text(circuit, 'designation')}</span>
          {maybeText(circuit, 'consumer') ? ` ${text(circuit, 'consumer')}` : ''}
        </span>
        <span className="text-body text-ink-muted">
          {summary ?? 'Noch nichts zu Sicherung und Leitung eingetragen'}
          {client.isPending('circuits', id) ? ', noch nicht übertragen' : ''}
        </span>
      </Link>
    </li>
  )
}

/** One board on site: its circuits, section by section, and the way to add one. */
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
      <div className="flex flex-col gap-4 p-4">
        <SiteHeader title="Nicht gefunden" />
        <p className="text-body">
          Diesen Verteiler hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </p>
      </div>
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
    <div className="flex flex-col gap-4 p-4">
      <SiteHeader
        title={text(board, 'designation')}
        sub={[distributionBoardKindLabel[boardKindOf(board)], maybeText(board, 'location')]
          .filter(Boolean)
          .join(', ')}
      />

      {adding ? (
        <Card label="Stromkreis nachtragen">
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
        </Card>
      ) : (
        <Button
          tone="primary"
          wide
          onClick={() => {
            setAdding(true)
          }}
        >
          Stromkreis nachtragen
        </Button>
      )}

      {circuits.length === 0 ? (
        <Card label="Keine Stromkreise" tone="sunken">
          <p className="text-body">In diesem Verteiler ist noch kein Stromkreis erfasst.</p>
        </Card>
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            aria-label={group.title ?? boardTitle(board)}
            className="flex flex-col gap-2"
          >
            {group.title ? <h2 className="text-body font-semibold">{group.title}</h2> : null}
            {group.circuits.length === 0 ? (
              <p className="text-body text-ink-muted">In diesem Feld ist noch kein Stromkreis.</p>
            ) : (
              <ul className="flex flex-col gap-2">
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
    </div>
  )
}

/** One circuit on site: what is known, a way to fill in the rest, and its equipment. */
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
      <div className="flex flex-col gap-4 p-4">
        <SiteHeader title="Nicht gefunden" />
        <p className="text-body">
          Diesen Stromkreis hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </p>
      </div>
    )
  }

  const facts = circuitFacts(circuit)

  return (
    <div className="flex flex-col gap-4 p-4">
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
        <Card label="Angaben ergänzen">
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
        </Card>
      ) : (
        <>
          <Card label="Was bekannt ist">
            {facts.length === 0 ? (
              <p className="text-body text-ink-muted">
                Zu diesem Stromkreis ist noch nichts eingetragen außer der Bezeichnung.
              </p>
            ) : (
              <dl className="flex flex-col gap-3">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>
                      <FieldLabel>{fact.label}</FieldLabel>
                    </dt>
                    <dd className="text-body">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
          <Button
            tone="primary"
            wide
            onClick={() => {
              setEditing(true)
            }}
          >
            Angaben ergänzen
          </Button>
        </>
      )}

      <Card label="Betriebsmittel">
        <div className="flex flex-col gap-3">
          <FieldLabel>Betriebsmittel</FieldLabel>
          {equipment.length === 0 ? (
            <p className="text-body text-ink-muted">
              Noch kein Betriebsmittel an diesem Stromkreis.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {equipment.map((item) => (
                <li key={String(item['id'])} className="flex flex-col gap-1">
                  <span className="text-body font-semibold">{text(item, 'designation')}</span>
                  <span className="text-body text-ink-muted">
                    {[
                      maybeText(item, 'kind'),
                      maybeText(item, 'manufacturer'),
                      maybeText(item, 'model'),
                      maybeText(item, 'serialNumber') ? `SN ${text(item, 'serialNumber')}` : null,
                      client.isPending('equipment', String(item['id']))
                        ? 'noch nicht übertragen'
                        : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(', ')}
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
              tone="secondary"
              wide
              onClick={() => {
                setAdding(true)
              }}
            >
              Betriebsmittel nachtragen
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}
