import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react'

import { useInGate } from './gate.js'
import type { Entry } from './surface.js'
import { useEntry } from './surface.js'

/**
 * How a field looks, as `field()` and `site_field()` of the canvas draw it
 * (#219): in the office a 13 pixel label over a white control of the control
 * height, on site a label in semibold over a larger one. The control is white
 * in the light ground and the page colour in the dark, the token `input`.
 */
const look = {
  office: {
    frame: 'gap-1',
    label: 'text-[13px] font-medium text-ink',
    height: 'h-control-lg min-h-tap',
    control: 'px-2.5 rounded-control text-body',
    note: 'text-[13px] leading-[1.4] text-ink-faint',
    unit: 'text-[13px] text-ink-muted',
  },
  site: {
    frame: 'gap-1.5',
    label: 'text-[15px] font-semibold text-ink',
    height: 'h-control-lg min-h-tap',
    control: 'px-3 rounded-[5px] text-[17px]',
    note: 'text-[14px] leading-[1.4] text-ink-muted',
    unit: 'text-[17px] text-ink-muted',
  },
  // Before sign in, `gate_field()` of the boards: 52 pixels on a phone, 42 at
  // a desk, where the gate is a form on a page rather than a screen of work.
  gate: {
    frame: 'gap-[5px]',
    label: 'text-[15px] lg:text-[14px] font-medium text-ink',
    height: 'h-13 lg:h-[42px]',
    control: 'px-3 rounded-[4px] text-[17px] lg:text-[15px]',
    note: 'text-[13px] leading-[1.45] text-ink-muted',
    unit: 'text-[15px] text-ink-muted',
  },
} as const satisfies Record<Entry | 'gate', Record<string, string>>

/** The look of a field where it stands: in the gate, or in the office or on site. */
function useLook(): keyof typeof look {
  const entry = useEntry()

  return useInGate() ? 'gate' : entry
}

/** The edge of a control, which a problem turns red and thicker. */
function edge(problem: string | undefined): string {
  return problem ? 'border-2 border-conflict' : 'border border-line-strong'
}

/** The line under a field, and the problem under that, both wired to it. */
function Notes({
  kind,
  hint,
  hintId,
  problem,
  problemId,
}: {
  readonly kind: keyof typeof look
  readonly hint?: ReactNode
  readonly hintId: string
  readonly problem?: string | undefined
  readonly problemId: string
}) {
  return (
    <>
      {hint ? (
        <p id={hintId} className={look[kind].note}>
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p id={problemId} className={clsx(look[kind].note, 'font-semibold text-conflict!')}>
          {problem}
        </p>
      ) : null}
    </>
  )
}

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
  /**
   * The unit behind the field, "A" or "mm²", as the site boards draw it:
   * outside the box, so a thumb does not type into it.
   */
  readonly unit?: string
  /**
   * Beside the label at the right, as "Passwort vergessen?" stands beside
   * "Passwort" on the board "Tor-Anmelden".
   */
  readonly aside?: ReactNode
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
  unit,
  aside,
  className,
  ref,
  ...rest
}: FieldProps) {
  const id = useId()
  const kind = useLook()
  const hintId = `${id}-hint`
  const problemId = `${id}-problem`
  const described = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ')

  const input = (
    <input
      id={id}
      ref={ref}
      aria-invalid={problem ? true : undefined}
      aria-describedby={described.length > 0 ? described : undefined}
      className={clsx(
        'w-full min-w-0 bg-input text-ink',
        look[kind].height,
        look[kind].control,
        edge(problem),
        numeric && 'numeric',
        className,
      )}
      {...rest}
    />
  )

  return (
    <div className={clsx('flex min-w-0 flex-col', look[kind].frame)}>
      {aside ? (
        <div className="flex items-baseline gap-2">
          <label htmlFor={id} className={clsx('grow', look[kind].label)}>
            {label}
          </label>
          {aside}
        </div>
      ) : (
        <label htmlFor={id} className={look[kind].label}>
          {label}
        </label>
      )}
      {unit ? (
        <div className="flex items-center gap-2.5">
          {input}
          <span aria-hidden="true" className={clsx('shrink-0', look[kind].unit)}>
            {unit}
          </span>
        </div>
      ) : (
        input
      )}
      <Notes kind={kind} hint={hint} hintId={hintId} problem={problem} problemId={problemId} />
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
    <span className="font-condensed text-label font-semibold tracking-[1.1px] uppercase text-ink-faint">
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
  const kind = useLook()
  const hintId = `${id}-hint`
  const problemId = `${id}-problem`
  const described = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ')

  return (
    <div className={clsx('flex min-w-0 flex-col', look[kind].frame)}>
      <label htmlFor={id} className={look[kind].label}>
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={problem ? true : undefined}
        aria-describedby={described.length > 0 ? described : undefined}
        className={clsx(
          'min-h-tap w-full min-w-0 py-2 leading-[1.45] bg-input text-ink',
          look[kind].control,
          edge(problem),
          className,
        )}
        {...rest}
      />
      <Notes kind={kind} hint={hint} hintId={hintId} problem={problem} problemId={problemId} />
    </div>
  )
}

export interface SelectFieldProps {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly onChange: (value: string) => void
  readonly hint?: ReactNode
  /** When set, the list is marked invalid and this is read out with it. */
  readonly problem?: string
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
  problem,
  required,
  disabled,
}: SelectFieldProps) {
  const id = useId()
  const entry = useEntry()
  const kind = useLook()
  const hintId = `${id}-hint`
  const problemId = `${id}-problem`
  const described = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ')

  return (
    <div className={clsx('flex min-w-0 flex-col', look[kind].frame)}>
      <label htmlFor={id} className={look[kind].label}>
        {label}
      </label>
      {/* The native list, with the arrow of the canvas instead of the
          browser's, which differs on every system. */}
      <div className="relative min-w-0">
        <select
          id={id}
          required={required}
          disabled={disabled}
          value={value}
          aria-invalid={problem ? true : undefined}
          aria-describedby={described.length > 0 ? described : undefined}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          className={clsx(
            'h-control-lg min-h-tap w-full min-w-0 cursor-pointer appearance-none bg-input text-ink',
            look[kind].control,
            entry === 'site' ? 'pr-10' : 'pr-[30px]',
            edge(problem),
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={entry === 'site' ? 20 : 15}
          strokeWidth={2.2}
          aria-hidden="true"
          className={clsx(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted',
            entry === 'site' ? 'right-3' : 'right-[9px]',
          )}
        />
      </div>
      <Notes kind={kind} hint={hint} hintId={hintId} problem={problem} problemId={problemId} />
    </div>
  )
}
