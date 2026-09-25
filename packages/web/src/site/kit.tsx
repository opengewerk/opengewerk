import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The pieces the boards of the page "Baustelle" are built from (#219), as
 * `baustelle.py` of the canvas draws them: 17 pixels of text, rows a thumb
 * hits, small capitals over what a value is. The cards themselves are
 * `Panel`, which draws them for the site on its own.
 */

/** The content of a screen on site: 16 pixels from the edges, the cards 12 apart. */
export function SiteScreen({
  gap = 12,
  children,
}: {
  readonly gap?: 10 | 12 | 14
  readonly children: ReactNode
}) {
  return (
    <div
      className={clsx(
        'flex min-w-0 flex-col p-4',
        gap === 10 ? 'gap-2.5' : gap === 12 ? 'gap-3' : 'gap-3.5',
      )}
    >
      {children}
    </div>
  )
}

/** Small capitals over a group inside a card, `slabel()` at 13 pixels: "Beim Kunden". */
export function SiteLabel({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <p
      className={clsx(
        'font-condensed text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase',
        className,
      )}
    >
      {children}
    </p>
  )
}

export interface SiteFact {
  readonly label: string
  readonly value: ReactNode
}

/**
 * The facts of a record on site, `kv()` of the boards: the name in small
 * capitals over each value, 10 pixels apart. A list of terms and not a run of
 * divs, so a reader hears which value belongs to which name.
 */
export function SiteFacts({ facts }: { readonly facts: readonly SiteFact[] }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="font-condensed text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
            {fact.label}
          </dt>
          <dd className="mt-0.5 text-[17px] leading-[1.4] [overflow-wrap:anywhere]">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The look of a link on site. It stands in a line as the boards draw it, and
 * takes a tap ten pixels above and below it, which makes the 44 pixels ADR
 * 0004 asks of anything a thumb hits without moving the lines apart.
 */
const linkLook =
  'relative font-semibold text-copper-text underline underline-offset-2 [overflow-wrap:anywhere] before:absolute before:inset-x-0 before:-inset-y-2.5'

/**
 * A link in the copper for text, `alink()`: an address to navigate to, a
 * number to dial, a job to open. Underlined, because colour alone does not
 * say link to everybody.
 */
export function SiteAnchor({
  href,
  icon: Icon,
  children,
}: {
  readonly href: string
  readonly icon?: LucideIcon
  readonly children: ReactNode
}) {
  return (
    <a href={href} className={clsx('inline-flex items-center gap-1.5', linkLook)}>
      {Icon ? <Icon size={17} strokeWidth={2.2} aria-hidden="true" className="shrink-0" /> : null}
      {children}
    </a>
  )
}

/** The same for a screen of the site itself. */
export function SiteLink({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <Link to={to} className={linkLook}>
      {children}
    </Link>
  )
}

/**
 * A row to tap, `row_link()` of the boards: at least 56 pixels, the name, a
 * line under it, what state it is in and the chevron that says it opens.
 */
export function SiteRow({
  to,
  title,
  meta,
  right,
  thumb,
}: {
  readonly to: string
  readonly title: ReactNode
  readonly meta?: ReactNode
  readonly right?: ReactNode
  readonly thumb?: ReactNode
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-14 items-center gap-2.5 border-b border-row py-2 text-ink no-underline"
      >
        {thumb}
        <span className="min-w-0 grow">
          <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">{title}</span>
          {meta ? (
            <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">{meta}</span>
          ) : null}
        </span>
        {right}
        <ChevronRight
          size={20}
          strokeWidth={2.2}
          aria-hidden="true"
          className="shrink-0 text-ink-faint"
        />
      </Link>
    </li>
  )
}

/** Rows of `SiteRow`, a list for the reader. */
export function SiteRows({
  label,
  children,
}: {
  readonly label?: string
  readonly children: ReactNode
}) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {children}
    </ul>
  )
}

/**
 * The head of a screen of the tabs, `top_title()`: a line in small capitals
 * over the title, and at the right a count or the buttons of the day.
 */
export function TopTitle({
  over,
  title,
  right,
}: {
  readonly over: string
  readonly title: string
  readonly right?: ReactNode
}) {
  return (
    <div className="flex items-end gap-2.5">
      <div className="min-w-0 grow">
        <p className="font-condensed text-[15px] font-semibold tracking-[1.2px] text-ink-faint uppercase">
          {over}
        </p>
        <h1 className="mt-0.5 text-[27px] leading-[1.15] font-bold">{title}</h1>
      </div>
      {right}
    </div>
  )
}

/** How many there are, beside a title: `count()` of the boards. */
export function TitleCount({ count, label }: { readonly count: number; readonly label: string }) {
  return (
    <p className="text-right leading-[1.05]">
      <span className="block text-[27px] font-bold text-copper-text">{count}</span>
      <span className="block text-[14px] text-ink-muted">{label}</span>
    </p>
  )
}

/** "noch nicht übertragen", in the colour of waiting, for what is still on the device. */
export function NotSent({ className }: { readonly className?: string }) {
  return (
    <span className={clsx('text-[14px] font-semibold text-waiting', className)}>
      noch nicht übertragen
    </span>
  )
}

/** A sentence that went wrong, in red. */
export function SiteTrouble({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="text-[16px] leading-[1.4] font-semibold text-conflict">
      {children}
    </p>
  )
}

/** A sentence of a card at the size of the boards: 17, or 16 and muted. */
export function SiteText({
  muted = false,
  size,
  children,
}: {
  readonly muted?: boolean
  readonly size?: 15 | 16 | 17
  readonly children: ReactNode
}) {
  const shown = size ?? (muted ? 16 : 17)

  return (
    <p
      className={clsx(
        'leading-[1.45] [overflow-wrap:anywhere]',
        shown === 15 ? 'text-[15px]' : shown === 16 ? 'text-[16px]' : 'text-[17px]',
        muted ? 'text-ink-muted' : 'text-ink',
      )}
    >
      {children}
    </p>
  )
}
