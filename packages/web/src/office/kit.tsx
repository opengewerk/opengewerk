import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The pieces every office screen is built from, one for each building block
 * of the canvas (`lib.py` of the generator in `.Branding\canvas-generator\`):
 * the frame of a screen, its head with the path, the facts of a record, the
 * chips of a list, a remark in a box (#219).
 *
 * The measurements are the canvas's, written out, and on purpose not rounded
 * to the nearest step of Tailwind: a 9 pixel gap that becomes 8 is how a
 * screen ends up looking almost, but not quite, like its template.
 */

/**
 * The frame of a screen: 18 by 22 pixels of room from 1024 pixels on, as
 * `office()` draws it, and 14 by 16 on a phone, as `office_narrow()`.
 */
export function Screen({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={clsx(
        'flex flex-col gap-3 px-4 py-3.5 sm:px-5 sm:py-4 lg:gap-3.5 lg:px-[22px] lg:py-[18px]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface Crumb {
  readonly to: string
  readonly label: string
}

/** Where this screen sits: the records above it, each a link, the screen itself not. */
export function Crumbs({ items }: { readonly items: readonly Crumb[] }) {
  return (
    <nav
      aria-label="Pfad"
      className="flex flex-wrap items-center gap-[7px] text-[13px] text-ink-muted"
    >
      {items.map((item, index) => (
        <span key={item.to} className="inline-flex items-center gap-[7px]">
          {index > 0 ? (
            <ChevronRight
              size={13}
              strokeWidth={2.2}
              aria-hidden="true"
              className="text-disabled"
            />
          ) : null}
          <Link to={item.to} className="text-ink-muted underline underline-offset-2">
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  )
}

export interface PageHeadProps {
  readonly title: ReactNode
  readonly crumbs?: readonly Crumb[]
  /** Beside the title: a state, the kind, a number. */
  readonly badges?: ReactNode
  /** Beside the title in lighter figures: "248 Einträge". */
  readonly count?: string
  /** The line under the title: since when, how many, what runs. */
  readonly sub?: ReactNode
  /** At the right, the primary action last. */
  readonly actions?: ReactNode
  /**
   * On a phone, instead of the path: the way back to the list, "‹ Aufträge",
   * as the board "Auftrag im Büro, Telefon" draws it.
   */
  readonly phoneBack?: Crumb
  /** On a phone the actions under the title across the whole width, two in a row. */
  readonly wideActions?: boolean
}

/**
 * The head of a screen, `page_head()` of the canvas: an `<h1>` of 24 pixels,
 * one per screen and only one, and the actions at the right of it. On a phone
 * the count moves under the title and the actions under both, where there is
 * room for a thumb.
 */
export function PageHead({
  title,
  crumbs,
  badges,
  count,
  sub,
  actions,
  phoneBack,
  wideActions = false,
}: PageHeadProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      {crumbs && crumbs.length > 0 ? (
        <div className={phoneBack ? 'max-sm:hidden' : undefined}>
          <Crumbs items={crumbs} />
        </div>
      ) : null}
      {phoneBack ? (
        <Link
          to={phoneBack.to}
          className="inline-flex min-h-10 items-center gap-1 self-start text-[15px] text-copper-text underline underline-offset-2 sm:hidden"
        >
          <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
          {phoneBack.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 grow">
          <div className="flex flex-wrap items-center gap-x-[11px] gap-y-1 max-lg:gap-y-0">
            <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.2px] text-ink [overflow-wrap:anywhere] max-sm:basis-full">
              {title}
            </h1>
            {badges}
            {count ? (
              <span className="numeric text-[14px] text-ink-faint max-lg:basis-full">{count}</span>
            ) : null}
          </div>
          {sub ? <div className="mt-[5px] text-[13px] text-ink-faint">{sub}</div> : null}
        </div>
        {actions ? (
          <div
            className={clsx(
              'flex flex-wrap items-center gap-2',
              wideActions &&
                'max-sm:grid max-sm:basis-full max-sm:grid-cols-2 max-sm:[&>*:only-child]:col-span-2',
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The widths the key column of a list of facts comes in on the canvas. */
const keyWidths = {
  90: 'grid-cols-[90px_minmax(0,1fr)]',
  92: 'grid-cols-[92px_minmax(0,1fr)]',
  96: 'grid-cols-[96px_minmax(0,1fr)]',
  100: 'grid-cols-[100px_minmax(0,1fr)]',
  110: 'grid-cols-[110px_minmax(0,1fr)]',
  120: 'grid-cols-[120px_minmax(0,1fr)]',
  130: 'grid-cols-[130px_minmax(0,1fr)]',
  140: 'grid-cols-[140px_minmax(0,1fr)]',
} as const

export interface Fact {
  readonly label: string
  /** Empty, and the fact says "nicht angegeben" in words, not with a dash. */
  readonly value: ReactNode
}

/**
 * The facts of a record, `dl()` of the canvas: the name of each in grey at the
 * left, the value beside it. A description list and not a grid of divs:
 * `dt` and `dd` are what tell a reader that the two belong together.
 */
export function FactList({
  facts,
  keyWidth = 110,
}: {
  readonly facts: readonly Fact[]
  readonly keyWidth?: keyof typeof keyWidths
}) {
  return (
    // 15 pixels on a phone, as the facts of "Auftrag im Büro, Telefon" and
    // the rule of the board "Breiten und Auflösungen" have text there.
    <dl
      className={clsx(
        'grid gap-x-2 gap-y-[5px] text-[13px] text-ink max-sm:text-[15px]',
        keyWidths[keyWidth],
      )}
    >
      {facts.map((fact) => (
        <FactRow key={fact.label} fact={fact} />
      ))}
    </dl>
  )
}

function FactRow({ fact }: { readonly fact: Fact }) {
  const empty = fact.value === null || fact.value === undefined || fact.value === ''

  return (
    <>
      <dt className="text-ink-faint">{fact.label}</dt>
      <dd className="numeric min-w-0 [overflow-wrap:anywhere]">
        {empty ? <span className="text-ink-faint">nicht angegeben</span> : fact.value}
      </dd>
    </>
  )
}

/** The widths of a side column on the boards. */
const sideWidths = {
  282: 'lg:w-[282px]',
  320: 'lg:w-[320px]',
  340: 'lg:w-[340px]',
} as const

/**
 * The two columns of a record from 1024 pixels on: the tables at the left,
 * the facts, the people and the tasks in a column of 282 pixels at the right,
 * of 320 beside what the exchange has to decide and of 340 beside a document,
 * whose side column holds forms. Narrower, one column, in the same order: a
 * screen reader and the Tab key follow the order of the page, and a column
 * moved up by the stylesheet alone would be read in another place than it is
 * seen.
 */
export function RecordColumns({
  main,
  side,
  sideWidth = 282,
}: {
  readonly main: ReactNode
  readonly side: ReactNode
  readonly sideWidth?: keyof typeof sideWidths
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
      <div className="flex min-w-0 flex-col gap-3 lg:grow">{main}</div>
      <div className={clsx('flex min-w-0 flex-col gap-3 lg:shrink-0', sideWidths[sideWidth])}>
        {side}
      </div>
    </div>
  )
}

/** A filter of a list, `chip()` of the canvas: pressed or not. */
export function Chip({
  pressed,
  onPress,
  children,
}: {
  readonly pressed: boolean
  readonly onPress: () => void
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={clsx(
        'h-8 cursor-pointer whitespace-nowrap rounded-control border px-[11px] text-[13px]',
        // A phone and a tablet take the chips of `phone_filters()`: a finger.
        'max-lg:h-10 max-lg:rounded-[5px] max-lg:px-[13px] max-lg:text-[15px]',
        pressed
          ? 'border-ink bg-ink font-semibold text-ground'
          : 'border-control bg-surface text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** A key of the keyboard, drawn as one. */
export function Key({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-b-2 border-control bg-surface-sunken px-1.5 py-0.5 font-condensed text-[12px] font-semibold tracking-[0.5px] text-ink-muted">
      {children}
    </kbd>
  )
}

/** What a list or a card says when it has nothing in it, `empty()` of the canvas. */
export function Empty({
  children,
  action,
}: {
  readonly children: ReactNode
  readonly action?: ReactNode
}) {
  return (
    <div className="px-5 py-10 text-center text-[14px] leading-[1.5] text-ink-muted">
      {children}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export type NoteTone = 'waiting' | 'conflict' | 'done' | 'neutral'

const noteTones: Readonly<Record<NoteTone, string>> = {
  waiting: 'text-waiting bg-waiting-fill border-waiting-edge',
  conflict: 'text-conflict bg-conflict-fill border-conflict-edge',
  done: 'text-done bg-done-fill border-done-edge',
  neutral: 'text-ink-muted bg-surface-sunken border-line',
}

/** A remark in a box, `note_box()` of the canvas: a symbol, a sentence, perhaps an action. */
export function NoteBox({
  tone = 'neutral',
  icon: Icon = Info,
  action,
  children,
}: {
  readonly tone?: NoteTone
  readonly icon?: LucideIcon
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2.5 rounded-[5px] border px-3.5 py-2.5 text-[13px]',
        noteTones[tone],
      )}
    >
      <Icon size={17} strokeWidth={2.1} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 leading-[1.4]">{children}</span>
      {action ? (
        <>
          <div className="grow" />
          {action}
        </>
      ) : null}
    </div>
  )
}
