import type { CheckPointResult } from '@opengewerk/platform-domain'
import clsx from 'clsx'
import { Ban, Check, X } from 'lucide-react'

import { checkPointWords } from './check-point.js'

/** What a point holds, as its line in a list of points says it. */
export type PointState =
  | { readonly kind: 'open' }
  | { readonly kind: 'result'; readonly result: CheckPointResult }
  /** A value in words, `61,0 °C`; outside its limit it is marked as not in order is. */
  | { readonly kind: 'value'; readonly text: string; readonly outside?: boolean }

/**
 * The answer at the end of the line of a point (`answer_badge()` of the
 * boards): a value in green with a tick, the answer to a check point in its
 * colour, "offen" quiet. A value outside its limit is red with a cross, as
 * "nicht in Ordnung" is, because it becomes the same with the signature.
 */
export function AnswerMark({ state }: { readonly state: PointState }) {
  if (state.kind === 'open') {
    return <span className="shrink-0 text-[15px] font-semibold text-ink-faint">offen</span>
  }

  if (state.kind === 'value') {
    const Icon = state.outside === true ? X : Check

    return (
      <span
        className={clsx(
          'inline-flex shrink-0 items-center gap-[5px] text-[16px] font-bold whitespace-nowrap tabular-nums',
          state.outside === true ? 'text-conflict' : 'text-done',
        )}
      >
        <Icon size={16} strokeWidth={2.6} aria-hidden="true" />
        {state.text}
      </span>
    )
  }

  const Icon = state.result === 'ok' ? Check : state.result === 'not_ok' ? X : Ban

  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-[5px] text-[15px] font-semibold whitespace-nowrap',
        state.result === 'ok'
          ? 'text-done'
          : state.result === 'not_ok'
            ? 'text-conflict'
            : 'text-ink-muted',
      )}
    >
      <Icon size={16} strokeWidth={2.6} aria-hidden="true" />
      {checkPointWords[state.result].full}
    </span>
  )
}

/**
 * How far a form is (`progress()` of the boards): a sentence, the share in
 * per cent and the bar. The bar is drawn for the eye; a reader hears the
 * sentence and the number.
 */
export function AnswerProgress({
  done,
  total,
  text,
}: {
  readonly done: number
  readonly total: number
  readonly text: string
}) {
  const share = total === 0 ? 0 : Math.round((100 * done) / total)

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex justify-between gap-2 text-[15px] text-ink-muted">
        <span>{text}</span>
        <span className="tabular-nums">{`${String(share)} %`}</span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-[4px] bg-surface-sunken">
        <div className="h-full bg-copper" style={{ width: `${String(share)}%` }} />
      </div>
    </div>
  )
}
