import type { TenantId } from '@opengewerk/platform-domain'

import type { Database } from '../database/database.js'

/**
 * The two ways a message goes out, each with its own outbox and its own job.
 * A notification is raised for each of them separately, and whether it was
 * told already is asked of the outbox of the one that asks.
 */
export type Channel = 'mail' | 'push'

/** What every notification has: the kind of occasion it belongs to. */
export interface Notification<Kind extends string = string> {
  readonly kind: Kind
}

/** What writing the mail of a notification is handed: the moment, and where the instance is reached. */
export interface MailWriting {
  readonly now: Date
  /** The first trusted origin, for links back into the instance. */
  readonly origin: string
}

/** What writing the push messages of a notification is handed. */
export interface PushWriting {
  readonly now: Date
}

/** Raises what has become due for one tenant and is not yet told in a channel, as notifications. */
export type Raise<N, Extra> = (
  database: Database,
  tenantId: TenantId,
  now: Date,
  extra: Extra,
) => Promise<readonly N[]>

/**
 * One occasion of an application: a task falling due, a document on its way,
 * a parcel waiting at the desk.
 *
 * Which occasions there are, whom a message goes to, what it says and what it
 * carries is the application's. The mechanism is the same for every one: a
 * notification has one cause and is written once for it in each channel; a
 * writer asks first whether there is still something to tell and to whom, so
 * that a task done in the meantime gets no message; and what is due without
 * anybody pressing a button is raised by the job of each channel every minute.
 */
export interface Occasion<N extends Notification, Extra> {
  /** The cause a message is written once for, the same in every channel. */
  readonly causeOf: (notification: N) => string
  /** What has become due and is not yet told, per channel; left out for an occasion a route raises. */
  readonly raise?: { readonly mail?: Raise<N, Extra>; readonly push?: Raise<N, Extra> }
  /** Writes the mail of a notification, or nothing; returns the messages written. */
  readonly mail?: (
    database: Database,
    tenantId: TenantId,
    notification: N,
    writing: MailWriting & Extra,
  ) => Promise<readonly string[]>
  /** Writes the push messages of a notification, one per device, or nothing. */
  readonly push?: (
    database: Database,
    tenantId: TenantId,
    notification: N,
    writing: PushWriting & Extra,
  ) => Promise<readonly string[]>
}

/**
 * The occasions of an application, one per kind of notification. Keyed by the
 * kind, so that a kind without its occasion does not compile.
 */
export type OccasionTable<N extends Notification, Extra> = {
  readonly [Kind in N['kind']]: Occasion<Extract<N, { readonly kind: Kind }>, Extra>
}

/** The occasions of an application, made into what the jobs and the routes ask. */
export interface Occasions<N extends Notification, Extra> {
  /** The cause a message is written once for. */
  causeOf(notification: N): string
  /**
   * Turns a notification into mail in the outbox, or into nothing. Asked twice
   * for the same cause, the second time writes nothing, so whoever raises a
   * notification does not have to remember what it raised.
   */
  mail(
    database: Database,
    tenantId: TenantId,
    notification: N,
    writing: MailWriting & Extra,
  ): Promise<readonly string[]>
  /** Turns a notification into push messages, one per device of its person, or into nothing. */
  push(
    database: Database,
    tenantId: TenantId,
    notification: N,
    writing: PushWriting & Extra,
  ): Promise<readonly string[]>
  /**
   * What the mail job raises for one tenant: every occasion that is due by
   * itself, written as mail. Says how many messages it wrote.
   */
  raiseMail(
    database: Database,
    writing: Omit<MailWriting, 'now'> & Extra,
  ): (tenantId: TenantId, now: Date) => Promise<number>
  /** What the push job raises for one tenant, written as push messages. */
  raisePush(database: Database, extra: Extra): (tenantId: TenantId, now: Date) => Promise<number>
}

/**
 * The mechanism that turns an occasion into a message for mail and for push
 * (ADR 0010): one table of occasions, and both jobs run over it.
 */
export function occasionsOf<N extends Notification, Extra = Record<never, never>>(
  table: OccasionTable<N, Extra>,
): Occasions<N, Extra> {
  const entries = table as unknown as Readonly<Record<string, Occasion<N, Extra>>>

  function occasionOf(notification: N): Occasion<N, Extra> {
    const occasion = entries[notification.kind]

    if (!occasion) {
      throw new Error(`There is no occasion of the kind ${notification.kind}.`)
    }

    return occasion
  }

  async function raiseIn(
    channel: Channel,
    database: Database,
    tenantId: TenantId,
    now: Date,
    extra: Extra,
    write: (notification: N) => Promise<readonly string[]>,
  ): Promise<number> {
    let written = 0

    for (const occasion of Object.values(entries)) {
      const raise = occasion.raise?.[channel]

      if (!raise) {
        continue
      }

      for (const notification of await raise(database, tenantId, now, extra)) {
        written += (await write(notification)).length
      }
    }

    return written
  }

  const occasions: Occasions<N, Extra> = {
    causeOf: (notification) => occasionOf(notification).causeOf(notification),

    async mail(database, tenantId, notification, writing) {
      const write = occasionOf(notification).mail

      return write ? write(database, tenantId, notification, writing) : []
    },

    async push(database, tenantId, notification, writing) {
      const write = occasionOf(notification).push

      return write ? write(database, tenantId, notification, writing) : []
    },

    raiseMail: (database, writing) => (tenantId, now) =>
      raiseIn('mail', database, tenantId, now, writing as Extra, (notification) =>
        occasions.mail(database, tenantId, notification, { ...writing, now }),
      ),

    raisePush: (database, extra) => (tenantId, now) =>
      raiseIn('push', database, tenantId, now, extra, (notification) =>
        occasions.push(database, tenantId, notification, { ...extra, now }),
      ),
  }

  return occasions
}
