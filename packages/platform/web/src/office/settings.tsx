import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { Check, ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { useApplication } from '../application.js'
import type { SettingsEntry } from '../application.js'
import { PanelLabel } from '../components/panel.js'
import { useRights } from '../session/queries.js'
import { NoteBox, PageHead, Screen } from './kit.js'

/**
 * The screens a tenant sets itself up with, in the order the application
 * lists them (ADR 0010): which there are is the application's to say, and
 * with each the right it takes to read it.
 *
 * Only what the person may read is listed. A courtesy and not the gate, like
 * the navigation, because the routes behind each screen ask again on every
 * request.
 */
export function useSettingsEntries(): readonly SettingsEntry[] {
  const { settings } = useApplication()
  const rights = useRights()

  return settings.filter((entry) => entry.right === undefined || rights.includes(entry.right))
}

/**
 * The list at the left of every settings screen, `subnav()` of the canvas:
 * 196 pixels, the screen one is on raised like a card. Over it stands whose
 * settings these are, in the words of the application.
 */
function SettingsNavigation({ active }: { readonly active: string }) {
  const entries = useSettingsEntries()
  const { settings: sentences } = useApplication().sentences

  return (
    <nav
      aria-label="Einstellungen"
      className="flex w-[196px] shrink-0 flex-col gap-0.5 max-lg:hidden"
    >
      <div className="px-2.5 pt-0.5 pb-1.5">
        <PanelLabel>{sentences.whose}</PanelLabel>
      </div>
      {entries.map((entry) => (
        <Link
          key={entry.key}
          to={entry.to}
          aria-current={entry.key === active ? 'page' : undefined}
          className={clsx(
            'block rounded-control border px-2.5 py-[7px] text-[14px] no-underline',
            entry.key === active
              ? 'border-line bg-surface font-semibold text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {entry.title}
        </Link>
      ))}
    </nav>
  )
}

/**
 * The frame of a settings screen, `settings_page()` of the canvas: the head,
 * and beside the list of the other settings the cards of this one, 12 pixels
 * apart. Below 1024 pixels the list gives way to the way back to "Einstellungen",
 * which lists the same screens as tiles.
 */
export function SettingsPage({
  active,
  title,
  sub,
  actions,
  children,
}: {
  /** The key of the screen among the settings the application lists. */
  readonly active: string
  readonly title: string
  readonly sub: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Screen className="lg:gap-4">
      <Link
        to="/einstellungen"
        className="inline-flex min-h-10 items-center gap-1 self-start text-[15px] text-copper-text underline underline-offset-2 lg:hidden"
      >
        <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
        Einstellungen
      </Link>
      <PageHead title={title} sub={sub} wideActions {...(actions ? { actions } : {})} />
      <div className="flex min-w-0 items-start gap-[18px]">
        <SettingsNavigation active={active} />
        <div className="flex min-w-0 grow flex-col gap-3">{children}</div>
      </div>
    </Screen>
  )
}

/**
 * Everything a tenant sets for itself, in one place, as the board
 * "Einstellungen" lays it out: a tile for each screen with a symbol, its name
 * and one sentence on what it is for, so that somebody looking for a setting
 * does not have to guess which screen it lives on.
 *
 * The settings are screens of their own, each under `/einstellungen`, so that
 * the entry "Einstellungen" in the navigation stays lit on every one of them.
 * What belongs to a person and not to the tenant, light or dark, the password
 * and the second factor, is under the account, and the note at the foot says
 * where: that it is not the tenant's in the words of the application, and
 * where the menu is in the foundation's, which draws the header.
 */
export function SettingsScreen() {
  const entries = useSettingsEntries()
  const { settings: sentences } = useApplication().sentences

  return (
    <Screen className="lg:gap-4">
      <PageHead title="Einstellungen" sub={sentences.what} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => {
          const Icon = entry.icon

          return (
            <li key={entry.to}>
              <Link
                to={entry.to}
                className="flex h-full items-start gap-3 rounded-[5px] border border-line bg-surface p-4 text-ink no-underline hover:border-line-strong"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-[5px] bg-surface-sunken text-ink-muted"
                >
                  <Icon size={18} strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{entry.title}</span>
                  <span className="mt-[3px] block text-[13px] leading-[1.45] text-ink-muted">
                    {entry.about}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <NoteBox>
        {sentences.belongsToTheAccount} Sie stehen im Menü unter dem Namen oben rechts.
      </NoteBox>
    </Screen>
  )
}

/** A sentence of a settings card, at the size the boards set them: 14, or 13 and muted. */
export function SettingsText({
  muted = false,
  small = false,
  children,
}: {
  readonly muted?: boolean
  readonly small?: boolean
  readonly children: ReactNode
}) {
  return (
    <p
      className={clsx(
        'leading-[1.5]',
        small || muted ? 'text-[13px]' : 'text-[14px]',
        muted ? 'text-ink-muted' : 'text-ink',
      )}
    >
      {children}
    </p>
  )
}

/** "Gespeichert." in the green of what is done, `saved()` of the canvas. */
export function Saved({ children = 'Gespeichert.' }: { readonly children?: string }) {
  return (
    <p role="status" className="inline-flex items-center gap-[5px] text-[13px] text-done">
      <Check size={14} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
      {children}
    </p>
  )
}

/** Where a setting stands now, in bold, as `bold()` of the canvas. */
export function SettingsState({ children }: { readonly children: ReactNode }) {
  return <p className="text-[14px] leading-[1.45] font-semibold text-ink">{children}</p>
}

/** What was set before, `history()` of the canvas: "Verlauf" and a list. */
export function SettingsHistory({ items }: { readonly items: readonly string[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <div>
      <p className="mb-[3px] text-[13px] font-semibold text-ink">Verlauf</p>
      <ul className="list-disc pl-[18px] text-[13px] leading-[1.5] text-ink-muted">
        {items.map((item) => (
          <li key={item} className="py-0.5">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
