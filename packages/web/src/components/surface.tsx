import clsx from 'clsx'
import { createContext, useContext } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

/**
 * `raised` is a card on the page, `sunken` is a strip that belongs to the page
 * rather than sitting on it: navigation, the footer of a form, a panel inside
 * another card. The distinction is why there are three light surfaces and not
 * two, and why the contrast check holds every text colour against all three.
 */
export type CardTone = 'raised' | 'sunken'

export interface CardProps {
  /** Becomes the section's accessible name, so a card is findable. */
  readonly label: string
  readonly tone?: CardTone
  readonly heading?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

/**
 * The box everything sits in. A `<section>` with a name rather than a div,
 * because a screen has six of these and a reader that cannot tell them apart
 * turns the page into one long run of text.
 */
export function Card({ label, tone = 'raised', heading, children, className }: CardProps) {
  return (
    <section
      aria-label={label}
      className={clsx(
        'border border-line rounded-card p-4',
        // What it is drawn on, for the few things inside that need to paint
        // the same colour themselves, like the first column of a table that
        // stays put while the rest scrolls.
        tone === 'raised'
          ? 'bg-surface [--surface-here:var(--color-surface)]'
          : 'bg-surface-sunken [--surface-here:var(--color-surface-sunken)]',
        className,
      )}
    >
      {heading ? <div className="mb-3">{heading}</div> : null}
      {children}
    </section>
  )
}

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly children: ReactNode
}

/**
 * A link inside running text, in the copper meant for text rather than the
 * brand copper: the latter is 3.44:1 on the page and unreadable at this size.
 *
 * Underlined, not merely coloured. Colour alone is the one distinction a
 * colour blind reader does not get, and a link that only differs in hue is
 * invisible to them.
 */
export function TextLink({ className, ...rest }: TextLinkProps) {
  return (
    <a
      className={clsx('text-copper-text font-semibold underline underline-offset-2', className)}
      {...rest}
    />
  )
}

export type Entry = 'office' | 'site'

export interface ShellProps {
  /** `/` or `/m`. Decides the density, not a breakpoint. */
  readonly entry: Entry
  readonly children: ReactNode
}

/**
 * The root of an entry point. Sets the density every token block in
 * `tokens.css` keys on, and nothing else.
 *
 * Light or dark is not decided here. It sits on `:root`, where the dark block
 * of the tokens looks for it, and is set by `app/theme.ts` before the first
 * screen is drawn. This component used to take a `theme` and write it onto its
 * own `<div>`, which the tokens never read: a switch built on it would have
 * changed nothing (#216).
 *
 * The size of running text comes from `text-body`, its line height does not:
 * `text-body` brings the 1.45 of a paragraph along, and set here it reached
 * every row of every card and list below, a third higher than the boards of
 * the canvas draw them with the line height of the font itself (#219).
 */
export function Shell({ entry, children }: ShellProps) {
  return (
    <EntryContext.Provider value={entry}>
      <div
        data-entry={entry}
        className="min-h-full bg-ground text-ink font-sans text-body leading-[normal] [--surface-here:var(--color-ground)]"
      >
        {children}
      </div>
    </EntryContext.Provider>
  )
}

const EntryContext = createContext<Entry>('office')

/**
 * Which entry a component is drawn in, for the few that are laid out
 * differently and not only denser: a strip over the screen says its two
 * sentences side by side in the office and one under the other on site. Sizes
 * alone come from the tokens under `data-entry` and need no question.
 */
export function useEntry(): Entry {
  return useContext(EntryContext)
}
