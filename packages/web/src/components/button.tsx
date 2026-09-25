import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { useInGate } from './gate.js'
import type { Entry } from './surface.js'
import { useEntry } from './surface.js'

/**
 * What a button can be, as the canvas draws them (#219).
 *
 * `primary` is the copper one, and there is at most one per screen. Copper
 * marks the single action a screen is for; used on everything it marks
 * nothing. `dark` is the slate button for going somewhere rather than doing
 * something, "Akte öffnen" beside a preview. `danger` removes or ends, and
 * `quiet` is barely a button: "Abbrechen" under a form.
 */
export type ButtonTone = 'primary' | 'secondary' | 'dark' | 'danger' | 'quiet'

/** `small` is the button in the head of a card, "Objekt anlegen". */
export type ButtonSize = 'normal' | 'small'

/**
 * How high a button on site is, as `sbtn()` of the boards draws it: 60 at the
 * foot of a screen, 52 for a button in a card, 48 for the lesser one under a
 * list and 44 for one in a row, "Erledigt" beside a task. Never lower: ADR
 * 0004 puts nothing a thumb has to hit under 44 pixels. The office ignores it.
 */
export type SiteHeight = 44 | 48 | 52 | 56 | 60

const siteHeights: Readonly<Record<SiteHeight, string>> = {
  44: 'min-h-11',
  48: 'min-h-12',
  52: 'min-h-13',
  56: 'min-h-14',
  60: 'min-h-control',
}

/**
 * The colours of a tone. The office sets only the filled ones in semibold,
 * the site every one of them, as `button()` and `sbtn()` of the canvas do; a
 * small button and a button on site sit on the page colour rather than on a
 * card.
 */
function toneClasses(tone: ButtonTone, size: ButtonSize, entry: Entry): string {
  const onPage = size === 'small' || entry === 'site'

  switch (tone) {
    case 'primary':
      return 'bg-copper-solid text-on-copper border border-copper-solid font-semibold'
    case 'dark':
      return 'bg-ink text-ground border border-ink font-semibold'
    case 'secondary':
      return clsx(
        onPage ? 'bg-ground' : 'bg-surface',
        'text-ink border border-control',
        entry === 'site' && 'font-semibold',
      )
    case 'danger':
      return clsx(
        size === 'small' ? 'bg-ground' : 'bg-surface',
        'text-conflict border border-conflict',
        entry === 'site' && 'font-semibold',
      )
    case 'quiet':
      return entry === 'site'
        ? 'bg-transparent text-copper-text border border-transparent font-semibold'
        : 'bg-transparent text-ink-muted border border-transparent'
  }
}

/**
 * The sizes. In the office a button is 34 pixels high from 1024 pixels on and
 * never lower than a finger below that, which `--spacing-tap` decides. A
 * small one is 27 pixels, on a tablet as well, as the pages of the list on
 * the board at 768 pixels, and as tall as any other on a phone. On site a
 * button is as tall as the control token says and may wrap, because a long
 * label on a phone is better on two lines than cut.
 */
function sizeClasses(size: ButtonSize, entry: Entry, height: SiteHeight = 60): string {
  if (entry === 'site') {
    return clsx(
      siteHeights[height],
      'px-[14px] py-1.5 gap-[9px] text-[16px] leading-[1.25] text-center',
    )
  }

  return size === 'small'
    ? 'h-[27px] max-sm:h-tap px-[9px] gap-[7px] text-[13px] whitespace-nowrap'
    : // One line for a mouse, as the canvas draws it; for a finger a long
      // label wraps rather than push a phone wider than its screen.
      'h-control min-h-tap px-[14px] gap-[7px] text-body lg:whitespace-nowrap max-lg:h-auto max-lg:py-1.5 max-lg:text-center max-lg:text-[15px]'
}

/**
 * A button before sign in, `gate_button()` of the boards: 56 pixels on a phone
 * and 46 at a desk, the filled one in copper, the plain one on the page colour.
 * The quiet one is `quiet()` there, a line of copper text, underlined and at
 * the left, "Telefon nicht zur Hand? Wiederherstellungscode".
 */
function gateClasses(tone: ButtonTone): string {
  switch (tone) {
    case 'quiet':
      return 'self-start justify-start rounded-control border-0 bg-transparent px-0 py-1 text-left text-[15px] lg:text-[14px] font-semibold text-copper-text underline'
    case 'primary':
      return 'min-h-14 lg:min-h-[46px] rounded-[4px] px-[14px] py-1.5 gap-[9px] text-[17px] lg:text-[16px] leading-[1.25] text-center bg-copper-solid text-on-copper border border-copper-solid font-semibold'
    default:
      return 'min-h-14 lg:min-h-[46px] rounded-[4px] px-[14px] py-1.5 gap-[9px] text-[17px] lg:text-[16px] leading-[1.25] text-center bg-ground text-ink border border-control font-medium'
  }
}

/** The size of the symbol in front of the label, from the same drawings. */
function iconSize(size: ButtonSize, entry: Entry): { size: number; strokeWidth: number } {
  if (entry === 'site') {
    return { size: 20, strokeWidth: 2.2 }
  }

  return size === 'small' ? { size: 13, strokeWidth: 2.3 } : { size: 15, strokeWidth: 2.3 }
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A prop like any other since React 19, passed on to the `<button>`. */
  readonly ref?: Ref<HTMLButtonElement>
  readonly tone?: ButtonTone
  readonly size?: ButtonSize
  /** A symbol in front of the label, never instead of it. */
  readonly icon?: LucideIcon
  /** Fills the width of its container, which is what the site entry wants. */
  readonly wide?: boolean
  /** On site, the height the board gives it; 60 when nothing is said. */
  readonly height?: SiteHeight
  readonly children: ReactNode
}

/**
 * A real `<button>`, always. A div with an onClick is skipped by Tab and
 * announced as nothing, and that is not a detail on a screen somebody operates
 * in a cellar with one hand.
 *
 * A button that cannot be used right now is drawn grey on the page colour, as
 * the canvas has it, whatever its tone: a faded copper button still reads as
 * the thing to press.
 */
export function Button({
  tone = 'secondary',
  size = 'normal',
  icon: Icon,
  wide = false,
  height,
  className,
  children,
  ...rest
}: ButtonProps) {
  const entry = useEntry()
  const gate = useInGate()

  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center',
        'cursor-pointer disabled:cursor-not-allowed',
        'disabled:bg-ground disabled:text-disabled disabled:border-line',
        gate
          ? gateClasses(tone)
          : ['rounded-control', sizeClasses(size, entry, height), toneClasses(tone, size, entry)],
        // A quiet button in the gate is a line of text and never fills the width.
        wide && !(gate && tone === 'quiet') && 'w-full',
        className,
      )}
      {...rest}
    >
      {Icon ? (
        <Icon
          {...(gate ? { size: 19, strokeWidth: 2 } : iconSize(size, entry))}
          aria-hidden="true"
          className="shrink-0"
        />
      ) : null}
      {children}
    </button>
  )
}

/**
 * The look of a button for something that is a link: a route, a PDF that
 * opens, a file that downloads. A link stays a link, so that it opens in a new
 * tab and a screen reader calls it one, and only borrows the clothes.
 */
export function useButtonLook(
  tone: ButtonTone = 'secondary',
  size: ButtonSize = 'normal',
  height?: SiteHeight,
): string {
  const entry = useEntry()

  return clsx(
    'inline-flex items-center justify-center rounded-control no-underline cursor-pointer',
    sizeClasses(size, entry, height),
    toneClasses(tone, size, entry),
  )
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly tone?: ButtonTone
  readonly size?: ButtonSize
  /** A symbol in front of the label, never instead of it. */
  readonly icon?: LucideIcon
  readonly wide?: boolean
  readonly height?: SiteHeight
  readonly children: ReactNode
}

/** An `<a>` for an address outside the router, dressed as a button: "PDF öffnen". */
export function ButtonLink({
  tone = 'secondary',
  size = 'normal',
  icon: Icon,
  wide = false,
  height,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const entry = useEntry()
  const look = useButtonLook(tone, size, height)

  return (
    <a className={clsx(look, wide && 'w-full', className)} {...rest}>
      {Icon ? <Icon {...iconSize(size, entry)} aria-hidden="true" className="shrink-0" /> : null}
      {children}
    </a>
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'wide' | 'icon' | 'size'> {
  /** Required: an icon alone says nothing to a screen reader. */
  readonly label: string
  readonly children: ReactNode
}

/**
 * The one exception to "no symbol without a word", for tools that sit in a row
 * and would not fit otherwise: camera, scanner, remove. The word moves into
 * `aria-label`, which is why that one is not optional.
 */
export function IconButton({ label, tone = 'quiet', className, ...rest }: IconButtonProps) {
  const entry = useEntry()

  return (
    <button
      type="button"
      aria-label={label}
      className={clsx(
        'inline-flex items-center justify-center',
        'h-tap w-tap min-h-tap min-w-tap rounded-control',
        'cursor-pointer disabled:cursor-not-allowed disabled:text-disabled',
        toneClasses(tone, 'normal', entry),
        className,
      )}
      {...rest}
    />
  )
}
