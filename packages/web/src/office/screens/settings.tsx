import { Link } from '@tanstack/react-router'

import { useMay } from '../../app/queries.js'
import { Page } from '../layout.js'

interface Entry {
  readonly to: string
  readonly title: string
  readonly about: string
}

/**
 * Everything a business sets for itself, in one place.
 *
 * The settings are screens of their own, each under `/einstellungen`, so that
 * the entry "Einstellungen" in the navigation stays lit on every one of them.
 * This page is the table of contents: what there is, and one sentence on what
 * each is for, so that somebody looking for the signature under their mails
 * does not have to guess that it lives with the mail server.
 *
 * Only what the person may read is listed. The access list is the owner's; a
 * courtesy and not the gate, like the navigation, because the routes behind
 * each screen ask again on every request.
 */
export function SettingsScreen() {
  const readsSettings = useMay('settings.read')
  const administers = useMay('membership.read')

  const entries: readonly Entry[] = [
    ...(readsSettings
      ? [
          {
            to: '/einstellungen/briefkopf',
            title: 'Briefkopf',
            about: 'Name, Anschrift, Bankverbindung und Logo, oben und unten auf jedem Beleg.',
          },
          {
            to: '/einstellungen/steuern',
            title: 'Steuern',
            about: 'Kleinunternehmerregelung, Ist-Versteuerung und der Übergang zur E-Rechnung.',
          },
          {
            to: '/einstellungen/nummernkreise',
            title: 'Nummernkreise',
            about: 'Wie Angebote, Rechnungen und die übrigen Belege nummeriert werden.',
          },
          {
            to: '/einstellungen/zahlungsziel',
            title: 'Zahlungsziel',
            about: 'Wie viele Tage ein Kunde zum Bezahlen hat, vorgegeben für jeden Beleg.',
          },
          {
            to: '/einstellungen/e-mail',
            title: 'E-Mail-Einstellungen',
            about: 'Der Mailserver des Betriebs, die Signatur und was von selbst verschickt wird.',
          },
        ]
      : []),
    ...(administers
      ? [
          {
            to: '/einstellungen/zugaenge',
            title: 'Zugänge',
            about: 'Wer in diesem Betrieb arbeitet, mit welchen Rollen, und die Einladungen.',
          },
        ]
      : []),
  ]

  return (
    <Page title="Einstellungen" meta="Was dieser Betrieb für sich festlegt.">
      <ul className="grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => (
          <li key={entry.to}>
            <Link
              to={entry.to}
              className="flex h-full flex-col gap-1 rounded-control border border-line bg-surface p-4 text-ink hover:border-line-strong"
            >
              <span className="text-body font-semibold">{entry.title}</span>
              <span className="text-table text-ink-muted">{entry.about}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  )
}
