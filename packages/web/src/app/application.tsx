import { businessNameMaxLength, labelCodeFromScan, syncEntities } from '@opengewerk/domain'
import type { InterfaceApplication } from '@opengewerk/platform-web'
import { directWrite, httpTransport } from '@opengewerk/platform-web/sync'
import { ScanLine } from 'lucide-react'

import { SyncClient } from '../sync/client.js'
import { siteTransport } from '../sync/transport.js'
import { leavePush } from './push.js'

/**
 * Over the sign in after the camera of a phone opened the address of a QR
 * label (#308): what comes once signed in. Read from the address of the page,
 * which the router behind the gate keeps and opens next.
 */
function ScannedLabelNote() {
  if (labelCodeFromScan(globalThis.location.href) === null) {
    return null
  }

  return (
    <div
      role="note"
      className="flex max-w-[560px] items-start gap-2.5 rounded-[6px] border border-line bg-surface px-3.5 py-3 text-[15px] leading-[1.45]"
    >
      <ScanLine
        size={18}
        strokeWidth={2.2}
        aria-hidden="true"
        className="mt-px shrink-0 text-ink-muted"
      />
      <span>Du hast das Etikett einer Anlage gescannt. Nach der Anmeldung öffnet sie sich.</span>
    </div>
  )
}

/**
 * What this application says and does where a screen of the foundation needs
 * it (ADR 0010): what it is called, what it says of itself beside the gate,
 * every sentence of the foundation's screens that names a business, its
 * owner or one of the two entries, how its sync client starts, and what it
 * does around a sign in and a sign out.
 *
 * The one place for all of it. The foundation names no product and has no
 * word for a business; it asks this value, which `Root` puts over an entry.
 * The sentences are the ones the gate has always shown, word for word: they
 * stood in the screens themselves until the screens moved.
 *
 * This is what both entries share, and the site hands it in as it is. The
 * office adds what only it shows, the settings of a business
 * (`office/application.tsx`): a phone on site does not load a list of screens
 * it never draws.
 */
export const application: InterfaceApplication = {
  name: 'OpenGewerk',
  claim: 'Kunde, Objekt, Anlage, Auftrag, Beleg. Ein Datenmodell statt sechs Programme.',
  hosting:
    'Diese Instanz läuft auf Ihrem eigenen Server. Die Daten verlassen ihn nicht, und niemand außer Ihnen kann sie abschalten.',
  licence: 'AGPL-3.0',
  tenantNameMaxLength: businessNameMaxLength,
  // The office has them and hands them in itself; see above.
  settings: [],

  sentences: {
    signIn: {
      resetSent:
        'Wenn es zu dieser Adresse einen Zugang gibt und ein Betrieb, in dem er arbeitet, E-Mails verschickt, ist ein Link zu einem neuen Passwort unterwegs.',
      resetHelp: 'Kommt keiner an, hilft der Inhaber des Betriebs weiter.',
      secondFactor:
        'Für die Rolle Inhaber ist der zweite Faktor Pflicht, für alle anderen empfohlen.',
    },
    secondFactor: {
      required: 'Für die Rolle Inhaber ist ein zweiter Faktor Pflicht.',
      newCodes:
        'Unter "Konto" im Büro lassen sich neue erzeugen und der zweite Faktor auf einem neuen Telefon einrichten.',
    },
    tenantChoice: {
      title: 'Betrieb wählen',
      noneTitle: 'Kein Betrieb',
      none: 'Dieses Konto gehört zu keinem Betrieb. Wer die Instanz betreibt, legt die Zugehörigkeit an.',
      notChosen: 'Der Betrieb ließ sich nicht auswählen.',
      loading: 'Die Betriebe werden geladen.',
      notLoaded: 'Die Liste der Betriebe kam nicht an.',
    },
    setup: {
      whatIsMade: 'Hier entstehen der Betrieb und das erste Konto.',
      // Where `docker/setup.sh` writes it on the first start (#215).
      whereTheCodeIs: 'Steht auf dem Server in der Datei docker/.env.',
      tenantLabel: 'Betrieb',
      tenantHint: 'So wie der Betrieb auf einer Rechnung steht.',
      create: 'Betrieb anlegen',
    },
    tenants: {
      switch: 'Betrieb wechseln',
    },
    settings: {
      whose: 'Dieser Betrieb',
      what: 'Was dieser Betrieb für sich festlegt.',
      belongsToTheAccount:
        'Hell oder dunkel, Passwort und zweiter Faktor gehören nicht dem Betrieb, sondern dem Konto.',
    },
    account: {
      themeElsewhere: 'Auf dem Tablet im Keller lässt sich unabhängig davon dunkel wählen.',
      secondFactorFor: 'Für die Rolle Inhaber ist er Pflicht, für alle anderen empfohlen.',
    },
    entry: {
      name: { office: 'Büro', site: 'Baustelle' },
      suits: {
        office: 'Das sieht nach einem Arbeitsplatz aus. Im Büro ist mehr zu sehen.',
        site: 'Das sieht nach einem Gerät für die Baustelle aus.',
      },
      goTo: {
        office: 'Zur Büroansicht',
        site: 'Zur Baustellenansicht',
      },
    },
    invitation: {
      spent: {
        redeemed:
          'Er wurde schon benutzt. Wenn das nicht Sie waren, sagen Sie dem Betrieb bitte Bescheid.',
        revoked: 'Der Betrieb hat ihn zurückgezogen. Bitte dort nachfragen.',
        expired: 'Er ist abgelaufen. Der Betrieb kann einen neuen erzeugen.',
      },
      tenantIsAdded: 'Sie behalten Ihr Passwort; der Betrieb kommt einfach dazu.',
      join: 'Betrieb übernehmen',
      newAccount: (name, email) => (
        <>
          Der Betrieb hat einen Zugang für {name} angelegt, mit der Adresse {email}. Fehlt nur noch
          ein Passwort, und das wählen Sie selbst: niemand im Betrieb bekommt es zu sehen.
        </>
      ),
    },
  },

  /**
   * The sync client of this application, as `sync/client.ts` binds it: with
   * the rules made from its policies and with every kind of record it has.
   * The site asks the server for one thing the office never asks for (#286),
   * so the way to the server goes by the entry.
   */
  startSync: ({ store, deviceId, entry, onSignedOut }) =>
    SyncClient.start({
      store,
      transport: entry === 'site' ? siteTransport() : httpTransport,
      writer: directWrite,
      deviceId,
      entities: syncEntities,
      onSignedOut,
    }),

  beforeSignIn: <ScannedLabelNote />,

  // Push goes while there is a session to take this device's row off with
  // (#284).
  beforeSignOut: leavePush,
}
