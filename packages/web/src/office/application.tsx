import type { Permission } from '@opengewerk/domain'
import type { InterfaceApplication, OwnTenantLink, SettingsEntry } from '@opengewerk/platform-web'
import {
  CalendarClock,
  Clock,
  Euro,
  File,
  History,
  List,
  Mail,
  Server,
  Shield,
  Signature,
  Tag,
  Users,
} from 'lucide-react'

import { application } from '../app/application.js'

/**
 * The screens a business sets itself up with, in the order of the board
 * "Einstellungen", each with the right it takes to read it: the settings for
 * whoever reads settings, the access list for the owner, the change log for
 * whoever may read it. The right is one of this application's, and the type
 * holds that; the foundation, which draws the list, takes it as a name.
 */
const settings = [
  {
    key: 'briefkopf',
    to: '/einstellungen/briefkopf',
    title: 'Briefkopf',
    about: 'Name, Anschrift, Bankverbindung und Logo, oben und unten auf jedem Beleg.',
    icon: File,
    right: 'settings.read',
  },
  {
    key: 'steuern',
    to: '/einstellungen/steuern',
    title: 'Steuern',
    about: 'Kleinunternehmerregelung, Ist-Versteuerung und der Übergang zur E-Rechnung.',
    icon: Euro,
    right: 'settings.read',
  },
  {
    key: 'nummernkreise',
    to: '/einstellungen/nummernkreise',
    title: 'Nummernkreise',
    about: 'Wie Angebote, Rechnungen und die übrigen Belege nummeriert werden.',
    icon: List,
    right: 'settings.read',
  },
  {
    key: 'zahlungsziel',
    to: '/einstellungen/zahlungsziel',
    title: 'Zahlungsziel',
    about: 'Wie viele Tage ein Kunde zum Bezahlen hat, vorgegeben für jeden Beleg.',
    icon: Clock,
    right: 'settings.read',
  },
  {
    key: 'tags',
    to: '/einstellungen/tags',
    title: 'Tags',
    about: 'Wörter, nach denen Kunden und Objekte geordnet und gefiltert werden.',
    icon: Tag,
    right: 'settings.read',
  },
  {
    key: 'fristen',
    to: '/einstellungen/fristen',
    title: 'Fristen',
    about: 'Wann an Fristen erinnert wird und wer sie bekommt, je Art.',
    icon: CalendarClock,
    right: 'settings.read',
  },
  {
    key: 'belehrungen',
    to: '/einstellungen/belehrungen',
    title: 'Belehrungen',
    about: 'Die Widerrufsbelehrung und eigene Belehrungen, die mit Belegen hinausgehen.',
    icon: Shield,
    right: 'settings.read',
  },
  {
    key: 'regiebericht',
    to: '/einstellungen/regiebericht',
    title: 'Felder des Regieberichts',
    about: 'Was jeder Bericht neben Arbeitszeit und Material festhält, etwa das Wetter.',
    icon: Signature,
    right: 'settings.read',
  },
  {
    key: 'e-mail',
    to: '/einstellungen/e-mail',
    title: 'E-Mail-Einstellungen',
    about: 'Der Mailserver des Betriebs, die Signatur und was von selbst verschickt wird.',
    icon: Mail,
    right: 'settings.read',
  },
  {
    key: 'sicherung',
    to: '/einstellungen/sicherung',
    title: 'Sicherung',
    about: 'Wann die Instanz zuletzt gesichert wurde. Das geschieht jede Nacht von selbst.',
    icon: Server,
    right: 'settings.read',
  },
  {
    key: 'zugaenge',
    to: '/einstellungen/zugaenge',
    title: 'Zugänge',
    about: 'Wer in diesem Betrieb arbeitet, mit welchen Rollen, und die Einladungen.',
    icon: Users,
    right: 'membership.read',
  },
  {
    key: 'protokoll',
    to: '/einstellungen/protokoll',
    title: 'Änderungsprotokoll',
    about: 'Wer wann was geändert hat, Feld für Feld, und ob das Protokoll unverändert ist.',
    icon: History,
    right: 'audit.read',
  },
] as const satisfies readonly (SettingsEntry & { readonly right: Permission })[]

/**
 * A further business for an owner (#142), under the list of businesses in the
 * header: made on the card "Betriebe" under "Konto", behind the right this
 * application has for it.
 */
const ownTenant = {
  right: 'tenant.create',
  to: '/konto',
  hash: 'betriebe',
  label: 'Weiteren Betrieb anlegen',
} as const satisfies OwnTenantLink & { readonly right: Permission }

/**
 * This application as the office hands it to the foundation: what both
 * entries share, and what only the office shows, the settings of a business
 * and the way to a further one (ADR 0010). Kept apart from the shared value
 * so that the site does not load either.
 */
export const officeApplication: InterfaceApplication = { ...application, settings, ownTenant }
