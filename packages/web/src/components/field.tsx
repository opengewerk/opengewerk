import clsx from 'clsx'
import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string
  /** Shown under the field, in plain words. Not a tooltip. */
  readonly hint?: ReactNode
  /** When set, the field is marked invalid and this is read out with it. */
  readonly problem?: string
  /** Amounts, quantities, measured values: switches on tabular figures. */
  readonly numeric?: boolean
}

/**
 * A labelled input, and the label is not optional.
 *
 * The id is generated and wired to `htmlFor` here, because the failure mode is
 * silent: a field without a label still looks finished, and a screen reader
 * announces "edit text" with no idea what for. Making the caller pass an id
 * would mean the first person in a hurry ships one without.
 */
export function Field({ label, hint, problem, numeric = false, className, ...rest }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const problemId = `${id}-problem`
  const described = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={problem ? true : undefined}
        aria-describedby={described.length > 0 ? described : undefined}
        className={clsx(
          'h-control-lg min-h-tap px-3 rounded-control',
          'bg-surface text-ink text-body',
          'border',
          problem ? 'border-conflict border-2' : 'border-line-strong',
          numeric && 'numeric',
          className,
        )}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-table text-ink-muted">
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p id={problemId} className="text-table font-semibold text-conflict">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The small capitals over a column or a group of values. `font-condensed`
 * rather than letter spacing on the body face: Barlow Condensed is part of the
 * same family and keeps the line short where a table head has no room.
 */
export function FieldLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="font-condensed text-label font-semibold tracking-wider uppercase text-ink-faint">
      {children}
    </span>
  )
}
