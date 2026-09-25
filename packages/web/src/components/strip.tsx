import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { useEntry } from './surface.js'
import type { Entry } from './surface.js'

/**
 * The strips over a screen, as the boards "Leisten im Büro" and "Leisten auf
 * der Baustelle" draw them: amber while something waits, red for something to
 * decide, and the sunken ground for an offer.
 *
 * A strip and never a popup, and none can be clicked away. A conflict that can
 * be dismissed is a conflict nobody sees, and a conflict nobody sees becomes an
 * invoice with the wrong content, weeks later and out of context. Several stack
 * in the order of the board, which the shell of each entry keeps.
 */
export type StripTone = 'wait' | 'conflict' | 'info'

const toneClasses: Readonly<Record<StripTone, string>> = {
  wait: 'bg-bar-wait text-on-bar-wait',
  conflict: 'bg-conflict text-on-status',
  info: 'bg-surface-sunken text-ink border-b border-line',
}

export interface StripProps {
  readonly tone: StripTone
  readonly icon?: LucideIcon | undefined
  /** What is the matter, in one sentence. */
  readonly children: ReactNode
  /**
   * A second sentence, under the first in smaller type on site. In the office
   * a strip is one line, and the second sentence follows the first.
   */
  readonly detail?: ReactNode
  readonly actions?: ReactNode
  /** Announced at once rather than when a reader gets to it: for a conflict. */
  readonly urgent?: boolean
}

export function Strip({ tone, icon: Icon, children, detail, actions, urgent = false }: StripProps) {
  const site = useEntry() === 'site'

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={clsx(
        // Wraps rather than squeezes: on a narrow screen the buttons move under
        // the sentence instead of pressing it into a column one letter wide.
        // The sentence keeps 144 pixels, which leaves "Erneut versuchen" beside
        // "Keine Verbindung." on a phone of 390, as the board draws it.
        'flex flex-wrap items-center gap-x-2.5 gap-y-1.5',
        site ? 'min-h-12 px-4 py-[9px]' : 'min-h-10 px-4 py-1.5 text-[14px] lg:px-5',
        toneClasses[tone],
      )}
    >
      {Icon ? (
        <Icon
          size={site ? 20 : 17}
          strokeWidth={site ? 2.1 : 2.2}
          aria-hidden="true"
          className="shrink-0"
        />
      ) : null}
      {site ? (
        <div className="min-w-0 grow basis-36 leading-[1.2]">
          <div className="text-[15px] font-semibold">{children}</div>
          {detail ? <div className="text-[13px] opacity-[0.92]">{detail}</div> : null}
        </div>
      ) : (
        <div className="min-w-0 grow basis-36 font-semibold">
          {children}
          {detail ? <> {detail}</> : null}
        </div>
      )}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * `plain` is the button a strip is for, white on a coloured strip and in the
 * colour of that strip; `primary` is copper, for the offer of a new version;
 * `link` and `quiet` are the two ways out of a suggestion.
 */
export type StripActionKind = 'plain' | 'primary' | 'link' | 'quiet'

/**
 * The classes of a button or link on a strip. A function and not a component,
 * because the action is a router link on one strip, a link to the other entry
 * on the next and a button on the third, and all three take a class.
 *
 * Drawn small, as on the boards: 28 pixels in the office, 34 on site. What
 * takes a tap is 44 pixels high all the same, because the pseudo element
 * reaches past the drawn button, so a thumb that lands just beside it still
 * hits.
 */
export function stripAction(kind: StripActionKind, tone: StripTone, entry: Entry): string {
  return clsx(
    'relative inline-flex items-center justify-center whitespace-nowrap rounded-[4px] cursor-pointer',
    'before:absolute before:inset-x-0',
    entry === 'site'
      ? 'min-h-[34px] px-3 text-[14px] before:-inset-y-[5px]'
      : 'h-7 px-[11px] text-[13px] before:-inset-y-2',
    'disabled:cursor-not-allowed disabled:opacity-60',
    kindClasses(kind, tone),
  )
}

function kindClasses(kind: StripActionKind, tone: StripTone): string {
  switch (kind) {
    case 'primary':
      return 'bg-copper-solid text-on-copper font-semibold no-underline'
    case 'link':
      return clsx(
        'font-semibold underline underline-offset-2',
        tone === 'info' ? 'text-copper-text' : 'text-current',
      )
    case 'quiet':
      return clsx('no-underline', tone === 'info' ? 'text-ink-muted' : 'text-current')
    case 'plain':
      return tone === 'info'
        ? 'bg-surface text-ink border border-line-strong font-semibold no-underline'
        : clsx(
            'bg-bar-action font-semibold no-underline',
            tone === 'wait' ? 'text-bar-action-wait' : 'text-bar-action-conflict',
          )
  }
}
