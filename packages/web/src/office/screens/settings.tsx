import { Link } from '@tanstack/react-router'

import { NoteBox, PageHead, Screen } from '../kit.js'
import { useSettingsEntries } from '../settings-frame.js'

/**
 * Everything a business sets for itself, in one place, as the board
 * "Einstellungen" lays it out: a tile for each screen with a symbol, its name
 * and one sentence on what it is for, so that somebody looking for the
 * signature under their mails does not have to guess that it lives with the
 * mail server.
 *
 * The settings are screens of their own, each under `/einstellungen`, so that
 * the entry "Einstellungen" in the navigation stays lit on every one of them.
 * What belongs to a person and not to the business, light or dark, the
 * password and the second factor, is under "Konto", and the note at the foot
 * says where.
 */
export function SettingsScreen() {
  const entries = useSettingsEntries()

  return (
    <Screen className="lg:gap-4">
      <PageHead title="Einstellungen" sub="Was dieser Betrieb für sich festlegt." />
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
        Hell oder dunkel, Passwort und zweiter Faktor gehören nicht dem Betrieb, sondern dem Konto.
        Sie stehen im Menü unter dem Namen oben rechts.
      </NoteBox>
    </Screen>
  )
}
