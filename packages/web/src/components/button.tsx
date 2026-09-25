import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

/**
 * The three things a button can be here, and a fourth that is barely one.
 *
 * `primary` is the copper one, and there is at most one per screen. Copper
 * marks the single action a screen is for; used on everything it marks
 * nothing. Nobody enforces that in code, which is why it is written down.
 */
export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'quiet'

const toneClasses: Readonly<Record<ButtonTone, string>> = {
  // `copper-solid`, not `copper`: white on the plain brand colour is 3.88:1.
  primary: 'bg-copper-solid text-on-copper border border-copper-solid',
  secondary: 'bg-surface text-ink border border-line-strong',
  danger: 'bg-surface text-conflict border border-conflict',
  quiet: 'bg-transparent text-ink-muted border border-transparent',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A prop like any other since React 19, passed on to the `<button>`. */
  readonly ref?: Ref<HTMLButtonElement>
  readonly tone?: ButtonTone
  /** Fills the width of its container, which is what the site entry wants. */
  readonly wide?: boolean
  readonly children: ReactNode
}

/**
 * A real `<button>`, always. A div with an onClick is skipped by Tab and
 * announced as nothing, and that is not a detail on a screen somebody operates
 * in a cellar with one hand.
 *
 * The height comes from `--spacing-control`, so the same component is 34px in
 * the office and 60px on site without a caller deciding.
 */
export function Button({ tone = 'secondary', wide = false, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-2',
        'h-control min-h-tap px-4 rounded-control',
        'text-body font-semibold',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
        toneClasses[tone],
        wide && 'w-full',
        className,
      )}
      {...rest}
    />
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'wide'> {
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
  return (
    <button
      type="button"
      aria-label={label}
      className={clsx(
        'inline-flex items-center justify-center',
        'h-tap w-tap min-h-tap min-w-tap rounded-control',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
        toneClasses[tone],
        className,
      )}
      {...rest}
    />
  )
}
