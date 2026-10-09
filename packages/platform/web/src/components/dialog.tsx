import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface DialogProps {
  /** What the dialog is for, as its heading: "Zugang bearbeiten". */
  readonly title: string
  /** Under the heading, in a sentence: what happens here. */
  readonly sub?: string
  /** How wide the card may get, as the boards draw their dialogs. */
  readonly width?: 520 | 600 | 640
  /** The way out without doing anything, on Escape. */
  readonly onClose: () => void
  /** The fields, and at their foot the buttons (`DialogActions`). */
  readonly children: ReactNode
}

const widths: Readonly<Record<NonNullable<DialogProps['width']>, string>> = {
  520: 'max-w-[520px]',
  600: 'max-w-[600px]',
  640: 'max-w-[640px]',
}

/**
 * A short form over the dimmed page, `dialog()` of the canvas: a heading, the
 * fields, and at the foot the way out beside the button that does it.
 *
 * Unlike a question (`Confirm`) a tap beside the card does nothing: a form
 * holds what somebody typed, and a slip of the hand should not throw it away.
 * Escape closes it, unless a question stands above it, which takes the key
 * for itself.
 *
 * On a wider screen the card stands in the middle of the window, as the
 * boards draw it over the screen it belongs to; one taller than the window
 * starts at its top and scrolls. On a phone it stands at the top, where the
 * keyboard leaves it in view.
 *
 * The focus moves into the card when it opens, to a field that asks for it
 * (`autoFocus`) or to the card itself, and goes back to where it was when the
 * dialog closes, so that a keyboard is not left at the top of the page.
 */
export function Dialog({ title, sub, width = 600, onClose, children }: DialogProps) {
  const heading = useId()
  const text = useId()
  const card = useRef<HTMLDivElement>(null)
  // Read once, before anything in the dialog can take the focus.
  const [opener] = useState(() => document.activeElement)

  useEffect(() => {
    if (!card.current?.contains(document.activeElement)) {
      card.current?.focus()
    }

    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus()
      }
    }
  }, [opener])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('[role="alertdialog"]') === null) {
        onClose()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 max-sm:px-2 max-sm:pt-3">
      <div aria-hidden="true" className="fixed inset-0 bg-[rgb(15_20_27/0.45)]" />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        aria-describedby={sub ? text : undefined}
        tabIndex={-1}
        className={clsx(
          'relative flex w-full flex-col gap-3.5 rounded-[6px] border border-line bg-surface px-[22px] py-5 shadow-[0_12px_32px_rgb(15_20_27/0.28)] outline-none sm:my-auto max-sm:px-4',
          widths[width],
        )}
      >
        <div>
          <h2 id={heading} className="text-[18px] font-semibold text-ink">
            {title}
          </h2>
          {sub ? (
            <p id={text} className="mt-1.5 text-[13px] leading-[1.5] text-ink-muted">
              {sub}
            </p>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  )
}

/** The foot of a dialog: the way out, and at its right the button that does it. */
export function DialogActions({ children }: { readonly children: ReactNode }) {
  return <div className="mt-1 flex flex-wrap justify-end gap-2">{children}</div>
}
