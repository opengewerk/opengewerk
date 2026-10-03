import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  type Provider,
  Put,
  type Type,
  UnprocessableEntityException,
} from '@nestjs/common'
import { type Id, longestDeviceLabel } from '@opengewerk/platform-domain'
import { and, asc, eq } from 'drizzle-orm'

import { RequiresPermission } from '../api/authorization.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { type PushTables, pushTestKind } from '../database/schema/push.js'
import { PUSH, type PushContext } from './context.js'
import { type PushStore, type PushText, signedIn } from './outbox.js'
import { endpointReachable } from './post.js'
import { subscriptionKeysProblem } from './web-push.js'
import { sendDuePush } from './worker.js'

/** The identifier of a device that takes push messages. */
type PushSubscriptionId = Id<'push-subscription'>

/** What the application says about push, under which a module hands it to the routes. */
export const PUSH_RULES = Symbol('PushRules')

/** How an occasion is named and explained where a person switches it on or off. */
export interface PushOccasionWords {
  readonly label: string
  readonly about: string
}

/** What an application says about push to its routes. */
export interface PushRules<Entry extends string = string, Occasion extends string = string> {
  /** The devices and messages of the application, bound by `pushStore`. */
  readonly store: PushStore<Entry, Occasion>
  /** The entries a device can open the application in. */
  readonly entries: readonly [Entry, ...Entry[]]
  /** The sentence that refuses a device naming none of them, with the entries in it. */
  readonly entryRefused: string
  /** The occasions a person can switch off, in the order the account shows them, with their words. */
  readonly occasions: Readonly<Record<Occasion, PushOccasionWords>>
  /** What the test message from the account says, and where a tap on it leads. */
  readonly test: { readonly text: PushText; readonly urls: Readonly<Record<Entry, string>> }
}

/** An occasion as the account shows it: named, explained, and whether this person wants it. */
export interface PushOccasionView {
  readonly key: string
  readonly label: string
  readonly about: string
  readonly on: boolean
}

/** A device of this person that takes push messages in this tenant. */
export interface PushDeviceView {
  readonly id: PushSubscriptionId
  readonly label: string
  readonly entry: string
  readonly since: string
  /** Signed in with the session of this request: the device asking. */
  readonly thisSession: boolean
}

/** Everything the account needs about push, in one answer. */
export interface PushOverview {
  /** Whether this instance sends push at all. */
  readonly available: boolean
  /** The public key a browser subscribes with, or null without push. */
  readonly publicKey: string | null
  readonly occasions: readonly PushOccasionView[]
  readonly devices: readonly PushDeviceView[]
}

const noPush =
  'Diese Instanz verschickt keine Push-Nachrichten, in docker/.env fehlt VAPID_PRIVATE_KEY. ' +
  '"sh docker/start.sh" trägt den Schlüssel ein.'

/** How long the test message is any use: a test that arrives an hour later tests nothing. */
const testMinutes = 10

function occasionsOf(rules: PushRules, off: ReadonlySet<string>): readonly PushOccasionView[] {
  return Object.entries(rules.occasions).map(([key, words]) => ({
    key,
    label: words.label,
    about: words.about,
    on: !off.has(key),
  }))
}

/** The rights the routes of push ask for, named by the application. */
export interface PushRights<Right extends string> {
  /** Everything a person does with push on their own devices. */
  readonly write: Right
}

/**
 * The routes of push, made for the right of an application. A route about
 * the devices of the person asking and nobody else, in the tenant the
 * request is in.
 */
function pushController<Right extends string>(rights: PushRights<Right>): Type<unknown> {
  /**
   * Push on one's own devices: which devices take messages, which occasions
   * the person wants, and a test message.
   *
   * A device subscribes itself: only a browser can make a subscription, and
   * only while it is online, so there is nothing for the sync to carry. It
   * subscribes again at every start while push is on, which binds the row to
   * the session it is signed in with now.
   */
  @Controller('push')
  class PushController {
    private readonly tables: PushTables

    constructor(
      readonly database: Database,
      @Inject(PUSH) readonly push: PushContext | null,
      @Inject(PUSH_RULES) readonly rules: PushRules,
    ) {
      this.tables = rules.store.tables as unknown as PushTables
    }

    @Get()
    @RequiresPermission(rights.write)
    async overview(@CurrentIdentity() identity: RequestIdentity): Promise<PushOverview> {
      const { pushSubscriptions, pushOptOuts } = this.tables
      const { devices, off } = await this.database.forTenant(identity, async (tx) => ({
        devices: await tx
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, identity.userId))
          .orderBy(asc(pushSubscriptions.createdAt)),
        off: await tx
          .select({ occasion: pushOptOuts.occasion })
          .from(pushOptOuts)
          .where(eq(pushOptOuts.userId, identity.userId)),
      }))
      const live = await signedIn(this.database, devices, new Date())

      return {
        available: this.push !== null,
        publicKey: this.push?.vapid.publicKey ?? null,
        occasions: occasionsOf(this.rules, new Set(off.map((row) => row.occasion))),
        devices: live.map((device) => ({
          id: device.id,
          label: device.label,
          entry: device.entry,
          since: device.createdAt.toISOString(),
          thisSession: device.sessionId !== null && device.sessionId === identity.sessionId,
        })),
      }
    }

    /**
     * A device that takes push from now on, or again. Keyed by its endpoint:
     * the same browser subscribing again updates its row, and a tablet handed
     * to somebody else becomes theirs.
     */
    @Put('subscription')
    @RequiresPermission(rights.write)
    async subscribe(
      @CurrentIdentity() identity: RequestIdentity,
      @Body() body: unknown,
    ): Promise<{ readonly id: PushSubscriptionId }> {
      if (!this.push) {
        throw new ConflictException(noPush)
      }

      const fields = (body ?? {}) as Record<string, unknown>
      const keys = (fields['keys'] ?? {}) as Record<string, unknown>
      const { endpoint, entry, label } = fields
      const { p256dh, auth } = keys

      if (
        typeof endpoint !== 'string' ||
        typeof p256dh !== 'string' ||
        typeof auth !== 'string' ||
        typeof label !== 'string'
      ) {
        throw new BadRequestException(
          'Es fehlen Adresse, Schlüssel oder Name des Geräts, wie sie der Browser beim Abonnieren liefert.',
        )
      }

      if (typeof entry !== 'string' || !(this.rules.entries as readonly string[]).includes(entry)) {
        throw new BadRequestException(this.rules.entryRefused)
      }

      const name = label.trim()

      if (name === '' || name.length > longestDeviceLabel) {
        throw new BadRequestException(
          `Der Name des Geräts ist leer oder länger als ${String(longestDeviceLabel)} Zeichen.`,
        )
      }

      const problem =
        (await endpointReachable(endpoint, this.push.resolve)) ??
        subscriptionKeysProblem({ p256dh, auth })

      if (problem !== null) {
        throw new UnprocessableEntityException(problem)
      }

      const { pushSubscriptions } = this.tables
      const now = new Date()
      const [row] = await this.database.forTenant(identity, (tx) =>
        tx
          .insert(pushSubscriptions)
          .values({
            tenantId: identity.tenantId,
            userId: identity.userId,
            sessionId: identity.sessionId ?? null,
            entry,
            label: name,
            endpoint,
            p256dh,
            auth,
          })
          .onConflictDoUpdate({
            target: [pushSubscriptions.tenantId, pushSubscriptions.endpoint],
            set: {
              userId: identity.userId,
              sessionId: identity.sessionId ?? null,
              entry,
              label: name,
              p256dh,
              auth,
              updatedAt: now,
            },
          })
          .returning({ id: pushSubscriptions.id }),
      )

      if (!row) {
        throw new ConflictException('Das Gerät ließ sich nicht eintragen.')
      }

      return { id: row.id }
    }

    /** This device takes no more push messages, from itself or from the list of devices. */
    @Delete('subscriptions/:id')
    @RequiresPermission(rights.write)
    async unsubscribe(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
    ): Promise<{ readonly id: PushSubscriptionId }> {
      const { pushSubscriptions } = this.tables
      const [removed] = await this.database.forTenant(identity, (tx) =>
        tx
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.id, id as PushSubscriptionId),
              eq(pushSubscriptions.userId, identity.userId),
            ),
          )
          .returning({ id: pushSubscriptions.id }),
      )

      if (!removed) {
        throw new NotFoundException()
      }

      return { id: removed.id }
    }

    /** An occasion on or off, for every device of this person in this tenant. */
    @Put('occasions/:occasion')
    @RequiresPermission(rights.write)
    async occasion(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('occasion') occasion: string,
      @Body() body: unknown,
    ): Promise<readonly PushOccasionView[]> {
      if (!Object.hasOwn(this.rules.occasions, occasion)) {
        throw new NotFoundException('Diesen Anlass gibt es nicht.')
      }

      const on = (body as { on?: unknown } | null)?.on

      if (typeof on !== 'boolean') {
        throw new BadRequestException('Erwartet wird "on" mit true oder false.')
      }

      const { pushOptOuts } = this.tables
      const off = await this.database.forTenant(identity, async (tx) => {
        if (on) {
          await tx
            .delete(pushOptOuts)
            .where(and(eq(pushOptOuts.userId, identity.userId), eq(pushOptOuts.occasion, occasion)))
        } else {
          await tx
            .insert(pushOptOuts)
            .values({ tenantId: identity.tenantId, userId: identity.userId, occasion })
            .onConflictDoNothing({
              target: [pushOptOuts.tenantId, pushOptOuts.userId, pushOptOuts.occasion],
            })
        }

        return tx
          .select({ occasion: pushOptOuts.occasion })
          .from(pushOptOuts)
          .where(eq(pushOptOuts.userId, identity.userId))
      })

      return occasionsOf(this.rules, new Set(off.map((row) => row.occasion)))
    }

    /**
     * A message to every device of this person that is signed in, sent at
     * once: whoever presses the button wants to see it arrive, not wait for
     * the job.
     */
    @Post('test')
    @RequiresPermission(rights.write)
    async test(
      @CurrentIdentity() identity: RequestIdentity,
    ): Promise<{ readonly sent: number; readonly failed: number }> {
      if (!this.push) {
        throw new ConflictException(noPush)
      }

      const now = new Date()
      const written = await this.rules.store.write(
        this.database,
        identity.tenantId,
        {
          kind: pushTestKind,
          cause: `${pushTestKind}:${newId()}`,
          userId: identity.userId,
          text: this.rules.test.text,
          urls: this.rules.test.urls,
          expiresAt: new Date(now.getTime() + testMinutes * 60_000),
        },
        now,
      )

      if (written.length === 0) {
        throw new ConflictException(
          'Auf keinem Gerät ist Push eingeschaltet. Zuerst auf diesem Gerät einschalten.',
        )
      }

      const report = await sendDuePush(
        {
          database: this.database,
          vapid: this.push.vapid,
          post: this.push.post,
          store: this.rules.store,
        },
        identity.tenantId,
        now,
        written,
      )

      return { sent: report.sent, failed: written.length - report.sent }
    }
  }

  return PushController
}

/** What the routes of push are put together from. */
export interface PushParts<Right extends string, Entry extends string, Occasion extends string> {
  /** The rights of the application, which have to hold the one named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  readonly rights: PushRights<Right>
  readonly rules: PushRules<Entry, Occasion>
}

/**
 * The routes of push and what they are handed, for the module of an
 * application. What a route needs to send, the context under `PUSH`, the
 * module provides itself: null on an instance without a key, and the routes
 * say so.
 */
export function pushParts<Right extends string, Entry extends string, Occasion extends string>(
  parts: PushParts<Right, Entry, Occasion>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  if (!parts.access.catalogue.isRight(parts.rights.write)) {
    throw new Error(`The catalogue lacks the right of push: ${parts.rights.write}`)
  }

  return {
    controllers: [pushController(parts.rights)],
    providers: [{ provide: PUSH_RULES, useValue: parts.rules }],
  }
}
