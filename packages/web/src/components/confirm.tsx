import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

import { Button } from './button.js'

export interface ConfirmProps {
  /** Whether the question is on screen. */
  readonly open: boolean
  /** The question, as a heading: "Anna Weber sperren?". */
  readonly title: string
  /** What happens, in a sentence or two, and whether it can be undone. */
  readonly children: ReactNode
  /** The word on the button that does it: "Sperren", not "OK". */
  readonly confirm: string
  /** The way out. "Abbrechen" unless a better word fits. */
  readonly cancel?: string
  /**
   * `danger` for what removes, blocks or signs out; `primary` for what only
   * finishes, like closing a job.
   */
  readonly tone?: 'danger' | 'primary'
  /** While the action runs: both buttons wait. */
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * A question before something that cannot simply be taken back, as the boards
 * "Sperren-Rueckfrage" and "Abmelden-Rueckfrage" draw it: the page dimmed, a
 * card in the middle with the question, a sentence on what follows, and the
 * way out beside the action (#222).
 *
 * The way out has the focus when it opens, so Enter on a keyboard does not do
 * the thing by reflex; Escape and a tap beside the card take the way out as
 * well. An `alertdialog`, because it interrupts and wants an answer.
 */
export function Confirm({
  open,
  title,
  children,
  confirm,
  cancel = 'Abbrechen',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const heading = useId()
  const text = useId()
  const way = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    way.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onCancel])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pt-[20vh] pb-4">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[rgb(15_20_27/0.45)]"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={heading}
        aria-describedby={text}
        className="relative flex w-full max-w-[480px] flex-col gap-3.5 rounded-[8px] border border-line bg-surface px-6 py-[22px] shadow-[0_16px_40px_rgb(15_20_27/0.28)]"
      >
        <h2 id={heading} className="text-[20px] font-semibold">
          {title}
        </h2>
        <div id={text} className="text-body leading-[1.55]">
          {children}
        </div>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Button ref={way} tone="secondary" disabled={busy} onClick={onCancel}>
            {cancel}
          </Button>
          <Button tone={tone} disabled={busy} onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  )
}
