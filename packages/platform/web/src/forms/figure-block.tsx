import { TriangleAlert } from 'lucide-react'
import { useId, useRef } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/button.js'
import { FigureInput } from './figure.js'

/**
 * Why a figure looks impossible and what can be done about it, as the
 * application judges it: ten times the last reading, a comma in the wrong
 * place. It is a question and not a refusal; whoever stands at the meter may
 * keep the figure.
 */
export interface FigureDoubt {
  readonly text: string
  readonly onKeep: () => void
}

export interface FigureBlockProps {
  readonly label: string
  /** The sign of the unit, inside the box. */
  readonly unit: string
  /** The figure in thousandths, or none yet. */
  readonly value: number | undefined
  readonly onChange: (value: number | undefined) => void
  readonly hint?: string | undefined
  /** A doubt about the figure, where the application has one. */
  readonly doubt?: FigureDoubt | null
  /** What stands beside the figure: the last reading and the meter, for a reading. */
  readonly beside?: ReactNode
  readonly disabled?: boolean
}

/**
 * A number with its unit, and the reading of a meter (`meter_input()` of
 * the boards): the label over a large box with the unit inside. A reading
 * takes the last one beside it and a doubt under it, with the way back into
 * the box and the way to keep the figure as it is.
 */
export function FigureBlock({
  label,
  unit,
  value,
  onChange,
  hint,
  doubt = null,
  beside,
  disabled = false,
}: FigureBlockProps) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const described = [hint === undefined ? null : `${id}-hint`, doubt ? `${id}-doubt` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div ref={box} className="flex min-w-0 flex-col">
        <label htmlFor={id} className="mb-2 text-[16px] font-semibold text-ink">
          {label}
          <span className="sr-only">{` in ${unit}`}</span>
        </label>
        <FigureInput
          id={id}
          value={value}
          unit={unit}
          tone={doubt ? 'doubt' : 'plain'}
          describedBy={described.length > 0 ? described : undefined}
          disabled={disabled}
          onChange={onChange}
        />
        {hint === undefined ? null : (
          <p id={`${id}-hint`} className="mt-1.5 text-[14px] leading-[1.4] text-ink-muted">
            {hint}
          </p>
        )}
      </div>
      {doubt ? (
        <div className="flex flex-col gap-2.5 rounded-[6px] border border-waiting-edge bg-waiting-fill px-3.5 py-3">
          <p
            id={`${id}-doubt`}
            className="flex gap-2.5 text-[16px] leading-[1.35] font-semibold text-waiting"
          >
            <TriangleAlert size={20} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
            {doubt.text}
          </p>
          <div className="flex gap-2">
            <Button
              tone="dark"
              height={48}
              wide
              disabled={disabled}
              onClick={() => {
                box.current?.querySelector('input')?.focus()
              }}
            >
              Wert prüfen
            </Button>
            <Button height={48} wide disabled={disabled} onClick={doubt.onKeep}>
              So übernehmen
            </Button>
          </div>
        </div>
      ) : null}
      {beside}
    </div>
  )
}
