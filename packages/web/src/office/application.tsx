import type { Permission } from '@opengewerk/domain'
import type {
  AuditSentences,
  InstanceAreaSentences,
  InterfaceApplication,
  OwnTenantLink,
  SettingsEntry,
  StaffSentences,
} from '@opengewerk/platform-web'
import { auditLogPath } from '@opengewerk/platform-web/office'
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
import { auditScreenWords } from './audit.js'

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
    to: auditLogPath,
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
 * What "Zugänge" says in the words of this application: its word for a
 * business, where the mail server is set up, and the names of its entries.
 * The sentences the screen showed before it moved into the foundation, word
 * for word.
 */
const staff = {
  what: 'Wer in diesem Betrieb arbeitet, und womit.',
  accounts: 'Konten dieses Betriebs',
  noMail:
    'Per E-Mail einladen geht, sobald unter "E-Mail-Einstellungen" ein Mailserver eingerichtet ist.',
  mailedLinkUnseen: 'im Büro sieht ihn niemand.',
  noDevices: 'In diesem Betrieb ist gerade kein Gerät angemeldet.',
  devicesOf: (name) => `Geräte, auf denen ${name} in diesem Betrieb angemeldet ist`,
} as const satisfies StaffSentences

/**
 * What the area of the instance says in the words of this application (#188):
 * a business and its owner, and the operator for whoever runs the instance,
 * which is the word the next application has for a tenant. Word for word what
 * the screens said before they moved into the foundation.
 */
const instance = {
  what: 'Was allen Betrieben auf dieser Instanz gemeinsam ist.',
  shut: 'Diesen Bereich erreicht nur, wer die Instanz betreibt.',
  notAsked: 'Ob du diese Instanz betreibst, ließ sich gerade nicht erfragen.',
  secondFactor: 'Für diesen Bereich ist ein zweiter Faktor Pflicht, wie für die Rolle Inhaber',
  back: 'Zurück zum Büro',
  tenants: {
    title: 'Betriebe',
    what: 'Die Betriebe auf dieser Instanz. Jeder ist vom anderen getrennt wie zwei fremde.',
    create: 'Betrieb anlegen',
    caption: 'Die Betriebe auf dieser Instanz',
    note: 'Was in einem Betrieb steht, sieht hier niemand, auch wer die Instanz betreibt nicht: nur sein Name, der Tag der Anlage und wer darin Inhaber ist.',
    tenantColumn: 'Betrieb',
    leadsColumn: 'Inhaber',
    nameLabel: 'Name des Betriebs',
    leadNameLabel: 'Name des Inhabers',
    leadNameMissing: 'Der Name des Inhabers fehlt.',
    leadEmailLabel: 'E-Mail des Inhabers',
    leadEmailHint:
      'Der Link macht die Person zum Inhaber. Hat sie schon ein Konto auf dieser Instanz, meldet sie sich damit an.',
    forOneself:
      'Einen Betrieb für dich selbst legst du unter „Konto“ an, dort bist du gleich Inhaber.',
    notCreated: 'Der Betrieb ließ sich nicht anlegen.',
    linkMakes: 'wer ihn öffnet, wird Inhaber des neuen Betriebs.',
  },
  operators: {
    title: 'Betreiber',
    caption: 'Die Betreiber dieser Instanz',
    column: 'Betreiber',
    whoStays: 'Sich selbst und den letzten Betreiber entfernt niemand.',
    remove: (name) => `${name} als Betreiber entfernen`,
    whatStays:
      'Das Konto bleibt, ebenso seine Zugänge zu Betrieben; nur dieser Bereich ist danach zu.',
    notRemoved: 'Der Betreiber ließ sich nicht entfernen.',
    appoint: 'Betreiber benennen',
    appointing:
      'Betreiber wird ein Konto, das es auf dieser Instanz schon gibt. Es verwaltet dann, was allen Betrieben gemeinsam ist, und sieht die Liste der Betriebe, aber nichts, was in einem steht.',
    exampleAddress: 'name@betrieb.de',
    appointed: (name) => `${name} ist jetzt Betreiber.`,
  },
  settings: {
    what: 'Was für alle Betriebe auf dieser Instanz gilt.',
    mailOwnServer: 'Ein Betrieb verschickt seine E-Mails über seinen eigenen Mailserver.',
    mailNoWayIn: 'So greift kein Betrieb über die Instanz in das Netz dahinter.',
  },
  log: {
    what: 'Jede Änderung an der Instanz. Was in einem Betrieb geändert wird, steht in dessen Änderungsprotokoll.',
    aTenant: 'Ein Betrieb',
    operatorAppointed: 'Betreiber benannt',
    operatorRemoved: 'Betreiber entfernt',
    tenantCreated: 'Betrieb angelegt',
    tenantRemoved: 'Betrieb entfernt',
  },
} as const satisfies InstanceAreaSentences

/**
 * What the change log of a business says in the words of this application
 * (#285): what it holds and who reads it. Word for word what the screen said
 * before it moved into the foundation.
 */
const audit = {
  what: 'Jede Änderung im Betrieb, Feld für Feld: wer, wann, auf welchem Gerät und auf welchem Weg.',
  onlyFor: 'Das Änderungsprotokoll sieht nur der Inhaber.',
} as const satisfies AuditSentences

/**
 * This application as the office hands it to the foundation: what both
 * entries share, and what only the office shows, the settings of a business,
 * the way to a further one, the words of the change log, and what "Zugänge",
 * the area of the instance and the change log say (ADR 0010). Kept apart from
 * the shared value so that the site does not load any of it.
 */
export const officeApplication: InterfaceApplication = {
  ...application,
  settings,
  ownTenant,
  audit: auditScreenWords,
  sentences: { ...application.sentences, staff, instance, audit },
}
