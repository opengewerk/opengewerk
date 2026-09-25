import { distributionBoardKindLabel } from '@opengewerk/domain'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Pencil, Plus, Printer, X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button, Panel } from '../../components/index.js'
import {
  asBoard,
  boardFields,
  boardKindOf,
  circuitChartAddress,
  circuitsInWords,
  moveAmong,
  newBoard,
  nextPosition,
  useBoards,
} from '../../app/electrical.js'
import { useMay } from '../../app/queries.js'
import { RecordForm } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecords, useSync, useSyncStatus } from '../../sync/provider.js'

/**
 * The circuit chart as a button with a printer on it, as the head of the
 * record of an installation draws it on the canvas (#219). Without a
 * connection it cannot be printed, and the button says so in its title.
 */
export function ChartButton({ installationId }: { readonly installationId: string }) {
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
      href={circuitChartAddress(installationId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap"
    >
      <Printer size={15} strokeWidth={2.3} aria-hidden="true" />
      Stromkreisverzeichnis
    </a>
  )
}

/**
 * The boards of an installation, as the card "Verteiler" of the canvas draws
 * them (#219): a line per board with what it is, where and how many
 * circuits, and the arrows to put it in its place. The chart of all of them
 * is in the head of the record.
 */
export function BoardsSection({ installationId }: { readonly installationId: string }) {
  const client = useSync()
  const boards = useBoards(installationId)
  const circuits = useRecords('circuits')
  const writes = useMay('installation.write')
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
    <Panel
      title="Verteiler"
      action={
        writes && !adding ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            Verteiler anlegen
          </Button>
        ) : null
      }
    >
      {trouble ? (
        <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {adding ? (
        <div className="mb-3">
          <RecordForm
            fields={boardFields}
            record={newBoard(boards)}
            submitLabel="Verteiler anlegen"
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
        adding ? null : (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Noch kein Verteiler. Hauptverteilung und Unterverteilungen stehen hier, darunter ihre
            Felder, Stromkreise und Betriebsmittel.
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {boards.map((board, index) => {
            const id = String(board['id'])
            const count = circuits.filter((circuit) => circuit['distributionBoardId'] === id).length
            const designation = text(board, 'designation')

            return (
              <li
                key={id}
                className="flex items-center gap-2.5 rounded-control border border-line bg-ground px-[11px] py-[9px]"
              >
                <div className="min-w-0 grow">
                  <Link
                    to={`/verteiler/${id}`}
                    className="text-[14px] font-semibold text-copper-text underline underline-offset-2"
                  >
                    {designation}
                  </Link>
                  <div className="text-[13px] text-ink-faint">
                    {[
                      distributionBoardKindLabel[boardKindOf(board)],
                      maybeText(board, 'location'),
                      circuitsInWords(count),
                      client.isPending('distribution_boards', id) ? 'noch nicht übertragen' : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(', ')}
                  </div>
                </div>
                {writes ? (
                  <>
                    <SmallIcon
                      label={`${designation} nach oben`}
                      disabled={index === 0}
                      onClick={() => void move(id, -1)}
                    >
                      <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                    </SmallIcon>
                    <SmallIcon
                      label={`${designation} nach unten`}
                      disabled={index === boards.length - 1}
                      onClick={() => void move(id, 1)}
                    >
                      <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                    </SmallIcon>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {pending ? (
        <p className="mt-2 text-[13px] leading-[1.4] text-ink-muted">
          Noch nicht Übertragenes fehlt im Stromkreisverzeichnis.
        </p>
      ) : null}
    </Panel>
  )
}

/** A small symbol button of the canvas, 26 pixels for the mouse, a finger's size below. */
export function SmallIcon({
  label,
  disabled,
  onClick,
  danger = false,
  compact = false,
  children,
}: {
  readonly label: string
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly danger?: boolean
  /** 24 pixels instead of 26, as the column "Ändern" of a table draws them. */
  readonly compact?: boolean
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex shrink-0 cursor-pointer items-center justify-center rounded-control disabled:cursor-not-allowed disabled:text-disabled max-lg:size-tap',
        compact ? 'size-6' : 'size-[26px]',
        danger ? 'text-conflict' : 'text-ink-muted',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Up, down, change and remove, the column "Ändern" of the canvas, as the
 * fields of a board, the equipment of a circuit and the lines of a document
 * draw it. Whether a step is possible is the caller's to say: a title of a
 * document moves over a whole section and not over the next row.
 */
export function Reorder({
  name,
  canUp,
  canDown,
  onMove,
  onEdit,
  onRemove,
}: {
  readonly name: string
  readonly canUp: boolean
  readonly canDown: boolean
  readonly onMove: (step: -1 | 1) => void
  readonly onEdit: () => void
  readonly onRemove: () => void
}) {
  return (
    <span className="inline-flex gap-0.5">
      <SmallIcon compact label={`${name} nach oben`} disabled={!canUp} onClick={() => onMove(-1)}>
        <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
      </SmallIcon>
      <SmallIcon compact label={`${name} nach unten`} disabled={!canDown} onClick={() => onMove(1)}>
        <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
      </SmallIcon>
      <SmallIcon compact label={`${name} bearbeiten`} onClick={onEdit}>
        <Pencil size={14} strokeWidth={2} aria-hidden="true" />
      </SmallIcon>
      <SmallIcon compact label={`${name} entfernen`} danger onClick={onRemove}>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </SmallIcon>
    </span>
  )
}
