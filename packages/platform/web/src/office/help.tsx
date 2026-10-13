import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { CircleQuestionMark, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { isNarrow, useBand } from '../components/band.js'
import { Markdown, markdownTitle } from '../components/markdown.js'

/**
 * The help beside a screen (opengewerk-haustechnik#131): what the screen is
 * for and the steps of its main flow, behind the question mark in the header.
 *
 * The texts are the application's, shipped with it as Markdown, so that they
 * are read without a network like every screen. Which text belongs to which
 * address the application says; the frame draws the button and the drawer.
 */

/** A way from the drawer to more: the quick guides, a manual. */
export interface HelpLink {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
}

/** The help of an application, as the frame of the office asks it. */
export interface HelpSource {
  /**
   * The text of the screen at this address as Markdown, or null where the
   * application has none. It may be loaded when it is asked for, so that the
   * texts are no part of what every screen loads; the first heading is what
   * the drawer calls itself.
   */
  readonly textAt: (pathname: string) => string | null | Promise<string | null>
  /** Where the drawer leads beyond the screen, as buttons at its foot. */
  readonly more?: readonly HelpLink[]
}

/** The name the button and its entry in the navigation carry. */
export const helpLabel = 'Hilfe zu dieser Seite'

/**
 * The question mark in the header, from 1024 pixels on. Narrower, the header
 * has no room beside the search and the person, and the help is an entry at
 * the foot of the navigation behind "Menü".
 */
export function HelpButton({
  open,
  onToggle,
}: {
  readonly open: boolean
  readonly onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={helpLabel}
      aria-expanded={open}
      onClick={onToggle}
      className="hidden size-[34px] shrink-0 items-center justify-center rounded-control text-top-muted cursor-pointer lg:flex"
    >
      <CircleQuestionMark size={19} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

/**
 * The drawer with the help of the screen that stands: beside the screen from
 * 1024 pixels on, so that the text is read next to what it is about, and over
 * the screen below. It follows the address: opened on one screen and left
 * open, it shows the text of the next. Below 1024 pixels, where it lies over
 * the screen, it makes way when a link of its text is followed, and a way to
 * more at its foot closes it at every width: what it leads to is a screen of
 * its own.
 *
 * No dialog: beside the screen it takes nothing from it, and the screen
 * stays in use. It closes on Escape and by its cross; while a dialog stands
 * on the screen, Escape closes that and not the help.
 */
export function HelpDrawer({
  open,
  onClose,
  source,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly source: HelpSource
}) {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const close = useRef<HTMLButtonElement>(null)
  const over = isNarrow(useBand())
  const text = useQuery({
    queryKey: ['help', path],
    queryFn: async () => (await source.textAt(path)) ?? null,
    enabled: open,
    // A text is part of the build: it does not change while a page is open.
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => {
    if (!open) {
      return
    }

    close.current?.focus()

    // The screen stays in use beside the help, so a dialog or a question may
    // stand on it: the key is theirs then, and the help stays.
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        document.querySelector('[role="dialog"], [role="alertdialog"]') === null
      ) {
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

  const markdown = text.data ?? null
  const title = (markdown === null ? null : markdownTitle(markdown)) ?? 'Hilfe'

  return (
    <aside
      aria-label="Hilfe"
      className="fixed inset-x-0 bottom-0 top-14 z-20 flex flex-col gap-3 overflow-y-auto border-line bg-surface px-5 py-[18px] text-ink shadow-[-8px_0_24px_rgb(15_20_27/0.12)] lg:left-auto lg:top-[52px] lg:w-[380px] lg:border-l"
    >
      <div className="flex items-center gap-2">
        <CircleQuestionMark size={18} strokeWidth={2} aria-hidden="true" className="shrink-0" />
        <h2 className="grow text-[16px] font-semibold">{title}</h2>
        <button
          ref={close}
          type="button"
          aria-label="Hilfe schließen"
          onClick={onClose}
          className="flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted cursor-pointer lg:size-8"
        >
          <X size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      {text.isPending ? (
        <p className="text-[13px] text-ink-muted">Wird geladen.</p>
      ) : markdown === null ? (
        <p className="text-[13px] leading-[1.55] text-ink-muted">
          Zu dieser Seite gibt es noch keinen Hilfetext.
        </p>
      ) : (
        <Markdown source={markdown} withoutTitle {...(over ? { onFollow: onClose } : {})} />
      )}

      {source.more && source.more.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {source.more.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={onClose}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink no-underline lg:min-h-8"
            >
              <link.icon size={15} strokeWidth={2} aria-hidden="true" />
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
