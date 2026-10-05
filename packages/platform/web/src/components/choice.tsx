import clsx from 'clsx'
import { useId } from 'react'

export interface ChoiceOption<Value extends string> {
  readonly value: Value
  readonly label: string
  /** Under the label, smaller: what picking it means. */
  readonly note?: string | undefined
}

export interface ChoiceProps<Value extends string> {
  /** What is being chosen: shown over the options, and what a reader hears the group called. */
  readonly label: string
  readonly options: readonly ChoiceOption<Value>[]
  /** The one picked, or none yet. */
  readonly value: Value | null
  readonly onChange: (value: Value) => void
  readonly disabled?: boolean
}

/**
 * One of a few, all of them in sight: `inline_choice()` of the canvas, and
 * with a sentence under each option its cards, two in a row.
 *
 * Radio buttons and not a select, because the options are few and what
 * distinguishes them is the point: a role with what it is for, "alle" beside
 * "genannte". The whole card is the target. An option is named by its label
 * alone and described by its sentence, so that a reader hears "Leitung" and
 * then what it means, not both run together as a name.
 */
export function Choice<Value extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: ChoiceProps<Value>) {
  const id = useId()
  const cards = options.some((option) => option.note !== undefined)

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 font-condensed text-label font-semibold tracking-[1.1px] text-ink-faint uppercase">
        {label}
      </legend>
      <div className={cards ? 'grid gap-1.5 sm:grid-cols-2' : 'flex flex-wrap gap-1.5'}>
        {options.map((option, index) => {
          const picked = option.value === value
          const name = `${id}-${String(index)}`

          return (
            <label
              key={option.value}
              className={clsx(
                'flex cursor-pointer gap-[9px] rounded-[4px] border bg-surface text-[14px] text-ink',
                cards
                  ? 'items-start px-[11px] py-[9px]'
                  : 'min-h-[34px] flex-1 items-center px-2.5 max-lg:min-h-tap',
                picked ? 'border-ink' : 'border-control',
                disabled && 'cursor-not-allowed text-disabled',
              )}
            >
              <input
                type="radio"
                name={id}
                className={clsx(
                  'size-[15px] shrink-0 accent-copper-solid max-lg:size-5',
                  cards && 'mt-0.5',
                )}
                checked={picked}
                aria-labelledby={`${name}-label`}
                aria-describedby={option.note === undefined ? undefined : `${name}-note`}
                onChange={() => {
                  onChange(option.value)
                }}
              />
              <span className="min-w-0">
                <span id={`${name}-label`}>{option.label}</span>
                {option.note === undefined ? null : (
                  <span
                    id={`${name}-note`}
                    className="block text-[12px] leading-[1.4] text-ink-muted"
                  >
                    {option.note}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
