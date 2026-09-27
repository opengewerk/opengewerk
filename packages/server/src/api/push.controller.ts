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
  Put,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  isPushOccasion,
  longestDeviceLabel,
  type PushEntry,
  pushEntries,
  type PushOccasion,
  pushOccasions,
  pushOccasionWords,
  type PushSubscriptionId,
} from '@opengewerk/domain'
import { and, asc, eq } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { pushOptOuts, pushSubscriptions } from '../database/schema/index.js'
import { signedIn, writeTestPush } from '../notifications/push.js'
import { endpointReachable, type PushPost } from '../push/post.js'
import type { VapidKeys } from '../push/web-push.js'
import { subscriptionKeysProblem } from '../push/web-push.js'
import { sendDuePush } from '../push/worker.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** Where the routes get the key, the way out and, in the tests, a resolver of their own. */
export const PUSH = Symbol('Push')

/**
 * What push needs, from `VAPID_PRIVATE_KEY` and the network. Null on an
 * instance without a key: then it sends no push, and the routes say so.
 */
export interface PushContext {
  readonly vapid: VapidKeys
  readonly post: PushPost
  readonly resolve?: (host: string) => Promise<readonly string[]>
}

/** An occasion as "Konto" shows it: named, explained, and whether this person wants it. */
export interface PushOccasionView {
  readonly key: PushOccasion
  readonly label: string
  readonly about: string
  readonly on: boolean
}

/** A device of this person that takes push messages in this business. */
export interface PushDeviceView {
  readonly id: PushSubscriptionId
  readonly label: string
  readonly entry: PushEntry
  readonly since: string
  /** Signed in with the session of this request: the device asking. */
  readonly thisSession: boolean
}

/** Everything "Konto" needs about push, in one answer. */
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

/**
 * Push on one's own devices (#284): which devices take messages, which
 * occasions the person wants, and a test message. Every route is about the
 * person asking and nobody else, in the business the request is in.
 *
 * A device subscribes itself: only a browser can make a subscription, and
 * only while it is online, so there is nothing for the sync to carry. It
 * subscribes again at every start while push is on, which binds the row to
 * the session it is signed in with now.
 */
@Controller('push')
export class PushController {
  constructor(
    private readonly database: Database,
    @Inject(PUSH) private readonly push: PushContext | null,
  ) {}

  @Get()
  @RequiresPermission('push.write')
  async overview(@CurrentIdentity() identity: RequestIdentity): Promise<PushOverview> {
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
      occasions: occasionsOf(new Set(off.map((row) => row.occasion))),
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
   * A device that takes push from now on, or again. Keyed by its endpoint: the
   * same browser subscribing again updates its row, and a tablet handed to
   * somebody else becomes theirs.
   */
  @Put('subscription')
  @RequiresPermission('push.write')
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

    if (!(pushEntries as readonly unknown[]).includes(entry)) {
      throw new BadRequestException(
        'Ein Gerät arbeitet im Büro ("office") oder auf der Baustelle ("site").',
      )
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

    const now = new Date()
    const [row] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(pushSubscriptions)
        .values({
          tenantId: identity.tenantId,
          userId: identity.userId,
          sessionId: identity.sessionId ?? null,
          entry: entry as PushEntry,
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
            entry: entry as PushEntry,
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

  /** This device takes no more push messages, from itself or from the list under "Konto". */
  @Delete('subscriptions/:id')
  @RequiresPermission('push.write')
  async unsubscribe(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<{ readonly id: PushSubscriptionId }> {
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

  /** An occasion on or off, for every device of this person in this business. */
  @Put('occasions/:occasion')
  @RequiresPermission('push.write')
  async occasion(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('occasion') occasion: string,
    @Body() body: unknown,
  ): Promise<readonly PushOccasionView[]> {
    if (!isPushOccasion(occasion)) {
      throw new NotFoundException('Diesen Anlass gibt es nicht.')
    }

    const on = (body as { on?: unknown } | null)?.on

    if (typeof on !== 'boolean') {
      throw new BadRequestException('Erwartet wird "on" mit true oder false.')
    }

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

    return occasionsOf(new Set(off.map((row) => row.occasion)))
  }

  /**
   * A message to every device of this person that is signed in, sent at once:
   * whoever presses the button wants to see it arrive, not wait for the job.
   */
  @Post('test')
  @RequiresPermission('push.write')
  async test(
    @CurrentIdentity() identity: RequestIdentity,
  ): Promise<{ readonly sent: number; readonly failed: number }> {
    if (!this.push) {
      throw new ConflictException(noPush)
    }

    const now = new Date()
    const written = await writeTestPush(this.database, identity.tenantId, identity.userId, now)

    if (written.length === 0) {
      throw new ConflictException(
        'Auf keinem Gerät ist Push eingeschaltet. Zuerst auf diesem Gerät einschalten.',
      )
    }

    const report = await sendDuePush(
      { database: this.database, vapid: this.push.vapid, post: this.push.post },
      identity.tenantId,
      now,
      written,
    )

    return { sent: report.sent, failed: written.length - report.sent }
  }
}

function occasionsOf(off: ReadonlySet<string>): readonly PushOccasionView[] {
  return pushOccasions.map((key) => ({
    key,
    label: pushOccasionWords[key].label,
    about: pushOccasionWords[key].about,
    on: !off.has(key),
  }))
}
