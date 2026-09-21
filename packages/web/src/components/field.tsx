import clsx from 'clsx'
import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string
  /**
   * Handed through to the input itself. React 19 passes `ref` like any other
   * prop, so this needs no forwarding wrapper; it needs to be declared, or a
   * caller that wants to move the focus here has nowhere to put it. The search
   * box of a list is the case: the slash key has to land somewhere.
   */
  readonly ref?: Ref<HTMLInputElement>
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
export function Field({
  label,
  hint,
  problem,
  numeric = false,
  className,
  ref,
  ...rest
}: FieldProps) {
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
        ref={ref}
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

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  readonly label: string
  readonly hint?: ReactNode
  readonly problem?: string
}

/**
 * A labelled box for more than a line: the text above the positions of a
 * quote, the description of a service. The same rules as `Field`, the label
 * wired by an id nobody has to pass. The height follows the rows rather than
 * the control token, because a paragraph has no single right height, and line
 * breaks are kept as typed, because the printed document keeps them too.
 */
export function TextArea({ label, hint, problem, rows = 4, className, ...rest }: TextAreaProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const problemId = `${id}-problem`
  const described = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={problem ? true : undefined}
        aria-describedby={described.length > 0 ? described : undefined}
        className={clsx(
          'min-h-tap px-3 py-2 rounded-control',
          'bg-surface text-ink text-body',
          'border',
          problem ? 'border-conflict border-2' : 'border-line-strong',
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

export interface SelectFieldProps {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly onChange: (value: string) => void
  readonly hint?: ReactNode
  readonly required?: boolean
  readonly disabled?: boolean
}

/**
 * A labelled choice list.
 *
 * A plain `<select>`. The package has Radix for the cases where a native
 * control cannot do the job, and this is not one of them: the native one is
 * the only control on a phone that opens the wheel people already know how to
 * use, and it is announced correctly everywhere without help.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  required,
  disabled,
}: SelectFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        required={required}
        disabled={disabled}
        value={value}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="h-control-lg min-h-tap px-3 rounded-control bg-surface text-ink text-body border border-line-strong"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-table text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
