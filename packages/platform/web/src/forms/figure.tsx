import clsx from 'clsx'
import { useState } from 'react'

import { amount, scaledNumber } from '../format.js'

/** How a figure stands: nothing to say, outside its limit, or in doubt. */
export type FigureTone = 'plain' | 'outside' | 'doubt'

export interface FigureInputProps {
  /** The id of the input, for the label the block around it draws. */
  readonly id: string
  /** The figure in thousandths, as the form engine keeps it, or none yet. */
  readonly value: number | undefined
  /** Called with the figure as it reads, or undefined once the box is empty. */
  readonly onChange: (value: number | undefined) => void
  /** The sign of its unit, inside the box at the right. */
  readonly unit: string
  readonly tone?: FigureTone
  /** Ids of what else describes the input, the verdict of a limit among them. */
  readonly describedBy?: string
  readonly disabled?: boolean
}

/**
 * A figure as a thumb types it on site: large, with its unit inside the box,
 * so that nothing leaves a narrow screen (`measure()` of the boards). What is
 * typed is kept as typed until it reads as a number; a value that does not
 * read is not handed on, and the box says so under it, while the last one
 * that did stays where it was.
 */
export function FigureInput({
  id,
  value,
  onChange,
  unit,
  tone = 'plain',
  describedBy,
  disabled = false,
}: FigureInputProps) {
  const [typed, setTyped] = useState(value === undefined ? '' : amount(value))
  const [unread, setUnread] = useState(false)
  const problemId = `${id}-problem`
  const described = [describedBy, unread ? problemId : null].filter(Boolean).join(' ')

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className={clsx(
          'flex h-[60px] min-w-0 items-center overflow-hidden rounded-[6px] bg-input',
          unread || tone === 'outside'
            ? 'border-2 border-conflict'
            : tone === 'doubt'
              ? 'border-2 border-waiting-edge'
              : 'border border-line-strong',
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={typed}
          aria-invalid={unread ? true : undefined}
          aria-describedby={described.length > 0 ? described : undefined}
          className={clsx(
            'h-full w-full min-w-0 grow bg-transparent px-3 text-[26px] font-bold tabular-nums outline-none',
            tone === 'outside' ? 'text-conflict' : 'text-ink',
          )}
          onChange={(event) => {
            const input = event.target.value
            const read = scaledNumber(input, 3)

            setTyped(input)

            if (input.trim() === '') {
              setUnread(false)
              onChange(undefined)
            } else if (read === null) {
              setUnread(true)
            } else {
              setUnread(false)
              onChange(read)
            }
          }}
        />
        <span
          aria-hidden="true"
          className="shrink-0 px-3.5 text-[18px] font-semibold text-ink-muted"
        >
          {unit}
        </span>
      </div>
      {unread ? (
        <p id={problemId} className="text-[14px] font-semibold text-conflict">
          Eine Zahl, etwa 0,85.
        </p>
      ) : null}
    </div>
  )
}
