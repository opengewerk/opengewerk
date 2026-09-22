import type { RecordState } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Card, Cell, Column, IconButton, Table } from '../../components/index.js'
import {
  asEquipment,
  circuitFacts,
  CircuitForm,
  equipmentFields,
  moveAmong,
  nextPosition,
  useEquipment,
  useSections,
} from '../../app/electrical.js'
import { RecordForm } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useSync } from '../../sync/provider.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'

/**
 * One circuit: what feeds it and what it feeds, and the equipment on it.
 *
 * The circuit itself is edited here as on the board's screen, with the same
 * form; this screen is for what hangs below it, the sockets, luminaires and
 * devices, which a row in the board's table has no room for.
 */
export function CircuitScreen() {
  const { circuitId } = useParams({ strict: false }) as { circuitId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const circuit = useRecord('circuits', circuitId)
  const boardId = circuit ? String(circuit['distributionBoardId']) : undefined
  const board = useRecord('distribution_boards', boardId)
  const installationId = board ? String(board['installationId']) : undefined
  const installation = useRecord('installations', installationId)
  const section = useRecord('board_sections', maybeText(circuit, 'boardSectionId') ?? undefined)
  const sections = useSections(boardId)
  const equipment = useEquipment(circuitId)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!circuit || !circuitId || !boardId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>
          Diesen Stromkreis gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.
        </Nothing>
      </Page>
    )
  }

  async function remove() {
    setTrouble(null)

    const result = await client.remove('circuits', String(circuitId))

    if (result.outcome === 'refused') {
      setTrouble(refusalText[result.reason])
      setRemoving(false)

      return
    }

    await navigate({ to: `/verteiler/${String(boardId)}` })
  }

  return (
    <Page
      crumbs={
        <>
          <Crumb to="/">Kunden</Crumb>
          {installation && installationId ? (
            <Crumb to={`/anlagen/${installationId}`}>{text(installation, 'designation')}</Crumb>
          ) : null}
          {board ? <Crumb to={`/verteiler/${boardId}`}>{text(board, 'designation')}</Crumb> : null}
        </>
      }
      title={text(circuit, 'designation')}
      meta={maybeText(circuit, 'consumer') ?? undefined}
      actions={
        <span className="inline-flex flex-wrap gap-2">
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
              Stromkreis löschen
            </Button>
          )}
        </span>
      }
    >
      {removing && equipment.length > 0 ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {equipment.length === 1
            ? 'Mit dem Stromkreis geht sein Betriebsmittel.'
            : `Mit dem Stromkreis gehen seine ${String(equipment.length)} Betriebsmittel.`}
        </p>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {editing ? (
        <Card label="Stromkreis bearbeiten">
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
        </Card>
      ) : (
        <Card label="Stromkreis">
          <Facts>
            <Fact label="Verteiler">
              {board ? (
                <Link
                  to={`/verteiler/${boardId}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(board, 'designation')}
                </Link>
              ) : null}
            </Fact>
            <Fact label="Feld">{section ? text(section, 'designation') : null}</Fact>
            {circuitFacts(circuit).map((fact) => (
              <Fact key={fact.label} label={fact.label}>
                {fact.value}
              </Fact>
            ))}
          </Facts>
        </Card>
      )}

      <EquipmentSection circuitId={circuitId} />
    </Page>
  )
}

/** The equipment on a circuit, in order, to add, change, move and remove. */
function EquipmentSection({ circuitId }: { readonly circuitId: string }) {
  const client = useSync()
  const equipment = useEquipment(circuitId)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'equipment', equipment, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalText[refused.reason] : null)
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('equipment', id)

    setTrouble(result.outcome === 'refused' ? refusalText[result.reason] : null)
  }

  return (
    <Section
      title="Betriebsmittel"
      actions={
        <Button
          tone="secondary"
          onClick={() => {
            setEditing(null)
            setAdding((open) => !open)
          }}
        >
          {adding ? 'Abbrechen' : 'Betriebsmittel anlegen'}
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
          <RecordForm
            fields={equipmentFields}
            submitLabel="Anlegen"
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
        ) : null}

        {equipment.length === 0 ? (
          <Nothing>Noch kein Betriebsmittel an diesem Stromkreis.</Nothing>
        ) : (
          <div className="overflow-x-auto">
            <Table caption="Betriebsmittel des Stromkreises">
              <thead>
                <tr>
                  <Column>Bezeichnung</Column>
                  <Column>Art</Column>
                  <Column>Hersteller</Column>
                  <Column>Typ</Column>
                  <Column>Seriennummer</Column>
                  <Column>Ändern</Column>
                </tr>
              </thead>
              <tbody>
                {equipment.map((item, index) => (
                  <EquipmentRow
                    key={String(item['id'])}
                    item={item}
                    first={index === 0}
                    last={index === equipment.length - 1}
                    editing={editing === String(item['id'])}
                    removing={removing === String(item['id'])}
                    onEdit={(open) => {
                      setAdding(false)
                      setEditing(open ? String(item['id']) : null)
                    }}
                    onRemove={(asked) => {
                      setRemoving(asked ? String(item['id']) : null)
                    }}
                    onConfirmRemove={() => void remove(String(item['id']))}
                    onMove={(step) => void move(String(item['id']), step)}
                  />
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Section>
  )
}

function EquipmentRow({
  item,
  first,
  last,
  editing,
  removing,
  onEdit,
  onRemove,
  onConfirmRemove,
  onMove,
}: {
  readonly item: RecordState
  readonly first: boolean
  readonly last: boolean
  readonly editing: boolean
  readonly removing: boolean
  readonly onEdit: (open: boolean) => void
  readonly onRemove: (asked: boolean) => void
  readonly onConfirmRemove: () => void
  readonly onMove: (step: -1 | 1) => void
}) {
  const client = useSync()
  const id = String(item['id'])
  const designation = text(item, 'designation')

  if (editing) {
    return (
      <tr>
        <Cell colSpan={6}>
          <RecordForm
            fields={equipmentFields}
            record={item}
            submitLabel="Speichern"
            onCancel={() => {
              onEdit(false)
            }}
            onSubmit={async (values) => {
              const saved = await client.update('equipment', id, asEquipment(values))

              if (saved.outcome === 'queued') {
                onEdit(false)
              }

              return saved
            }}
          />
        </Cell>
      </tr>
    )
  }

  return (
    <tr>
      <Cell className="font-semibold">
        {designation}
        {client.isPending('equipment', id) ? (
          <span className="block text-table font-normal text-ink-muted">noch nicht übertragen</span>
        ) : null}
      </Cell>
      <Cell>{maybeText(item, 'kind') ?? ''}</Cell>
      <Cell>{maybeText(item, 'manufacturer') ?? ''}</Cell>
      <Cell>{maybeText(item, 'model') ?? ''}</Cell>
      <Cell className="numeric">{maybeText(item, 'serialNumber') ?? ''}</Cell>
      <Cell>
        {removing ? (
          <span className="inline-flex flex-wrap gap-2">
            <Button tone="danger" onClick={onConfirmRemove}>
              Entfernen
            </Button>
            <Button
              tone="quiet"
              onClick={() => {
                onRemove(false)
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
              disabled={first}
              onClick={() => {
                onMove(-1)
              }}
            >
              ↑
            </IconButton>
            <IconButton
              label={`${designation} nach unten`}
              title="Nach unten"
              disabled={last}
              onClick={() => {
                onMove(1)
              }}
            >
              ↓
            </IconButton>
            <IconButton
              label={`${designation} bearbeiten`}
              title="Bearbeiten"
              onClick={() => {
                onEdit(true)
              }}
            >
              ✎
            </IconButton>
            <IconButton
              label={`${designation} entfernen`}
              title="Entfernen"
              tone="danger"
              onClick={() => {
                onRemove(true)
              }}
            >
              ✕
            </IconButton>
          </span>
        )}
      </Cell>
    </tr>
  )
}
