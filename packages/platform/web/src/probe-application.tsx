import { syncRules } from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { Archive, KeyRound, StickyNote } from 'lucide-react'
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
    tenantNameProblem: (name) =>
      name.trim() === ''
        ? 'Ein Mandant braucht einen Namen.'
        : name.trim().length > 40
          ? 'Mehr als vierzig Zeichen hat kein Mandant.'
          : null,

    // One for whoever reads notes, one for whoever leads, one for everybody.
    settings: [
      {
        key: 'regale',
        to: '/einstellungen/regale',
        title: 'Regale',
        about: 'Wie die Regale eines Mandanten heißen.',
        icon: Archive,
        right: 'shelf.settings',
      },
      {
        key: 'zugaenge',
        to: '/einstellungen/zugaenge',
        title: 'Zugänge',
        about: 'Wer in diesem Mandanten arbeitet.',
        icon: KeyRound,
        right: 'membership.read',
      },
      {
        key: 'notizen',
        to: '/einstellungen/notizen',
        title: 'Notizen',
        about: 'Was eine Notiz festhält.',
        icon: StickyNote,
      },
    ],

    // For whoever may make a tenant of their own, a right no application has.
    ownTenant: {
      right: 'tenant.own',
      to: '/konto',
      hash: 'mandanten',
      label: 'Eigenen Mandanten anlegen',
    },

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
      tenants: {
        switch: 'Mandant wechseln',
      },
      settings: {
        whose: 'Dieser Mandant',
        what: 'Was dieser Mandant für sich festlegt.',
        belongsToTheAccount: 'Das Passwort gehört nicht dem Mandanten, sondern dem Konto.',
      },
      account: {
        themeElsewhere: 'Unterwegs lässt sich etwas anderes wählen.',
        secondFactorFor: 'Für die Leitung ist er Pflicht.',
      },
      entry: {
        name: { office: 'Schreibtisch', site: 'Unterwegs' },
        suits: {
          office: 'Das sieht nach einem Schreibtisch aus.',
          site: 'Das sieht nach einem Gerät für unterwegs aus.',
        },
        goTo: {
          office: 'Zum Schreibtisch',
          site: 'Zur Ansicht für unterwegs',
        },
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
      // Whoever runs the instance is its "Aufsicht" here, and whoever leads a
      // tenant its "Leitung": words neither application uses for either.
      staff: {
        what: 'Wer im Mandanten mitarbeitet.',
        accounts: 'Konten des Mandanten',
        noMail: 'Einladungen per E-Mail gibt es im Probewerk erst mit einem Mailserver.',
        mailedLinkUnseen: 'am Schreibtisch des Mandanten sieht ihn keiner.',
        noDevices: 'Im Mandanten ist gerade kein Gerät dieser Person angemeldet.',
        devicesOf: (name) => `Wo ${name} im Mandanten angemeldet ist`,
      },
      instance: {
        what: 'Was alle Mandanten dieser Instanz teilen.',
        shut: 'Hierher kommt nur die Aufsicht der Instanz.',
        notAsked: 'Ob du zur Aufsicht gehörst, ließ sich nicht klären.',
        secondFactor: 'Die Aufsicht braucht hier einen zweiten Faktor, wie die Leitung',
        back: 'Zurück zum Schreibtisch',
        tenants: {
          title: 'Mandanten',
          what: 'Alle Mandanten dieser Instanz, jeder für sich.',
          create: 'Mandant anlegen',
          caption: 'Die Mandanten dieser Instanz',
          note: 'Vom Inhalt eines Mandanten sieht die Aufsicht nichts.',
          tenantColumn: 'Mandant',
          leadsColumn: 'Leitung',
          nameLabel: 'Name des Mandanten',
          leadNameLabel: 'Name der Leitung',
          leadNameMissing: 'Die Leitung braucht einen Namen.',
          leadEmailLabel: 'Adresse der Leitung',
          leadEmailHint: 'Wer den Link öffnet, leitet den Mandanten.',
          forOneself: 'Einen eigenen Mandanten gibt es unter „Konto“.',
          notCreated: 'Der Mandant kam nicht zustande.',
          linkMakes: 'wer ihn öffnet, leitet den neuen Mandanten.',
        },
        operators: {
          title: 'Aufsicht',
          caption: 'Die Aufsicht dieser Instanz',
          column: 'Person',
          whoStays: 'Die letzte Aufsicht bleibt.',
          remove: (name) => `${name} aus der Aufsicht nehmen`,
          whatStays: 'Das Konto und seine Mandanten bleiben.',
          notRemoved: 'Aus der Aufsicht nehmen ging nicht.',
          appoint: 'Zur Aufsicht machen',
          appointing: 'Zur Aufsicht wird ein Konto, das es auf dieser Instanz schon gibt.',
          exampleAddress: 'name@probe.example',
          appointed: (name) => `${name} gehört jetzt zur Aufsicht.`,
        },
        settings: {
          what: 'Was für alle Mandanten gilt.',
          mailOwnServer: 'Ein Mandant schickt Mails über seinen Mailserver.',
          mailNoWayIn: 'So kommt kein Mandant in das Netz dahinter.',
        },
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
