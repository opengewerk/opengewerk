import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import type { Entry } from './components/surface.js'
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
  readonly sentences: InterfaceSentences
  /**
   * Starts the sync client of the application for the tenant whose store this
   * is: with the rules made from its policies, the kinds of record it has a
   * screen for, and the way to the server its entry takes.
   */
  readonly startSync: (start: DeviceStart) => Promise<SyncClient>
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
