import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  type Provider,
  Query,
  type Type,
} from '@nestjs/common'
import {
  type MemberIdentity,
  type Operation,
  type OperationId,
  type OperationKind,
  operationKinds,
  type OperationReceipt,
  type SyncValue,
  syncRights,
} from '@opengewerk/platform-domain'
import type { SQL } from 'drizzle-orm'

import { AUTHORIZATION, type Authorization, RequiresPermission } from '../api/authorization.js'
import { CurrentIdentity, type FoundIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database, type TenantTransaction } from '../database/database.js'
import {
  type ChangedRows,
  type Changes,
  closeConflict,
  OperationRefused,
  openConflicts,
  type ServerSync,
  type SyncConflictRow,
  UnknownFieldError,
} from './apply.js'

/** The token the routes of the sync are handed under. */
export const SYNC_ROUTES = Symbol('SyncRoutes')

/**
 * What a pull is narrowed to, for the person and the device asking.
 *
 * Worked out once per pull, inside its transaction and before the changes are
 * read, so that what narrows the rows and what the answer names for them come
 * from the same reading.
 */
export interface PullScope {
  /**
   * The condition that keeps the rows of an entity to what this device may
   * hold, or nothing to send them whole. Asked for every entity with changes.
   */
  narrow?(entity: string): SQL | undefined
  /**
   * What the answer names as narrowed, per entity whose rows depend on who
   * asks or on what a device holds. The store on a device belongs to the
   * tenant, not to a person, and a device handed from one person to another
   * would otherwise go on holding what only the first one may, or miss what
   * lies behind its cursor for the second. A device that finds a different
   * value than last time drops what it holds of that entity and asks from
   * the start.
   */
  readonly narrowed?: Readonly<Record<string, string>>
  /**
   * The changes as the device gets them, for a value no table holds and the
   * application puts in, in the same transaction.
   */
  answer?(changes: readonly ChangedRows[]): Promise<readonly ChangedRows[]> | readonly ChangedRows[]
}

/** What the scope of a pull is worked out from. */
export interface PullContext<
  Who extends MemberIdentity = MemberIdentity,
  Right extends string = string,
> {
  readonly tx: TenantTransaction
  readonly identity: RequestIdentity<Who, Right>
  /**
   * The query of the request as it came, `since` included. Whatever else it
   * may say is the application's: a device asking for more than the rows,
   * which only the application can decide whether to hand it.
   */
  readonly query: Readonly<Record<string, unknown>>
}

/**
 * What an application hands the routes of the sync (ADR 0010): its sync on
 * the server, the right each operation asks for, its words for a refusal of
 * the database, and what the device of somebody holds.
 */
export interface SyncRoutes<
  Who extends MemberIdentity = MemberIdentity,
  Right extends string = string,
> {
  readonly sync: ServerSync<FoundIdentity<Who>>
  /**
   * What an operation needs beyond the right to sync at all, or nothing for
   * an entity the application does not sync, which refuses the transmission.
   *
   * Sending a queue is a different way in, not a different thing to do.
   * Somebody who may not change a record online may not change it through an
   * outbox either, and the question belongs here rather than in the merge,
   * which knows nothing about who is asking. It looks at what the operation
   * does and not only at what it touches: creating a record can ask for
   * another right than changing it, as at the route of that record.
   */
  permissionFor(entity: string, kind: OperationKind, patches: Operation['patches']): Right | null
  /** The answer to a refusal of the database, in the words of the application. */
  answerFor(error: unknown): HttpException
  /** What the device of somebody holds. Left out, every device holds everything. */
  scope?(context: PullContext<Who, Right>): Promise<PullScope> | PullScope
}

/**
 * The answer to a transmission refused over one operation in it, with that
 * operation named.
 *
 * Named only where the answer is about what the operation carried: a bad
 * request, or a conflict the database raised. A device can then show the one
 * entry and throw it away, instead of sending the same stack for ever. A 500
 * is the server's own failure and no reason to lose an entry over, and a 403
 * says nothing else on purpose.
 */
function naming(operationId: OperationId, answer: HttpException): HttpException {
  const status = answer.getStatus()

  if (status !== 400 && status !== 409) {
    return answer
  }

  const body = answer.getResponse()

  return new HttpException(
    {
      ...(typeof body === 'string' ? { statusCode: status, message: body } : body),
      operationId,
    },
    status,
  )
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`${what} ist kein Objekt.`)
  }

  return value as Record<string, unknown>
}

function asSyncValue(value: unknown, what: string): SyncValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  throw new BadRequestException(`${what} kann kein Feldwert sein.`)
}

/**
 * Reads what a device sent and refuses anything that is not an operation.
 *
 * The device id is taken from the transmission, not from each operation in it.
 * A queue belongs to one device, and letting every entry name its own would
 * let a device write changes in somebody else's name into the conflict list.
 */
function parseOperations(body: unknown): { deviceId: string; operations: Operation[] } {
  const envelope = asRecord(body, 'Der Rumpf')
  const deviceId = envelope['deviceId']

  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw new BadRequestException('Es fehlt die Geräte-Kennung.')
  }

  const raw = envelope['operations']

  if (!Array.isArray(raw)) {
    throw new BadRequestException('Es fehlt die Liste der Vorgänge.')
  }

  return {
    deviceId,
    operations: raw.map((entry, index) => parseOperation(entry, index, deviceId)),
  }
}

function parseOperation(entry: unknown, index: number, deviceId: string): Operation {
  const at = `Vorgang ${index + 1}`
  const fields = asRecord(entry, at)

  const id = fields['id']
  const entity = fields['entity']
  const recordId = fields['recordId']
  const kind = fields['kind']
  const recordedAt = fields['recordedAt']

  if (typeof id !== 'string' || typeof entity !== 'string' || typeof recordId !== 'string') {
    throw new BadRequestException(`${at}: id, entity und recordId müssen Zeichenketten sein.`)
  }

  if (typeof kind !== 'string' || !(operationKinds as readonly string[]).includes(kind)) {
    throw new BadRequestException(`${at}: unbekannte Art ${String(kind)}.`)
  }

  const recorded = new Date(String(recordedAt))

  if (Number.isNaN(recorded.getTime())) {
    throw new BadRequestException(`${at}: recordedAt ist kein Zeitpunkt.`)
  }

  const patches = fields['patches']

  if (!Array.isArray(patches)) {
    throw new BadRequestException(`${at}: patches fehlt.`)
  }

  const baseVersion = fields['baseVersion']

  return {
    id: id as OperationId,
    entity,
    recordId,
    kind: kind as OperationKind,
    baseVersion: typeof baseVersion === 'number' ? baseVersion : null,
    patches: patches.map((patch, position) => {
      const parts = asRecord(patch, `${at}, Feld ${position + 1}`)
      const field = parts['field']

      if (typeof field !== 'string' || field.length === 0) {
        throw new BadRequestException(`${at}: ein Feld ohne Namen.`)
      }

      return {
        field,
        from: asSyncValue(parts['from'], `${at}.${field}.from`),
        to: asSyncValue(parts['to'], `${at}.${field}.to`),
      }
    }),
    recordedAt: recorded,
    deviceId,
  }
}

/**
 * The routes a device syncs through (ADR 0010): sending its outbox, taking
 * what has changed, and the list of conflicts somebody has to work through.
 */
@Controller('sync')
export class SyncController {
  constructor(
    private readonly database: Database,
    @Inject(SYNC_ROUTES) private readonly routes: SyncRoutes,
    @Inject(AUTHORIZATION) private readonly authorization: Authorization,
  ) {}

  /**
   * One transmission of a device's outbox.
   *
   * The whole batch runs in one transaction, so it either lands or it does
   * not, and a device whose connection dropped can simply send it again. What
   * makes the repeat harmless is the operation id, minted on the device before
   * there was any network.
   */
  @Post()
  @RequiresPermission(syncRights.write)
  async push(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<{ receipts: readonly OperationReceipt[] }> {
    const { deviceId, operations } = parseOperations(body)

    for (const operation of operations) {
      const needed = this.routes.permissionFor(operation.entity, operation.kind, operation.patches)

      if (!needed) {
        throw naming(
          operation.id,
          new BadRequestException(
            `Diese Art von Datensatz wird nicht abgeglichen: ${operation.entity}`,
          ),
        )
      }

      // Named as well: a right taken away while a device still holds changes
      // that needed it would otherwise hold its outbox for good.
      if (!identity.rights.includes(needed)) {
        throw naming(
          operation.id,
          // In words, as the conflict screen shows it under the refused change.
          new BadRequestException(this.authorization.missingPermission(needed)),
        )
      }
    }

    try {
      return await this.database.forTenant({ ...identity, deviceId }, async (tx) => ({
        receipts: await this.routes.sync.applyOperations(
          tx,
          identity.tenantId,
          operations,
          identity,
        ),
      }))
    } catch (error) {
      if (error instanceof OperationRefused) {
        throw naming(
          error.operationId,
          error.cause instanceof UnknownFieldError
            ? new BadRequestException(error.cause.message)
            : this.routes.answerFor(error.cause),
        )
      }

      throw error
    }
  }

  /**
   * Everything that has changed since the device last asked, records marked as
   * deleted included. Those are the whole reason they are marked rather than
   * removed: a row that is gone would not be among the changes, and a device
   * that was offline would keep it forever.
   *
   * Narrowed to what the device of the person asking may hold, as the
   * application says, and the answer names what it was narrowed to.
   */
  @Get()
  @RequiresPermission(syncRights.read)
  async pull(
    @CurrentIdentity() identity: RequestIdentity,
    @Query() query: Record<string, unknown>,
  ): Promise<Changes & { narrowed: Readonly<Record<string, string>> }> {
    const from = Number(query['since'] ?? 0)

    if (!Number.isInteger(from) || from < 0) {
      throw new BadRequestException('Der Stand muss eine Zahl ab null sein.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const scope = (await this.routes.scope?.({ tx, identity, query })) ?? {}
      const found = await this.routes.sync.changesSince(tx, from, undefined, (entity) =>
        scope.narrow?.(entity),
      )
      const changes = scope.answer ? await scope.answer(found.changes) : found.changes

      return { ...found, changes, narrowed: scope.narrowed ?? {} }
    })
  }

  /** The list somebody has to work through. */
  @Get('conflicts')
  @RequiresPermission(syncRights.read)
  conflicts(@CurrentIdentity() identity: RequestIdentity): Promise<SyncConflictRow[]> {
    return this.database.forTenant(identity, (tx) => openConflicts(tx))
  }

  /**
   * Marks a conflict as decided. What the decision was is a change like any
   * other and comes through the ordinary routes; this only says that nobody
   * has to look at it again.
   */
  @Post('conflicts/:id/resolve')
  @RequiresPermission(syncRights.write)
  async resolve(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<{ resolved: string }> {
    const closed = await this.database.forTenant(identity, (tx) => closeConflict(tx, id))

    if (!closed) {
      throw new NotFoundException()
    }

    return { resolved: id }
  }
}

/** What the routes of the sync are put together from. */
export interface SyncParts<Who extends MemberIdentity, Right extends string> {
  /** The rights of the application, which have to hold those of the sync. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  readonly routes: SyncRoutes<Who, Right>
}

/**
 * The controller of the sync and what it is handed, for the module of an
 * application whose devices work without a network.
 *
 * A function and not a module of its own, for the reason `authenticationParts`
 * is one: the guard, the database and the identity source are the
 * application's to register, once.
 */
export function syncParts<Who extends MemberIdentity, Right extends string>(
  parts: SyncParts<Who, Right>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  const missing = Object.values(syncRights).filter(
    (right) => !parts.access.catalogue.isRight(right),
  )

  if (missing.length > 0) {
    // The routes ask for these. Without them in the catalogue no role could
    // hold them, and every device would be refused.
    throw new Error(`The catalogue lacks the rights of the sync: ${missing.join(', ')}`)
  }

  return {
    controllers: [SyncController],
    providers: [{ provide: SYNC_ROUTES, useValue: parts.routes }],
  }
}
