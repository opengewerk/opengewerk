import type { ReactNode } from 'react'

import { Panel } from '../components/index.js'

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
