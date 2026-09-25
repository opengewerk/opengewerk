import clsx from 'clsx'
import type { DocumentStatus } from '@opengewerk/domain'

import { Status, statusIcons } from './status.js'
import type { StatusTone } from './status.js'
import { useEntry } from './surface.js'

/**
 * What a document's state looks like.
 *
 * The difference between a draft and a fixed document is the most consequential
 * fact on the screen: from the moment it is issued it has a number, it cannot
 * be changed, and a mistake costs a cancellation. In the office it is the
 * marker of the canvas (#219), with a pencil for a draft and a lock for what
 * is fixed; on site the badge of the site boards, dashed while it is a draft
 * and with an edge once it is closed, green for signed and copper for issued.
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

const officeMarkers: Readonly<
  Record<DocumentStatus, { readonly tone: StatusTone; readonly icon?: typeof statusIcons.sign }>
> = {
  draft: { tone: 'draft' },
  signed: { tone: 'done', icon: statusIcons.sign },
  issued: { tone: 'locked' },
  cancelled: { tone: 'neutral', icon: statusIcons.ban },
}

const siteBadges: Readonly<Record<DocumentStatus, string>> = {
  draft: 'border border-dashed border-waiting-edge text-waiting bg-waiting-fill',
  signed: 'border border-done-edge border-l-4 border-l-done text-done bg-done-fill',
  issued: 'border border-line border-l-4 border-l-copper text-ink bg-surface',
  cancelled: 'border border-conflict text-conflict bg-surface line-through',
}

export interface DocumentStateProps {
  readonly status: DocumentStatus
  /** The number, once there is one. A draft has none, and that is the point. */
  readonly number?: string | null
}

export function DocumentState({ status, number }: DocumentStateProps) {
  const entry = useEntry()

  if (entry === 'office') {
    const marker = officeMarkers[status]

    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Status tone={marker.tone} icon={marker.icon}>
          {documentStateLabel[status]}
        </Status>
        {number ? <span className="numeric text-[13px] text-ink-faint">{number}</span> : null}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className={clsx(
          'inline-flex items-center rounded-control px-[9px] py-[3px] text-[14px] font-semibold',
          siteBadges[status],
        )}
      >
        {documentStateLabel[status]}
      </span>
      {number ? <span className="numeric text-[14px] text-ink-faint">{number}</span> : null}
    </span>
  )
}
