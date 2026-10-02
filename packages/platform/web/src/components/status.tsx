import clsx from 'clsx'
import { Ban, Check, Clock, Lock, Pencil, Play, Signature, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A state as a small marker, as `status()` of the canvas draws it (#219):
 * "Laufend", "Festgeschrieben", "Überfällig", "Hausverwaltung".
 *
 * Six tones, and each has its own symbol, so that a state is never told by
 * its colour alone: done, waiting, conflict, neutral for a plain property,
 * draft for something that can still change, and locked for what cannot.
 */
export type StatusTone = 'done' | 'waiting' | 'conflict' | 'neutral' | 'draft' | 'locked'

const toneClasses: Readonly<Record<StatusTone, string>> = {
  done: 'text-done bg-done-fill border-done-edge',
  waiting: 'text-waiting bg-waiting-fill border-waiting-edge',
  conflict: 'text-conflict bg-conflict-fill border-conflict-edge',
  neutral: 'text-ink-muted bg-surface-sunken border-line',
  draft: 'text-waiting bg-waiting-fill border-waiting-edge',
  locked: 'text-ink bg-surface border-ink',
}

const toneIcons: Readonly<Record<StatusTone, LucideIcon | null>> = {
  done: Check,
  waiting: Clock,
  conflict: TriangleAlert,
  neutral: null,
  draft: Pencil,
  locked: Lock,
}

/** The symbols a marker may carry instead of the one of its tone. */
export const statusIcons = {
  play: Play,
  sign: Signature,
  ban: Ban,
} as const

export interface StatusProps {
  readonly tone: StatusTone
  /** Instead of the symbol of the tone: "Laufend" plays, "Unterschrieben" signs. */
  readonly icon?: LucideIcon
  readonly children: ReactNode
}

export function Status({ tone, icon, children }: StatusProps) {
  const Icon = icon ?? toneIcons[tone]

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[3px] border px-2 py-0.5',
        'text-[13px] font-semibold leading-[1.2]',
        toneClasses[tone],
      )}
    >
      {Icon ? <Icon size={13} strokeWidth={2.4} aria-hidden="true" className="shrink-0" /> : null}
      {children}
    </span>
  )
}

/** A number of a job or a document, beside its title: "AU-2026-0184". */
export function NumberBadge({ children }: { readonly children: ReactNode }) {
  return (
    <span className="numeric rounded-[3px] border border-line bg-surface-sunken px-[7px] py-0.5 font-condensed text-[14px] font-semibold tracking-[0.6px] text-ink-muted">
      {children}
    </span>
  )
}
