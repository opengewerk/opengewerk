import clsx from 'clsx'
import type { DocumentStatus } from '@opengewerk/domain'

/**
 * What a document's state looks like, and it is deliberately loud.
 *
 * The difference between a draft and a fixed document is the most consequential
 * fact on the screen: from the moment it is issued it has a number, it cannot
 * be changed, and a mistake costs a cancellation. That does not belong in a
 * small grey chip. A draft is dashed and unfinished looking, a fixed document
 * is closed and carries the copper edge. A signed report sits between the two:
 * closed, because nothing on it changes any more, and with the green edge of
 * something confirmed rather than the copper of a number, which it does not
 * have until the office issues it.
 *
 * The labels are German because a person reads them. The keys come from
 * `domain`, so a state added there turns this into a type error instead of a
 * blank badge.
 */
const documentStateLabel: Readonly<Record<DocumentStatus, string>> = {
  draft: 'Entwurf',
  signed: 'Unterschrieben',
  issued: 'Festgeschrieben',
  cancelled: 'Storniert',
}

const documentStateClasses: Readonly<Record<DocumentStatus, string>> = {
  draft: 'border-2 border-dashed border-waiting text-waiting bg-surface',
  signed: 'border border-ink border-l-4 border-l-done text-ink bg-surface',
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
