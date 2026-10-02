import { syncRules } from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import type { ReactNode } from 'react'

import { ApplicationProvider } from './application.js'
import type { InterfaceApplication } from './application.js'
import { SyncClient } from './sync/client.js'
import { directWrite, httpTransport } from './sync/transport.js'

/**
 * An application that belongs to nobody, for the tests of the foundation's
 * screens.
 *
 * A test that ran green with the name and the sentences of a real application
 * would not show that a screen here has none of its own: the word it expects
 * could as well be written into the screen. So this one is called something
 * no application is called, calls a tenant what no application calls one, and
 * every sentence of it is found nowhere else. A screen that shows one of them
 * took it from the value over it.
 *
 * Its records are those of `probePolicies`, the ones the tests of the sync
 * client use as well.
 */
export const probeRules = syncRules(probePolicies)

export function probeApplication(over: Partial<InterfaceApplication> = {}): InterfaceApplication {
  return {
    name: 'Probewerk',
    claim: 'Regale, Notizen und Pakete an einem Ort.',
    hosting: 'Diese Instanz läuft nur in Tests und gehört niemandem.',
    licence: 'Probelizenz 1.0',
    tenantNameMaxLength: 40,

    sentences: {
      signIn: {
        resetSent:
          'Gibt es zu dieser Adresse einen Zugang, ist ein Link zu einem neuen Passwort unterwegs.',
        resetHelp: 'Kommt keiner an, hilft die Leitung des Mandanten.',
        secondFactor: 'Für die Leitung ist der zweite Faktor Pflicht.',
      },
      secondFactor: {
        required: 'Wer einen Mandanten leitet, braucht einen zweiten Faktor.',
        newCodes: 'Neue Codes gibt es im Probewerk unter "Konto".',
      },
      tenantChoice: {
        title: 'Mandant wählen',
        noneTitle: 'Kein Mandant',
        none: 'Dieses Konto gehört zu keinem Mandanten.',
        notChosen: 'Der Mandant ließ sich nicht auswählen.',
        loading: 'Die Mandanten werden geladen.',
        notLoaded: 'Die Liste der Mandanten kam nicht an.',
      },
      setup: {
        whatIsMade: 'Hier entstehen der erste Mandant und das erste Konto.',
        whereTheCodeIs: 'Steht in der Probe auf einem Zettel.',
        tenantLabel: 'Mandant',
        tenantHint: 'So wie der Mandant heißen soll.',
        create: 'Mandant anlegen',
      },
      invitation: {
        spent: {
          redeemed: 'Er wurde schon benutzt. Der Mandant weiß mehr.',
          revoked: 'Der Mandant hat ihn zurückgezogen.',
          expired: 'Er ist abgelaufen. Der Mandant erzeugt einen neuen.',
        },
        tenantIsAdded: 'Ihr Passwort bleibt, der Mandant kommt dazu.',
        join: 'Mandant übernehmen',
        newAccount: (name, email) => (
          <>
            Ein Mandant hat für {name} einen Zugang mit der Adresse {email} angelegt.
          </>
        ),
      },
    },

    startSync: ({ store, deviceId, onSignedOut }) =>
      SyncClient.start({
        store,
        transport: httpTransport,
        writer: directWrite,
        rules: probeRules,
        deviceId,
        entities: ['shelves', 'notes'],
        onSignedOut,
      }),

    ...over,
  }
}

/** A screen of the foundation inside the application that belongs to nobody. */
export function InProbe({
  application,
  children,
}: {
  /** One with something changed about it, for a test of exactly that. */
  readonly application?: InterfaceApplication | undefined
  readonly children: ReactNode
}) {
  return <ApplicationProvider application={application ?? standing}>{children}</ApplicationProvider>
}

// One value for every screen that asks for none of its own: an application is
// one value for as long as a page is open, and the gate starts its sync client
// again when it is handed another.
const standing = probeApplication()
