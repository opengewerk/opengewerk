import { type CheckPointResult, checkPointResults } from '@opengewerk/platform-domain'
import clsx from 'clsx'
import { Ban, Check, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The four answers as a button says them: in full where a point stands on a
 * screen of its own, short where four stand in a row under a list of points.
 * A short one is read out in full.
 */
export const checkPointWords: Readonly<
  Record<CheckPointResult, { readonly full: string; readonly short: string }>
> = {
  ok: { full: 'In Ordnung', short: 'i. O.' },
  not_ok: { full: 'Nicht in Ordnung', short: 'n. i. O.' },
  not_applicable: { full: 'Entfällt', short: 'entfällt' },
  not_possible: { full: 'Nicht möglich', short: 'n. m.' },
}

const icons: Readonly<Record<CheckPointResult, LucideIcon>> = {
  ok: Check,
  not_ok: X,
  not_applicable: Ban,
  not_possible: Ban,
}

/** How a picked answer stands out: in order green, not in order red, the other two quiet. */
const picked: Readonly<Record<CheckPointResult, string>> = {
  ok: 'border-2 border-done bg-done-fill text-done',
  not_ok: 'border-2 border-conflict bg-conflict-fill text-conflict',
  not_applicable: 'border-2 border-ink-muted bg-surface-sunken text-ink-muted',
  not_possible: 'border-2 border-ink-muted bg-surface-sunken text-ink-muted',
}

/** In a row the picked answer is filled, as the board of the protocol draws it. */
const pickedInRow: Readonly<Record<CheckPointResult, string>> = {
  ok: 'border-0 bg-done text-on-status',
  not_ok: 'border-0 bg-conflict text-on-status',
  not_applicable: 'border-2 border-ink-muted bg-surface-sunken text-ink',
  not_possible: 'border-2 border-ink-muted bg-surface-sunken text-ink',
}

export interface CheckPointAnswerProps {
  /** The point, which a reader hears the group of answers called. */
  readonly label: string
  /** The answer given, or none yet. */
  readonly value: CheckPointResult | undefined
  readonly onChange: (result: CheckPointResult) => void
  /**
   * `grid` for a point on a screen of its own, two by two and large enough
   * for a gloved thumb; `row` for a point among others, the four in a line.
   */
  readonly layout?: 'grid' | 'row'
  readonly disabled?: boolean
}

/**
 * The answer to a check point: in order, not in order, not applicable, not
 * possible. Buttons that say whether they are pressed rather than radio
 * buttons, because each is a target of its own and the boards draw them so;
 * the group carries the name of the point, so that "In Ordnung" is never
 * heard without what is in order.
 */
export function CheckPointAnswer({
  label,
  value,
  onChange,
  layout = 'grid',
  disabled = false,
}: CheckPointAnswerProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={layout === 'grid' ? 'grid grid-cols-2 gap-2' : 'flex gap-1.5'}
    >
      {checkPointResults.map((result) => {
        const on = value === result
        const Icon = icons[result]
        const words = checkPointWords[result]

        return layout === 'grid' ? (
          <button
            key={result}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            className={clsx(
              'flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[8px] px-2 text-[17px] disabled:cursor-not-allowed',
              on
                ? clsx(picked[result], 'font-bold')
                : 'border border-control bg-surface font-semibold text-ink',
            )}
            onClick={() => {
              onChange(result)
            }}
          >
            <Icon size={24} strokeWidth={2.4} aria-hidden="true" />
            {words.full}
          </button>
        ) : (
          <button
            key={result}
            type="button"
            aria-pressed={on}
            aria-label={words.full}
            disabled={disabled}
            className={clsx(
              'h-11 min-w-0 flex-1 basis-0 cursor-pointer rounded-[4px] text-[15px] font-semibold disabled:cursor-not-allowed',
              on ? pickedInRow[result] : 'border border-control bg-surface text-ink',
            )}
            onClick={() => {
              onChange(result)
            }}
          >
            {words.short}
          </button>
        )
      })}
    </div>
  )
}
