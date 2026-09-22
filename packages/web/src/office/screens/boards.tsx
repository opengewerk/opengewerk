import type { RecordState } from '@opengewerk/domain'
import {
  cableInstallationMethodLabel,
  cableLengthText,
  cableText,
  distributionBoardKindLabel,
  overcurrentText,
  rcdText,
} from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Fragment, useState } from 'react'

import { Button, Card, Cell, Column, IconButton, Table } from '../../components/index.js'
import {
  asBoard,
  asSection,
  boardFields,
  boardKindOf,
  circuitChartAddress,
  CircuitForm,
  circuitsInWords,
  figuresOf,
  moveAmong,
  newBoard,
  nextPosition,
  ordered,
  sectionFields,
  useBoards,
  useCircuits,
  useSections,
} from '../../app/electrical.js'
import { RecordForm } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useSync, useSyncStatus } from '../../sync/provider.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'

/** A link that looks like a secondary button, for the chart, which opens in a tab of its own. */
const linkButton =
  'inline-flex items-center justify-center h-control min-h-tap px-4 rounded-control text-body font-semibold bg-surface text-ink border border-line-strong'

/**
 * The way to the circuit chart, and the sentence when it cannot help.
 *
 * The chart is printed by the server, out of what the server holds. Without a
 * connection there is nothing to print from, and with changes still in the
 * outbox the chart would leave them out, so the link says so instead of
 * handing somebody a sheet for the door that is already out of date.
 */
function ChartLink({
  href,
  label,
  pending,
}: {
  readonly href: string
  readonly label: string
  readonly pending: boolean
}) {
  const { online } = useSyncStatus()

  if (!online) {
    return (
      <Button
        disabled
        title="Das Stromkreisverzeichnis druckt der Server, dafür braucht es Verbindung."
      >
        {label}
      </Button>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkButton}>
        {label}
      </a>
      {pending ? (
        <span className="text-table text-ink-muted">
          Noch nicht Übertragenes fehlt im Ausdruck.
        </span>
      ) : null}
    </span>
  )
}

/**
 * The boards of an installation, on the installation's screen: what there is,
 * a way to add one, and the chart of all of them.
 */
export function BoardsSection({ installationId }: { readonly installationId: string }) {
  const client = useSync()
  const boards = useBoards(installationId)
  const circuits = useRecords('circuits')
  const [adding, setAdding] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const pending = boards.some((board) =>
    client.isPending('distribution_boards', String(board['id'])),
  )

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'distribution_boards', boards, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalText[refused.reason] : null)
  }

  return (
    <Section
      title="Verteiler"
      actions={
        <span className="inline-flex flex-wrap items-start gap-2">
          {boards.length > 0 ? (
            <ChartLink
              href={circuitChartAddress(installationId)}
              label="Stromkreisverzeichnis"
              pending={pending}
            />
          ) : null}
          <Button
            tone="secondary"
            onClick={() => {
              setAdding((open) => !open)
            }}
          >
            {adding ? 'Abbrechen' : 'Verteiler anlegen'}
          </Button>
        </span>
      }
    >
      {trouble ? (
        <p role="alert" className="mb-3 text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {adding ? (
        <div className="mb-4">
          <RecordForm
            fields={boardFields}
            record={newBoard(boards)}
            submitLabel="Anlegen"
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
        </div>
      ) : null}

      {boards.length === 0 ? (
        <Nothing>
          Noch kein Verteiler. Hauptverteilung und Unterverteilungen stehen hier, darunter ihre
          Felder, Stromkreise und Betriebsmittel.
        </Nothing>
      ) : (
        <ul className="flex flex-col gap-2">
          {boards.map((board, index) => {
            const id = String(board['id'])
            const count = circuits.filter((circuit) => circuit['distributionBoardId'] === id).length
            const designation = text(board, 'designation')

            return (
              <li key={id} className="flex items-stretch gap-2">
                <Link
                  to={`/verteiler/${id}`}
                  className="grow flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 rounded-card border border-line bg-surface"
                >
                  <span className="text-body font-semibold text-copper-text underline underline-offset-2">
                    {designation}
                  </span>
                  <span className="text-table text-ink-muted">
                    {[
                      distributionBoardKindLabel[boardKindOf(board)],
                      maybeText(board, 'location'),
                      circuitsInWords(count),
                      client.isPending('distribution_boards', id) ? 'noch nicht übertragen' : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(', ')}
                  </span>
                </Link>
                <span className="inline-flex items-center gap-1">
                  <IconButton
                    label={`${designation} nach oben`}
                    title="Nach oben"
                    disabled={index === 0}
                    onClick={() => void move(id, -1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label={`${designation} nach unten`}
                    title="Nach unten"
                    disabled={index === boards.length - 1}
                    onClick={() => void move(id, 1)}
                  >
                    ↓
                  </IconButton>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

/**
 * One board: its sections, its circuits in the order of the board, and the
 * chart for its door.
 */
export function BoardScreen() {
  const { boardId } = useParams({ strict: false }) as { boardId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const board = useRecord('distribution_boards', boardId)
  const installationId = board ? String(board['installationId']) : undefined
  const installation = useRecord('installations', installationId)
  const site = useRecord('sites', installation ? String(installation['siteId']) : undefined)
  const customer = useRecord('customers', site ? String(site['customerId']) : undefined)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!board || !boardId || !installationId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>
          Diesen Verteiler gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.
        </Nothing>
      </Page>
    )
  }

  const pending =
    client.isPending('distribution_boards', boardId) ||
    sections.some((section) => client.isPending('board_sections', String(section['id']))) ||
    circuits.some((circuit) => client.isPending('circuits', String(circuit['id'])))

  async function remove() {
    setTrouble(null)

    const result = await client.remove('distribution_boards', String(boardId))

    if (result.outcome === 'refused') {
      setTrouble(refusalText[result.reason])
      setRemoving(false)

      return
    }

    await navigate({ to: `/anlagen/${String(installationId)}` })
  }

  return (
    <Page
      crumbs={
        <>
          <Crumb to="/">Kunden</Crumb>
          {customer ? (
            <Crumb to={`/kunden/${String(customer['id'])}`}>{text(customer, 'name')}</Crumb>
          ) : null}
          {site ? (
            <Crumb to={`/objekte/${String(site['id'])}`}>{text(site, 'designation')}</Crumb>
          ) : null}
          {installation ? (
            <Crumb to={`/anlagen/${installationId}`}>{text(installation, 'designation')}</Crumb>
          ) : null}
        </>
      }
      title={text(board, 'designation')}
      meta={[distributionBoardKindLabel[boardKindOf(board)], maybeText(board, 'location')]
        .filter((part): part is string => part !== null)
        .join(', ')}
      actions={
        <span className="inline-flex flex-wrap items-start gap-2">
          <ChartLink
            href={circuitChartAddress(installationId, boardId)}
            label="Stromkreisverzeichnis"
            pending={pending}
          />
          <Button
            tone="secondary"
            onClick={() => {
              setEditing((open) => !open)
            }}
          >
            {editing ? 'Bearbeiten beenden' : 'Bearbeiten'}
          </Button>
          {removing ? (
            <>
              <Button tone="danger" onClick={() => void remove()}>
                Löschen
              </Button>
              <Button
                tone="quiet"
                onClick={() => {
                  setRemoving(false)
                }}
              >
                Behalten
              </Button>
            </>
          ) : (
            <Button
              tone="danger"
              onClick={() => {
                setRemoving(true)
              }}
            >
              Verteiler löschen
            </Button>
          )}
        </span>
      }
    >
      {removing ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {`Mit dem Verteiler gehen ${sectionsInWords(sections.length)} und ${circuitsInWords(
            circuits.length,
          )} samt ihren Betriebsmitteln.`}
        </p>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {editing ? (
        <Card label="Verteiler bearbeiten">
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
        </Card>
      ) : (
        <Card label="Verteiler">
          <Facts>
            <Fact label="Anlage">
              {installation ? (
                <Link
                  to={`/anlagen/${installationId}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(installation, 'designation')}
                </Link>
              ) : null}
            </Fact>
            <Fact label="Art">{distributionBoardKindLabel[boardKindOf(board)]}</Fact>
            <Fact label="Ort">{maybeText(board, 'location')}</Fact>
          </Facts>
        </Card>
      )}

      <SectionsCard boardId={boardId} sections={sections} circuits={circuits} />
      <CircuitsCard boardId={boardId} sections={sections} circuits={circuits} />
    </Page>
  )
}

/** "2 Felder", "1 Feld", "kein Feld". */
function sectionsInWords(count: number): string {
  if (count === 0) {
    return 'kein Feld'
  }

  return count === 1 ? '1 Feld' : `${String(count)} Felder`
}

/**
 * The sections of a board. A small sub distribution has none, and then this
 * is a line saying so and a button; a main distribution divided into fields
 * lists them here, in order, to rename, move and remove.
 */
function SectionsCard({
  boardId,
  sections,
  circuits,
}: {
  readonly boardId: string
  readonly sections: readonly RecordState[]
  readonly circuits: readonly RecordState[]
}) {
  const client = useSync()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'board_sections', sections, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalText[refused.reason] : null)
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('board_sections', id)

    setTrouble(result.outcome === 'refused' ? refusalText[result.reason] : null)
  }

  return (
    <Section
      title="Felder"
      actions={
        <Button
          tone="secondary"
          onClick={() => {
            setAdding((open) => !open)
          }}
        >
          {adding ? 'Abbrechen' : 'Feld anlegen'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {adding ? (
          <RecordForm
            fields={sectionFields}
            submitLabel="Anlegen"
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
        ) : null}

        {sections.length === 0 ? (
          <Nothing>
            Keine Felder. Ein kleiner Verteiler braucht keine, seine Stromkreise hängen direkt an
            ihm.
          </Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {sections.map((section, index) => {
              const id = String(section['id'])
              const inside = circuits.filter((circuit) => circuit['boardSectionId'] === id).length

              if (editing === id) {
                return (
                  <li key={id}>
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
                  </li>
                )
              }

              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body">
                    <span className="font-semibold">{text(section, 'designation')}</span>
                    <span className="text-table text-ink-muted">{`, ${circuitsInWords(inside)}`}</span>
                  </span>
                  {removing === id ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="text-table text-conflict font-semibold">
                        {inside > 0 ? `Mit dem Feld gehen ${circuitsInWords(inside)}.` : ''}
                      </span>
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
                    </span>
                  ) : (
                    <span className="inline-flex flex-wrap gap-1">
                      <IconButton
                        label={`${text(section, 'designation')} nach oben`}
                        title="Nach oben"
                        disabled={index === 0}
                        onClick={() => void move(id, -1)}
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        label={`${text(section, 'designation')} nach unten`}
                        title="Nach unten"
                        disabled={index === sections.length - 1}
                        onClick={() => void move(id, 1)}
                      >
                        ↓
                      </IconButton>
                      <IconButton
                        label={`${text(section, 'designation')} bearbeiten`}
                        title="Bearbeiten"
                        onClick={() => {
                          setEditing(id)
                        }}
                      >
                        ✎
                      </IconButton>
                      <IconButton
                        label={`${text(section, 'designation')} entfernen`}
                        title="Entfernen"
                        tone="danger"
                        onClick={() => {
                          setRemoving(id)
                        }}
                      >
                        ✕
                      </IconButton>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Section>
  )
}

/** The circuits of one section, or of the board directly when `section` is null. */
function groupOf(circuits: readonly RecordState[], section: string | null): readonly RecordState[] {
  return ordered(
    circuits.filter((circuit) => (maybeText(circuit, 'boardSectionId') ?? null) === section),
  )
}

/**
 * The circuits of a board, the way the chart lists them: the ones on the
 * board directly first, then each section with its own, each group in the
 * order of the board.
 */
function CircuitsCard({
  boardId,
  sections,
  circuits,
}: {
  readonly boardId: string
  readonly sections: readonly RecordState[]
  readonly circuits: readonly RecordState[]
}) {
  const client = useSync()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  // The section the last circuit went into. Somebody writing down a field of
  // twelve circuits picks it once, not twelve times.
  const [lastSection, setLastSection] = useState<string | null>(null)

  const known = new Set(sections.map((section) => String(section['id'])))
  // A circuit whose section is gone, or not on this device yet, hangs on the
  // board directly here, the way the chart prints it.
  const direct = ordered(
    circuits.filter((circuit) => {
      const section = maybeText(circuit, 'boardSectionId')

      return section === null || !known.has(section)
    }),
  )
  const groups = [
    ...(direct.length > 0 || sections.length === 0 ? [{ section: null, circuits: direct }] : []),
    ...sections.map((section) => ({
      section,
      circuits: groupOf(circuits, String(section['id'])),
    })),
  ]
  const width = 8

  async function move(group: readonly RecordState[], id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'circuits', group, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalText[refused.reason] : null)
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('circuits', id)

    setTrouble(result.outcome === 'refused' ? refusalText[result.reason] : null)
  }

  return (
    <Section
      title="Stromkreise"
      actions={
        <Button
          tone="secondary"
          onClick={() => {
            setEditing(null)
            setAdding((open) => !open)
          }}
        >
          {adding ? 'Abbrechen' : 'Stromkreis anlegen'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {adding ? (
          <CircuitForm
            sections={sections}
            section={lastSection}
            submitLabel="Anlegen"
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
        ) : null}

        {circuits.length === 0 ? (
          <Nothing>Noch kein Stromkreis.</Nothing>
        ) : (
          <div className="overflow-x-auto">
            <Table caption="Stromkreise des Verteilers">
              <thead>
                <tr>
                  <Column>Stromkreis</Column>
                  <Column>Verbraucher</Column>
                  <Column>Schutzeinrichtung</Column>
                  <Column>RCD</Column>
                  <Column>Leitung</Column>
                  <Column numeric>Länge</Column>
                  <Column>Verlegeart</Column>
                  <Column>Ändern</Column>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.section ? String(group.section['id']) : 'direct'}>
                    {sections.length > 0 ? (
                      <tr className="bg-surface-sunken">
                        <Cell colSpan={width} className="font-semibold">
                          {group.section ? text(group.section, 'designation') : 'Ohne Feld'}
                        </Cell>
                      </tr>
                    ) : null}
                    {group.circuits.length === 0 && group.section ? (
                      <tr>
                        <Cell colSpan={width} className="text-ink-muted">
                          In diesem Feld ist noch kein Stromkreis.
                        </Cell>
                      </tr>
                    ) : null}
                    {group.circuits.map((circuit, index) => {
                      const id = String(circuit['id'])
                      const figures = figuresOf(circuit)
                      const designation = text(circuit, 'designation')

                      if (editing === id) {
                        return (
                          <tr key={id}>
                            <Cell colSpan={width}>
                              <CircuitForm
                                record={circuit}
                                sections={sections}
                                submitLabel="Speichern"
                                onCancel={() => {
                                  setEditing(null)
                                }}
                                onSubmit={async (values) => {
                                  const saved = await client.update('circuits', id, values)

                                  if (saved.outcome === 'queued') {
                                    setEditing(null)
                                  }

                                  return saved
                                }}
                              />
                            </Cell>
                          </tr>
                        )
                      }

                      return (
                        <tr key={id}>
                          <Cell className="font-semibold whitespace-nowrap">
                            <Link
                              to={`/stromkreise/${id}`}
                              className="text-copper-text underline underline-offset-2"
                            >
                              {designation}
                            </Link>
                            {client.isPending('circuits', id) ? (
                              <span className="block text-table font-normal text-ink-muted">
                                noch nicht übertragen
                              </span>
                            ) : null}
                          </Cell>
                          <Cell>{maybeText(circuit, 'consumer') ?? ''}</Cell>
                          <Cell className="whitespace-nowrap">
                            {overcurrentText(figures) ?? ''}
                          </Cell>
                          <Cell className="whitespace-nowrap">{rcdText(figures) ?? ''}</Cell>
                          <Cell className="whitespace-nowrap">{cableText(figures) ?? ''}</Cell>
                          <Cell numeric>{cableLengthText(figures) ?? ''}</Cell>
                          <Cell>
                            {figures.cableInstallationMethod === null
                              ? ''
                              : cableInstallationMethodLabel[figures.cableInstallationMethod]}
                          </Cell>
                          <Cell>
                            {removing === id ? (
                              <span className="inline-flex flex-wrap gap-2">
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
                              </span>
                            ) : (
                              <span className="inline-flex flex-wrap gap-1">
                                <IconButton
                                  label={`${designation} nach oben`}
                                  title="Nach oben"
                                  disabled={index === 0}
                                  onClick={() => void move(group.circuits, id, -1)}
                                >
                                  ↑
                                </IconButton>
                                <IconButton
                                  label={`${designation} nach unten`}
                                  title="Nach unten"
                                  disabled={index === group.circuits.length - 1}
                                  onClick={() => void move(group.circuits, id, 1)}
                                >
                                  ↓
                                </IconButton>
                                <IconButton
                                  label={`${designation} bearbeiten`}
                                  title="Bearbeiten"
                                  onClick={() => {
                                    setAdding(false)
                                    setEditing(id)
                                  }}
                                >
                                  ✎
                                </IconButton>
                                <IconButton
                                  label={`${designation} entfernen`}
                                  title="Entfernen"
                                  tone="danger"
                                  onClick={() => {
                                    setRemoving(id)
                                  }}
                                >
                                  ✕
                                </IconButton>
                              </span>
                            )}
                          </Cell>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Section>
  )
}
