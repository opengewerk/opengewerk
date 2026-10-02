import { Monitor, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { useApplication } from '../application.js'
import { ThemeSwitch } from '../components/theme-switch.js'
import { useTheme } from '../components/theme.js'
import { SignOutButton } from '../gate/sign-out.js'
import { useWho } from '../session/who.js'
import { entryPath, rememberEntry } from '../shell/entry.js'
import { useSync } from '../sync/provider.js'

/**
 * The menu of the site, a sheet from the bottom, as the board of that menu
 * draws it: who is signed in and where, light or dark on this device, what
 * the application adds for this device, the way to the office view and
 * signing out.
 *
 * From the bottom because that is where the thumb is and where the tab that
 * opens it sits. It closes on the cross, on Escape and on a tap beside it; the
 * cross takes the focus when it opens, so a keyboard starts inside.
 */
export function SiteMenu({
  open,
  onClose,
  children,
}: {
  readonly open: boolean
  readonly onClose: () => void
  /** Rows of the application, between light and dark and the way to the office. */
  readonly children?: ReactNode
}) {
  const who = useWho()
  const client = useSync()
  const [theme, chooseTheme] = useTheme()
  const { entry: sentences } = useApplication().sentences
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    close.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Menü" className="fixed inset-0 z-40">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[rgb(15_20_27/0.45)]"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-dvh max-w-[520px] flex-col gap-1 overflow-y-auto rounded-t-[14px] bg-surface px-3 pt-2 pb-4 shadow-[0_-8px_28px_rgb(15_20_27/0.25)]">
        <div
          aria-hidden="true"
          className="mx-auto mt-0.5 mb-2 h-[5px] w-11 rounded-[3px] bg-line-strong"
        />
        <div className="flex items-center gap-3 border-b border-line px-1.5 pt-1 pb-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-copper-solid text-[15px] font-semibold text-on-copper"
          >
            {who.initials}
          </span>
          <div className="min-w-0 grow">
            <div className="text-[17px] font-semibold">{who.name}</div>
            <div className="text-[14px] text-ink-muted">
              {[who.roles, who.tenant].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button
            ref={close}
            type="button"
            aria-label="Menü schließen"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted cursor-pointer"
          >
            <X size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-2 px-0.5 pt-2.5 pb-1">
          <div className="px-1 font-condensed text-[14px] font-semibold uppercase tracking-[1.1px] text-ink-faint">
            Darstellung
          </div>
          <ThemeSwitch value={theme} onChoose={chooseTheme} large />
          <p className="px-1 text-[14px] leading-[1.4] text-ink-muted">
            Gilt auf diesem Gerät. Hell ist der Standard.
          </p>
        </div>
        <div aria-hidden="true" className="my-1.5 h-px bg-line" />
        {children}
        <a
          href={entryPath.office}
          onClick={() => {
            rememberEntry('office')
          }}
          className="flex min-h-14 items-center gap-3 rounded-[6px] px-3.5 text-[17px] text-ink no-underline"
        >
          <Monitor size={22} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
          <span className="grow">
            {sentences.goTo.office}
            <span className="block text-[14px] text-ink-muted">
              Mehr Übersicht, für Maus und Tastatur
            </span>
          </span>
        </a>
        <SignOutButton
          client={client}
          row="large"
          onSignedOut={() => {
            // As in the office: signing out ends with the sync client stopped
            // and the local store gone, and reloading is the shortest honest
            // way to be sure of that.
            globalThis.location.assign(entryPath.site)
          }}
        />
      </div>
    </div>
  )
}
