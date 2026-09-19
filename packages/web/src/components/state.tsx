import clsx from 'clsx'
import type { DocumentStatus } from '@opengewerk/domain'
import type { ReactNode } from 'react'

/**
 * What a document's state looks like, and it is deliberately loud.
 *
 * The difference between a draft and a fixed document is the most consequential
 * fact on the screen: from the moment it is issued it has a number, it cannot
 * be changed, and a mistake costs a cancellation. That does not belong in a
 * small grey chip. A draft is dashed and unfinished looking, a fixed document
 * is closed and carries the copper edge.
 *
 * The labels are German because a person reads them. The keys come from
 * `domain`, so a state added there turns this into a type error instead of a
 * blank badge.
 */
const documentStateLabel: Readonly<Record<DocumentStatus, string>> = {
  draft: 'Entwurf',
  issued: 'Festgeschrieben',
  cancelled: 'Storniert',
}

const documentStateClasses: Readonly<Record<DocumentStatus, string>> = {
  draft: 'border-2 border-dashed border-waiting text-waiting bg-surface',
  issued: 'border border-ink border-l-4 border-l-copper text-ink bg-surface',
  cancelled: 'border border-conflict text-conflict bg-surface line-through',
}

export interface DocumentStateProps {
  readonly status: DocumentStatus
  /** The number, once there is one. A draft has none, and that is the point. */
  readonly number?: string | null
}

export function DocumentState({ status, number }: DocumentStateProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1 rounded-control',
        'text-body font-semibold',
        documentStateClasses[status],
      )}
    >
      {documentStateLabel[status]}
      {number ? <span className="numeric font-normal text-ink-muted">{number}</span> : null}
    </span>
  )
}

/**
 * What the outbox is doing. Always a strip, never a popup that can be clicked
 * away: a conflict nobody sees becomes an invoice with the wrong content, later
 * and out of context.
 */
export type SyncState = 'synced' | 'offline' | 'conflict'

const syncClasses: Readonly<Record<SyncState, string>> = {
  synced: 'bg-done text-on-status',
  offline: 'bg-waiting text-on-status',
  conflict: 'bg-conflict text-on-status',
}

export interface SyncBarProps {
  readonly state: SyncState
  readonly children: ReactNode
  /** The way out of the state, when there is one. */
  readonly action?: ReactNode
}

export function SyncBar({ state, children, action }: SyncBarProps) {
  return (
    <div
      // A conflict interrupts, the other two do not. `alert` is announced at
      // once, `status` when the reader gets to it, and using `alert` for the
      // quiet states would train people to ignore it.
      role={state === 'conflict' ? 'alert' : 'status'}
      className={clsx(
        'flex items-center gap-3 px-4 py-2 min-h-tap',
        'text-body font-medium',
        syncClasses[state],
      )}
    >
      <span className="grow">{children}</span>
      {action}
    </div>
  )
}
