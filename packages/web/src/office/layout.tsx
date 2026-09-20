import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Card, FieldLabel } from '../components/index.js'

/**
 * The frame of a screen in the office: where you are, what it is called, what
 * you can do with it.
 *
 * An `<h1>` per screen and only one. The office is a set of screens that look
 * alike, and a heading that moves or disappears is how somebody using a screen
 * reader loses track of which one they are on.
 */
export function Page({
  crumbs,
  title,
  meta,
  actions,
  children,
}: {
  readonly crumbs?: ReactNode
  readonly title: string
  /** The line under the title: kind, number, address. */
  readonly meta?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {crumbs ? (
        <nav aria-label="Pfad" className="text-table text-ink-muted">
          {crumbs}
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-semibold">{title}</h1>
          {meta ? <div className="text-body text-ink-muted">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      {children}
    </div>
  )
}

/** One step of the path. A real link, so the middle mouse button works. */
export function Crumb({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <>
      <Link to={to} className="text-copper-text underline underline-offset-2">
        {children}
      </Link>
      <span aria-hidden="true"> / </span>
    </>
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
    <Card
      label={title}
      heading={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-body font-semibold">{title}</h2>
          {actions}
        </div>
      }
    >
      {children}
    </Card>
  )
}

/**
 * A label and its value, the unit a detail screen is built from.
 *
 * A description list and not a two column grid of divs. `dt` and `dd` are what
 * tell a reader that these two belong together; a grid tells it nothing and
 * reads out as a run of unrelated words.
 */
export function Facts({ children }: { readonly children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
}

export function Fact({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt>
        <FieldLabel>{label}</FieldLabel>
      </dt>
      <dd className="text-body">
        {children === '' || children === null ? (
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
  return <p className="text-body text-ink-muted">{children}</p>
}
