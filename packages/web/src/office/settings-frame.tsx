import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import {
  Check,
  ChevronLeft,
  Clock,
  Euro,
  File,
  List,
  Mail,
  Server,
  Shield,
  Signature,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { PanelLabel } from '../components/index.js'
import { useMay } from '../app/queries.js'
import { PageHead, Screen } from './kit.js'

/** One screen of "Einstellungen": where it is, what it is called, what it is for. */
export interface SettingsEntry {
  readonly key: string
  readonly to: string
  readonly title: string
  readonly about: string
  readonly icon: LucideIcon
}

/**
 * The screens a business sets itself up with, in the order of the board
 * "Einstellungen". Only what the person may read is listed. The access list is
 * the owner's; a courtesy and not the gate, like the navigation, because the
 * routes behind each screen ask again on every request.
 */
export function useSettingsEntries(): readonly SettingsEntry[] {
  const readsSettings = useMay('settings.read')
  const administers = useMay('membership.read')

  return [
    ...(readsSettings
      ? [
          {
            key: 'briefkopf',
            to: '/einstellungen/briefkopf',
            title: 'Briefkopf',
            about: 'Name, Anschrift, Bankverbindung und Logo, oben und unten auf jedem Beleg.',
            icon: File,
          },
          {
            key: 'steuern',
            to: '/einstellungen/steuern',
            title: 'Steuern',
            about: 'Kleinunternehmerregelung, Ist-Versteuerung und der Übergang zur E-Rechnung.',
            icon: Euro,
          },
          {
            key: 'nummernkreise',
            to: '/einstellungen/nummernkreise',
            title: 'Nummernkreise',
            about: 'Wie Angebote, Rechnungen und die übrigen Belege nummeriert werden.',
            icon: List,
          },
          {
            key: 'zahlungsziel',
            to: '/einstellungen/zahlungsziel',
            title: 'Zahlungsziel',
            about: 'Wie viele Tage ein Kunde zum Bezahlen hat, vorgegeben für jeden Beleg.',
            icon: Clock,
          },
          {
            key: 'belehrungen',
            to: '/einstellungen/belehrungen',
            title: 'Belehrungen',
            about: 'Die Widerrufsbelehrung und eigene Belehrungen, die mit Belegen hinausgehen.',
            icon: Shield,
          },
          {
            key: 'regiebericht',
            to: '/einstellungen/regiebericht',
            title: 'Felder des Regieberichts',
            about: 'Was jeder Bericht neben Arbeitszeit und Material festhält, etwa das Wetter.',
            icon: Signature,
          },
          {
            key: 'e-mail',
            to: '/einstellungen/e-mail',
            title: 'E-Mail-Einstellungen',
            about: 'Der Mailserver des Betriebs, die Signatur und was von selbst verschickt wird.',
            icon: Mail,
          },
          {
            key: 'sicherung',
            to: '/einstellungen/sicherung',
            title: 'Sicherung',
            about: 'Wann die Instanz zuletzt gesichert wurde. Das geschieht jede Nacht von selbst.',
            icon: Server,
          },
        ]
      : []),
    ...(administers
      ? [
          {
            key: 'zugaenge',
            to: '/einstellungen/zugaenge',
            title: 'Zugänge',
            about: 'Wer in diesem Betrieb arbeitet, mit welchen Rollen, und die Einladungen.',
            icon: Users,
          },
        ]
      : []),
  ]
}

/**
 * "Dieser Betrieb", the list at the left of every settings screen, `subnav()`
 * of the canvas: 196 pixels, the screen one is on raised like a card.
 */
function SettingsNavigation({ active }: { readonly active: string }) {
  const entries = useSettingsEntries()

  return (
    <nav
      aria-label="Einstellungen"
      className="flex w-[196px] shrink-0 flex-col gap-0.5 max-lg:hidden"
    >
      <div className="px-2.5 pt-0.5 pb-1.5">
        <PanelLabel>Dieser Betrieb</PanelLabel>
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
  /** The key of the screen in `useSettingsEntries`. */
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
