import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Panel } from '../components/index.js'
import { Screen } from './kit.js'

/**
 * The frame of a screen in the office: where you are, what it is called, what
 * you can do with it, as `page_head()` of the canvas draws it (#219).
 *
 * An `<h1>` per screen and only one. The office is a set of screens that look
 * alike, and a heading that moves or disappears is how somebody using a screen
 * reader loses track of which one they are on.
 */
export function Page({
  crumbs,
  title,
  meta,
  badges,
  actions,
  children,
}: {
  readonly crumbs?: ReactNode
  readonly title: string
  /** The line under the title: kind, number, address. */
  readonly meta?: ReactNode
  /** Beside the title: a state, the kind, a number. */
  readonly badges?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Screen>
      <div className="flex flex-col gap-[9px]">
        {crumbs ? (
          <nav
            aria-label="Pfad"
            className="flex flex-wrap items-center gap-[7px] text-[13px] text-ink-muted"
          >
            {crumbs}
          </nav>
        ) : null}

        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 grow">
            <div className="flex flex-wrap items-center gap-x-[11px] gap-y-1">
              <h1 className="text-[24px] leading-[1.25] font-semibold tracking-[-0.2px] text-ink [overflow-wrap:anywhere]">
                {title}
              </h1>
              {badges}
            </div>
            {meta ? <div className="mt-[5px] text-[13px] text-ink-faint">{meta}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>

      {children}
    </Screen>
  )
}

/**
 * One step of the path, a real link, so the middle mouse button works. The
 * steps are separated by a chevron, and the first has none in front of it.
 */
export function Crumb({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <span className="group inline-flex items-center gap-[7px]">
      <ChevronRight
        size={13}
        strokeWidth={2.2}
        aria-hidden="true"
        className="text-disabled group-first:hidden"
      />
      <Link to={to} className="text-ink-muted underline underline-offset-2">
        {children}
      </Link>
    </span>
  )
}

/** A named block on a detail screen, with its own heading and its own actions. */
export function Section({
  title,
  actions,
  children,
}: {
  readonly title: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Panel title={title} action={actions}>
      {children}
    </Panel>
  )
}

/**
 * The facts of a record, `dl()` of the canvas: the name of each in grey at
 * the left, the value beside it.
 *
 * A description list and not a two column grid of divs. `dt` and `dd` are what
 * tell a reader that these two belong together; a grid tells it nothing and
 * reads out as a run of unrelated words.
 */
export function Facts({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-[5px] text-[13px] text-ink">
      {children}
    </dl>
  )
}

export function Fact({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="contents">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="numeric min-w-0 [overflow-wrap:anywhere]">
        {children === '' || children === null || children === undefined ? (
          // A word and not a dash. A dash in a value is a placeholder, and the
          // project has no placeholders; it is also an em dash, which is not
          // allowed to appear anywhere here at all.
          <span className="text-ink-faint">nicht angegeben</span>
        ) : (
          children
        )}
      </dd>
    </div>
  )
}

/** What a list says when it has nothing in it, in a sentence and not a dash. */
export function Nothing({ children }: { readonly children: ReactNode }) {
  return <p className="text-[13px] text-ink-muted">{children}</p>
}
