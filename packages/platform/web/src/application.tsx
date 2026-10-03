import type { RecordState, SyncConflict, SyncValue } from '@opengewerk/platform-domain'
import type { LucideIcon } from 'lucide-react'
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import type { Entry } from './components/surface.js'
import type { AuditScreenWords } from './office/audit-words.js'
import type { InvitationState } from './session/session.js'
import type { SyncClient } from './sync/client.js'
import type { LocalStore } from './sync/store.js'

/**
 * What an application says and does where a screen of the foundation needs it
 * (ADR 0010).
 *
 * The foundation shows everything that comes before an application's first
 * screen of its own: the gate, the sign in, the first run, the choice of a
 * tenant. None of that may name a product, say what a tenant is called there
 * or who leads one, or know which records a device holds. An application
 * hands all of it in once, as one value over its whole tree, and every screen
 * here asks that value.
 *
 * One value and one place, on purpose. A register that applications enter
 * themselves into would let two of them meet in one page, and an argument at
 * each screen would have to be threaded through every screen between.
 */
export interface InterfaceApplication {
  /** What it is called, wherever a person reads its name. */
  readonly name: string
  /** What it is, in one sentence, beside the gate at a desk. */
  readonly claim: string
  /** Where this instance runs and whose it is, under the claim. */
  readonly hosting: string
  /** The licence it is under, at the foot of the gate. */
  readonly licence: string
  /** How long the name of a tenant may be, as the server takes it. */
  readonly tenantNameMaxLength: number
  /**
   * What is wrong with a name for a tenant, in the words the server refuses
   * it with, or null when nothing is: so that a form refuses before it sends.
   */
  readonly tenantNameProblem: (name: string) => string | null
  readonly sentences: InterfaceSentences
  /**
   * The screens a tenant sets itself up with, in the order they are listed:
   * beside every one of them at a desk, and as tiles on the overview.
   */
  readonly settings: readonly SettingsEntry[]
  /**
   * The way to a further tenant of one's own, where the application lets
   * somebody make one: under the list of tenants in the header, for whoever
   * holds the right.
   */
  readonly ownTenant?: OwnTenantLink
  /**
   * What the change log says about the values in the application's tables and
   * where its records are opened, around the vocabulary its server is told as
   * well. Only the office shows the log, so only the value of the office
   * carries it, and an entry that never draws the log does not load its words.
   */
  readonly audit?: AuditScreenWords
  /**
   * Starts the sync client of the application for the tenant whose store this
   * is: with the rules made from its policies, the kinds of record it has a
   * screen for, and the way to the server its entry takes.
   */
  readonly startSync: (start: DeviceStart) => Promise<SyncClient>
  /**
   * What the application calls its records and their fields, how it writes
   * their values, and what it offers where taking a version cannot settle a
   * conflict: all the screen of the conflicts says about a record.
   */
  readonly records: RecordWords
  /**
   * A line over the card of the sign in, when the application has something
   * to say about the address the page was opened at, as after the scan of a
   * label: what happens once somebody is signed in.
   */
  readonly beforeSignIn?: ReactNode
  /**
   * What the application ends for this device while there is still a session
   * to end it with. Given a few seconds and never in the way: whatever it
   * does or fails to do, the sign out goes on.
   */
  readonly beforeSignOut?: () => Promise<unknown>
}

/** One screen of the settings: where it is, what it is called, what it is for. */
export interface SettingsEntry {
  /** What a screen names itself with, to be the one that is lit. */
  readonly key: string
  readonly to: string
  readonly title: string
  /** One sentence on the overview: what is set there. */
  readonly about: string
  readonly icon: LucideIcon
  /**
   * The right it takes to read the screen. Whoever lacks it is not shown the
   * entry; an entry without one is shown to everybody. A name out of the
   * catalogue of the application: to the foundation a right is a string.
   */
  readonly right?: string
}

/**
 * Where a further tenant of one's own is made. Whether somebody may make one
 * for themselves, and behind which right, is the application's to decide: the
 * route is its own, and so is the screen the link leads to.
 */
export interface OwnTenantLink {
  /** The right it takes. Whoever lacks it is not offered the way. */
  readonly right: string
  readonly to: string
  /** The place on that screen, where it is one card among several. */
  readonly hash?: string
  /** What the link says, with the application's word for a tenant. */
  readonly label: string
}

/** What the gate hands an application to start its sync client with. */
export interface DeviceStart {
  /** The store of the tenant on this device, opened. */
  readonly store: LocalStore
  readonly deviceId: string
  /** Which entry the page is. An application may ask the server differently from each. */
  readonly entry: Entry
  /** For the client to call when the server answers it as not signed in. */
  readonly onSignedOut: () => void
}

/**
 * What the screens of the foundation say about a record of the application,
 * which they know only by the name of its kind and its fields.
 *
 * Each of the first three falls back to the raw name where the application
 * knows none. A conflict can come from a newer server about a field this
 * build has never heard of, and its name beside two values is better than an
 * empty cell; it is also visibly a gap.
 */
export interface RecordWords {
  /** What a kind of record is called, in a sentence and over a card. */
  readonly entityLabel: (entity: string) => string
  /** What a field is called, at the head of its row. */
  readonly fieldLabel: (field: string) => string
  /** The name a record goes by on a screen, or what it is when it has none. */
  readonly titleOf: (entity: string, record: RecordState | null) => string
  /**
   * A value the way the screens of the application write it, a price kept in
   * cents with its currency, or null where it is written as it is.
   */
  readonly valueText: (field: string, value: SyncValue) => string | null
  /**
   * Kinds of record whose conflict no choice of a version settles, with the
   * sentence that says what to do instead. The card offers only to close it.
   */
  readonly settledElsewhere: Readonly<Record<string, string>>
  /** Another way out of a conflict, where the application has one. */
  readonly otherWay?: ConflictWay
}

/**
 * A way out of a conflict besides the two versions, where the application has
 * one: a record that can no longer be changed, written anew instead.
 *
 * It takes every conflict of the same group at once, so that what a device
 * wrote about one record is not split over several new ones. The card shows
 * the fields it chooses, says what the way does and offers it in place of
 * the version of the device, and the list says what came of it.
 */
export interface ConflictWay {
  /** The group a conflict belongs to when the way is open for it, or null. */
  readonly groupOf: (client: SyncClient, conflict: SyncConflict) => string | null
  /** Which fields of what the device wanted are shown, and in which order. */
  readonly fields: (wanted: Readonly<Record<string, SyncValue>>) => readonly string[]
  /** What the card says about the way, under the fields. */
  readonly explanation: string
  /** What the button says. */
  readonly action: string
  /**
   * Takes the way for every conflict of the group, through the outbox like
   * any change, and says in a few words what it made, or why it could not.
   */
  readonly take: (
    client: SyncClient,
    conflicts: readonly SyncConflict[],
    group: string,
  ) => Promise<WayTaken>
  /** Over the list of what was made. */
  readonly madeLabel: string
  /** One line of that list, for what `take` said it made. */
  readonly made: (summary: string) => string
  /** When what was made exists and its conflicts cannot be closed yet. */
  readonly stillOpen: string
}

/** What came of taking another way out of a conflict. */
export type WayTaken =
  | { readonly outcome: 'made'; readonly summary: string }
  | { readonly outcome: 'refused'; readonly message: string }

/**
 * The sentences of the foundation's screens that name a tenant, whoever leads
 * one, or a place in the application.
 *
 * They come whole. A word set into a sentence of the foundation would be
 * right in one grammatical case and wrong in the next, so the application
 * writes the sentence. Where a paragraph also states something the foundation
 * decides, such as how long a link holds, the foundation keeps that sentence
 * and puts the application's around it: a fact stays where it can change.
 */
export interface InterfaceSentences {
  readonly signIn: {
    /**
     * Once a link to a new password was asked for: under which conditions one
     * is on its way. The foundation adds how long it holds.
     */
    readonly resetSent: string
    /** And who helps when none arrives. */
    readonly resetHelp: string
    /**
     * Under the form: for whom a second factor is required. The foundation
     * adds what follows the password then.
     */
    readonly secondFactor: string
  }
  readonly secondFactor: {
    /**
     * Over the setup, where it is the only way on: for whom it is required.
     * The foundation adds how it is set up.
     */
    readonly required: string
    /** After a recovery code was used: where new ones are made. */
    readonly newCodes: string
  }
  readonly tenantChoice: {
    /** The heading over the choice. */
    readonly title: string
    /** The heading for an account that belongs to no tenant. */
    readonly noneTitle: string
    /** What such an account is told: that it belongs to none, and who can change that. */
    readonly none: string
    /** A tenant that could not be chosen, when the server gave no reason. */
    readonly notChosen: string
    /** While the tenants of the account are asked for. */
    readonly loading: string
    /** When they did not arrive. */
    readonly notLoaded: string
  }
  readonly setup: {
    /**
     * What the first run makes. The foundation says before it that the
     * instance is empty, and after it who makes every further account.
     */
    readonly whatIsMade: string
    /**
     * Where the setup code stands, which depends on how the application is
     * installed. The foundation adds why it is asked for.
     */
    readonly whereTheCodeIs: string
    /** The label of the field for the name of the first tenant. */
    readonly tenantLabel: string
    /** The hint under it: which name is meant. */
    readonly tenantHint: string
    /** The button that sets up. */
    readonly create: string
  }
  readonly tenants: {
    /**
     * Over the list of tenants in the header, for somebody who works in more
     * than one: what choosing another one does.
     */
    readonly switch: string
  }
  readonly settings: {
    /** Over the list beside every settings screen: whose settings these are. */
    readonly whose: string
    /** Under the title of the overview: what the settings are. */
    readonly what: string
    /**
     * At the foot of the overview: what is not the tenant's to set but the
     * account's. The foundation adds where that is found.
     */
    readonly belongsToTheAccount: string
  }
  readonly account: {
    /**
     * Under the choice of light or dark: where else it may be chosen
     * otherwise. The foundation says before it that the choice holds on this
     * device.
     */
    readonly themeElsewhere: string
    /**
     * Where no second factor is set up: for whom one is required. The
     * foundation says before it what a second factor is good for.
     */
    readonly secondFactorFor: string
  }
  readonly entry: {
    /**
     * What each of the two entries is called where it stands alone, as in the
     * list of devices an account is signed in on. A label and not a part of a
     * sentence: the foundation sets nothing around it but a comma.
     */
    readonly name: Readonly<Record<Entry, string>>
    /**
     * Over a screen opened on a device the other entry suits better: what the
     * device looks like, for each of the two.
     */
    readonly suits: Readonly<Record<Entry, string>>
    /** And the link that leads to that entry. */
    readonly goTo: Readonly<Record<Entry, string>>
  }
  readonly invitation: {
    /** Why a link is no longer good, and who to turn to, for each way it can end. */
    readonly spent: Readonly<Record<Exclude<InvitationState, 'open'>, string>>
    /**
     * For an address that has an account already: that the password stays and
     * the tenant is added. The foundation says before it that there is an
     * account.
     */
    readonly tenantIsAdded: string
    /** The button under it. */
    readonly join: string
    /**
     * For somebody new: who made the account and that only a password is
     * missing. The name and the address come marked up, to be set into the
     * sentence as they are.
     */
    readonly newAccount: (name: ReactNode, email: ReactNode) => ReactNode
  }
  /**
   * "Zugänge", where the people of a tenant are looked after. Only the office
   * shows it, so only the office hands these in: an entry that never draws
   * the screen does not load what it says.
   */
  readonly staff?: StaffSentences
  /** The area of the instance, which likewise only the office shows. */
  readonly instance?: InstanceAreaSentences
  /** The change log of a tenant, which likewise only the office shows. */
  readonly audit?: AuditSentences
}

/** What the change log of a tenant says in the words of the application. */
export interface AuditSentences {
  /** Under the heading: what the log holds. */
  readonly what: string
  /** For somebody without the right to read it: who reads it. */
  readonly onlyFor: string
}

/** What "Zugänge" says with the application's word for a tenant, or of a place in it. */
export interface StaffSentences {
  /** Under the title: who is listed there. */
  readonly what: string
  /** The caption of the table of accounts, by which a screen reader names it. */
  readonly accounts: string
  /** Under the form of a new account, in a tenant that sends no mail: where that is set up. */
  readonly noMail: string
  /**
   * After the facts of a link that went by mail, behind a semicolon: who
   * among the people of the tenant does not get to see it, with the full stop.
   */
  readonly mailedLinkUnseen: string
  /** In place of the devices of somebody who is signed in on none in this tenant. */
  readonly noDevices: string
  /** The caption of the devices of somebody: where they are signed in. */
  readonly devicesOf: (name: string) => string
}

/**
 * What the area of the instance says with the application's words: for a
 * tenant, for whoever leads one, and for whoever runs the instance, which
 * one application calls by the word the next has for a tenant.
 */
export interface InstanceAreaSentences {
  /** Under the heading at the door: what the area holds. */
  readonly what: string
  /** The door, for somebody who does not run the instance. */
  readonly shut: string
  /** The door, when it could not be asked whether the person runs the instance. */
  readonly notAsked: string
  /**
   * The door, for whoever runs the instance without a second factor: that the
   * area requires one, and who else needs one. The foundation adds after a
   * colon what a second factor is and where it is set up.
   */
  readonly secondFactor: string
  /** At the foot of the navigation: the way back to where the tenant is worked in. */
  readonly back: string
  readonly tenants: {
    readonly title: string
    readonly what: string
    /** The button that opens the form, the heading of the form, and its button. */
    readonly create: string
    /** The caption of the table, by which a screen reader names it. */
    readonly caption: string
    /** Under the table: what nobody sees of a tenant here. */
    readonly note: string
    /** The heads of the columns with the names of the tenants and of whoever leads each. */
    readonly tenantColumn: string
    readonly leadsColumn: string
    /** The fields of the form, and what is said when the name of whoever leads is missing. */
    readonly nameLabel: string
    readonly leadNameLabel: string
    readonly leadNameMissing: string
    readonly leadEmailLabel: string
    /** Under the address: what the link does for the person it goes to. */
    readonly leadEmailHint: string
    /** Beside the buttons: where a tenant of one's own is made instead. */
    readonly forOneself: string
    /** When the server refused without a reason, or could not be reached. */
    readonly notCreated: string
    /**
     * After the facts of the link, that it is shown only now and holds once
     * for seven days, behind an "und": what opening it does.
     */
    readonly linkMakes: string
  }
  readonly operators: {
    readonly title: string
    readonly caption: string
    /** The head of the column with their names. */
    readonly column: string
    /**
     * Under the table, after the foundation's sentence on the second factor:
     * whom nobody takes off.
     */
    readonly whoStays: string
    /**
     * The button that takes somebody off, as a screen reader names it, and
     * with a question mark the question before.
     */
    readonly remove: (name: string) => string
    /** In that question: what stays of the account. */
    readonly whatStays: string
    /** When taking somebody off failed without a reason. */
    readonly notRemoved: string
    /** The card that names somebody, and what naming them does. */
    readonly appoint: string
    readonly appointing: string
    /** An address in the empty field, to show what goes there. */
    readonly exampleAddress: string
    readonly appointed: (name: string) => string
  }
  readonly settings: {
    readonly what: string
    /**
     * Before the foundation's sentence on mail servers in the instance's own
     * network: how a tenant sends its mail.
     */
    readonly mailOwnServer: string
    /** After it: what the rule keeps a tenant from. */
    readonly mailNoWayIn: string
  }
  readonly log: {
    /** Under the heading: what the log holds, and where a change in a tenant stands instead. */
    readonly what: string
    /** A tenant whose name the log no longer has. */
    readonly aTenant: string
    /** A change to who runs the instance, or to its tenants, in the words that say what happened. */
    readonly operatorAppointed: string
    readonly operatorRemoved: string
    readonly tenantCreated: string
    readonly tenantRemoved: string
  }
}

const Application = createContext<InterfaceApplication | null>(null)

/** Over the whole tree of an application, once. */
export function ApplicationProvider({
  application,
  children,
}: {
  readonly application: InterfaceApplication
  readonly children: ReactNode
}) {
  return <Application.Provider value={application}>{children}</Application.Provider>
}

/**
 * What the application said. A screen outside of it has nothing to show a
 * name or a sentence from, and says so instead of showing one of its own.
 */
export function useApplication(): InterfaceApplication {
  const application = useContext(Application)

  if (!application) {
    throw new Error('Diese Ansicht braucht die Angaben der Anwendung und steht außerhalb davon.')
  }

  return application
}

/**
 * Sentences that come only with the value of the entry that shows their
 * screen. Opened in an entry whose value has none, the screen has nothing to
 * say and says so, as one outside of any value does.
 */
function handedIn<Sentences>(sentences: Sentences | undefined): Sentences {
  if (sentences === undefined) {
    throw new Error(
      'Diese Ansicht braucht Sätze der Anwendung, die dieser Einstieg nicht mitbringt.',
    )
  }

  return sentences
}

/** What "Zugänge" says in the words of the application. */
export function useStaffSentences(): StaffSentences {
  return handedIn(useApplication().sentences.staff)
}

/** What the area of the instance says in the words of the application. */
export function useInstanceSentences(): InstanceAreaSentences {
  return handedIn(useApplication().sentences.instance)
}

/** What the change log of a tenant says in the words of the application. */
export function useAuditSentences(): AuditSentences {
  return handedIn(useApplication().sentences.audit)
}
