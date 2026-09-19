import clsx from 'clsx'
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
        tone === 'raised' ? 'bg-surface' : 'bg-surface-sunken',
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
export type Theme = 'light' | 'dark' | 'system'

export interface ShellProps {
  /** `/` or `/m`. Decides the density, not a breakpoint. */
  readonly entry: Entry
  /** `system` follows the operating system, the other two override it. */
  readonly theme?: Theme
  readonly children: ReactNode
}

/**
 * The root of an entry point. Sets the two attributes every token block in
 * `tokens.css` keys on, and nothing else.
 *
 * `system` writes no attribute at all, which is what lets the media query in
 * the tokens decide. Writing `data-theme="light"` would be a different thing:
 * it pins the light ground against the operating system.
 */
export function Shell({ entry, theme = 'system', children }: ShellProps) {
  return (
    <div
      data-entry={entry}
      data-theme={theme === 'system' ? undefined : theme}
      className="min-h-full bg-ground text-ink font-sans text-body"
    >
      {children}
    </div>
  )
}
