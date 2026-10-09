import type { LimitVerdict } from '@opengewerk/platform-domain'
import clsx from 'clsx'
import { useId } from 'react'

import { FigureInput } from './figure.js'

/** A limit as the head of a measured value shows it: `≥ 60,0 °C`, `≤ 0,40 Ω`. */
export function limitMark(kind: 'at_least' | 'at_most', limit: string): string {
  return `${kind === 'at_least' ? '≥' : '≤'} ${limit}`
}

/** The verdict under a value, with the place its limit comes from, so that whoever reads it can check it. */
export function verdictText(verdict: LimitVerdict): string {
  return verdict.source === null ? verdict.text : `${verdict.text} Quelle: ${verdict.source}.`
}

export interface MeasurementBlockProps {
  readonly label: string
  /** The sign of the unit, inside the box. */
  readonly unit: string
  /** The value in thousandths, or none yet. */
  readonly value: number | undefined
  readonly onChange: (value: number | undefined) => void
  /**
   * How the value stands against its limit, as the engine judges it on the
   * day of the form; null for a field without a limit.
   */
  readonly verdict: LimitVerdict | null
  /** The limit in short at the head, `limitMark()`, where there is one. */
  readonly mark?: string | undefined
  readonly hint?: string | undefined
  readonly disabled?: boolean
}

/**
 * A measured value with its limit (`measure()` of the boards): a card whose
 * edge turns green within the limit and red outside it, the limit in short
 * beside the label and the verdict with its source under the value. A value
 * outside is kept and said so, never refused.
 */
export function MeasurementBlock({
  label,
  unit,
  value,
  onChange,
  verdict,
  mark,
  hint,
  disabled = false,
}: MeasurementBlockProps) {
  const id = useId()
  const within = verdict?.within ?? null
  const said = verdict === null ? hint : verdictText(verdict)

  return (
    <div
      className={clsx(
        'flex min-w-0 flex-col rounded-[6px] border border-l-4 border-line bg-surface px-3.5 py-3',
        within === true
          ? 'border-l-done'
          : within === false
            ? 'border-l-conflict'
            : 'border-l-control',
      )}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <label htmlFor={id} className="grow text-[16px] font-semibold text-ink">
          {label}
          <span className="sr-only">{` in ${unit}`}</span>
        </label>
        {mark === undefined ? null : (
          <span className="shrink-0 text-[15px] whitespace-nowrap text-ink-faint">{mark}</span>
        )}
      </div>
      <FigureInput
        id={id}
        value={value}
        unit={unit}
        tone={within === false ? 'outside' : 'plain'}
        describedBy={said === undefined ? undefined : `${id}-verdict`}
        disabled={disabled}
        onChange={onChange}
      />
      {said === undefined ? null : (
        <p
          id={`${id}-verdict`}
          className={clsx(
            'mt-[7px] text-[15px] leading-[1.4]',
            within === false ? 'font-semibold text-conflict' : 'text-ink-muted',
          )}
        >
          {said}
        </p>
      )}
    </div>
  )
}
