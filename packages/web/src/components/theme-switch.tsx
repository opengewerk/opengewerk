import clsx from 'clsx'
import { Moon, Sun } from 'lucide-react'

export type ThemeChoice = 'light' | 'dark'

export interface ThemeSwitchProps {
  readonly value: ThemeChoice
  readonly onChoose: (theme: ThemeChoice) => void
  /** 52 px and 16 px type, for the drawer on a phone in the office. */
  readonly large?: boolean
  readonly className?: string
}

const choices: readonly { readonly value: ThemeChoice; readonly label: string }[] = [
  { value: 'light', label: 'Hell' },
  { value: 'dark', label: 'Dunkel' },
]

/**
 * Light or dark, as two halves of one control and not as a checkbox: both
 * words are visible, so nobody has to guess which state "on" means.
 *
 * The chosen half is filled in ink on the ground colour, which turns around by
 * itself in the dark and needs no colour of its own. The height follows
 * `--spacing-control`, 34px in the office and 60px on site.
 */
export function ThemeSwitch({ value, onChoose, large = false, className }: ThemeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Darstellung"
      className={clsx(
        'flex gap-[3px] p-[3px] bg-surface-sunken border border-line rounded-control',
        large ? 'h-[52px]' : 'h-control',
        className,
      )}
    >
      {choices.map((choice) => {
        const chosen = choice.value === value

        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={chosen}
            onClick={() => {
              onChoose(choice.value)
            }}
            className={clsx(
              'flex-1 inline-flex items-center justify-center gap-2 px-3 rounded-[3px]',
              large ? 'text-[16px]' : 'text-body',
              'cursor-pointer',
              chosen ? 'bg-ink text-ground font-semibold' : 'bg-transparent text-ink',
            )}
          >
            {choice.value === 'light' ? (
              <Sun size={large ? 20 : 16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Moon size={large ? 20 : 16} strokeWidth={2} aria-hidden="true" />
            )}
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}
