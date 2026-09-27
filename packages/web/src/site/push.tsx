import { Check } from 'lucide-react'

import { usePush } from '../app/push-state.js'

/** Why this device cannot have push, as short as the menu needs it. */
const blocked = {
  unsupported: 'Dieser Browser kann keine Push-Nachrichten empfangen.',
  install:
    'Auf dem iPhone kommen Push-Nachrichten nur, wenn OpenGewerk über „Zum Home-Bildschirm“ als App installiert ist.',
  denied:
    'Der Browser lässt für diese Seite keine Benachrichtigungen zu. Erlauben lassen sie sich in seinen Einstellungen.',
} as const

/**
 * Push in the menu of the site (#284), as the board "Menü" draws it: on or off
 * on this device, with 44 pixels for a thumb, and the occasions, which hold
 * for every device of the person.
 */
export function SitePush() {
  const push = usePush('site')
  const overview = push.overview

  if (overview === undefined || !overview.available) {
    // Nothing to switch without an answer or without a key. The office says
    // under "Konto" why an instance sends no push; the menu is no place for
    // what only its operator can change.
    return null
  }

  return (
    <>
      <div className="flex flex-col gap-1.5 px-0.5 pt-1 pb-1">
        <div className="px-1 font-condensed text-[14px] font-semibold uppercase tracking-[1.1px] text-ink-faint">
          Benachrichtigungen
        </div>
        {push.here ? (
          <div className="flex items-center gap-2.5 px-1">
            <span className="flex grow items-center gap-1.5 text-[16px] font-semibold text-done">
              <Check size={18} strokeWidth={2.4} aria-hidden="true" />
              Auf diesem Gerät an
            </span>
            <button
              type="button"
              disabled={push.busy}
              onClick={push.turnOff}
              className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-ground px-4 text-[16px] font-semibold text-ink"
            >
              Ausschalten
            </button>
          </div>
        ) : push.blocker !== null ? (
          <p className="px-1 text-[14px] leading-[1.4] text-ink-muted">{blocked[push.blocker]}</p>
        ) : (
          <div className="flex items-center gap-2.5 px-1">
            <span className="grow text-[16px] text-ink-muted">Auf diesem Gerät aus</span>
            <button
              type="button"
              disabled={push.busy}
              onClick={push.turnOn}
              className="min-h-11 cursor-pointer rounded-control bg-copper-solid px-4 text-[16px] font-semibold text-on-copper"
            >
              Einschalten
            </button>
          </div>
        )}
        {overview.occasions.map((occasion) => (
          <label key={occasion.key} className="flex min-h-11 items-center gap-3 px-1">
            <input
              type="checkbox"
              className="size-[22px] shrink-0 accent-copper-solid"
              checked={occasion.on}
              onChange={(event) => {
                push.choose(occasion.key, event.target.checked)
              }}
            />
            <span className="text-[17px]">{occasion.label}</span>
          </label>
        ))}
        {push.said ? (
          <p
            role={push.said.tone === 'conflict' ? 'alert' : 'status'}
            className={
              push.said.tone === 'conflict'
                ? 'px-1 text-[14px] font-semibold text-conflict'
                : 'px-1 text-[14px] font-semibold text-done'
            }
          >
            {push.said.text}
          </p>
        ) : null}
        <p className="px-1 text-[14px] leading-[1.4] text-ink-muted">
          Kommen auch, wenn OpenGewerk geschlossen ist. Die Anlässe gelten für jedes Gerät, auf dem
          Push an ist.
        </p>
      </div>
      <div aria-hidden="true" className="my-1.5 h-px bg-line" />
    </>
  )
}
