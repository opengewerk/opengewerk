import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Where the bar at the foot of a screen goes: a place in the shell above the
 * tabs, as the boards of a form on site draw it, "Regiebericht schreiben",
 * "Zeit nachtragen", "Stromkreis, Angaben ergänzen". A screen with such a bar
 * has no tabs under it on a phone; the shell hides them while the bar is
 * there, by asking the page and not by keeping count.
 */
const ActionSlot = createContext<HTMLElement | null>(null)

export const ActionSlotProvider = ActionSlot.Provider

/** The attribute the shell looks for, to hide the tabs while a bar stands. */
export const actionBarMark = 'data-action-bar'

/**
 * The buttons of a screen at the foot of it, `site_action()` of the boards:
 * on the page colour over a line, 60 pixels high, and under them the sentence
 * that says what pressing them does, where there is one.
 */
export function SiteActionBar({
  children,
  note,
}: {
  readonly children: ReactNode
  readonly note?: ReactNode
}) {
  const slot = useContext(ActionSlot)

  const bar = (
    <div {...{ [actionBarMark]: '' }} className="border-t border-line bg-ground px-4 pt-3 pb-4">
      <div className="flex gap-2">{children}</div>
      {note ? (
        <p className="mt-2 text-center text-[14px] leading-[1.35] text-ink-muted">{note}</p>
      ) : null}
    </div>
  )

  // Without a shell around it, in a test of one screen, the bar stands in
  // place; its buttons are still there to be pressed.
  return slot ? createPortal(bar, slot) : bar
}
