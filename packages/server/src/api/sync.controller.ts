import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  isAllowed,
  isJobProgress,
  type Operation,
  type OperationId,
  type OperationKind,
  operationKinds,
  type Permission,
  type SyncValue,
} from '@opengewerk/domain'

import { eq } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { timeEntries } from '../database/schema/index.js'
import {
  applyOperations,
  changesSince,
  closeConflict,
  OperationRefused,
  openConflicts,
  UnknownFieldError,
} from '../database/sync.js'
import { RequiresPermission } from './authorization.js'
import { answerFor } from './database-errors.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The answer to a transmission refused over one operation in it, with that
 * operation named (#120).
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
 * What an operation needs beyond the right to sync at all.
 *
 * Sending a queue is a different way in, not a different thing to do. A
 * technician who may not change a customer online may not change one through
 * an outbox either, and the check belongs here rather than in the merge, which
 * knows nothing about who is asking. That runs both ways: creating a customer
 * asks for the same right here as the route does, which is why this looks at
 * what the operation does and not only at what it touches.
 *
 * The customer is the only subject where the two differ. A contact counts as
 * part of it: writing down who opened the door is the same act as writing down
 * whose door it was.
 *
 * The job is the one subject where the fields decide (#128). Finishing a job
 * and writing down what happened is what a technician does on site, and asks
 * for `job.progress`; a change that also says who the job is for, where it is
 * or what it is called asks for `job.write`, however small the rest of it is.
 * The operation is asked for the narrowest right that covers it, and whoever
 * holds `job.write` holds `job.progress` as well.
 */
export function permissionFor(
  entity: string,
  kind: OperationKind,
  patches: Operation['patches'] = [],
): Permission | null {
  if ((entity === 'customers' || entity === 'contacts') && kind === 'create') {
    return 'customer.create'
  }

  if (entity === 'jobs' && kind === 'update' && isJobProgress(patches)) {
    return 'job.progress'
  }

  const subject: Record<string, Permission> = {
    customers: 'customer.write',
    contacts: 'customer.write',
    sites: 'site.write',
    installations: 'installation.write',
    distribution_boards: 'installation.write',
    board_sections: 'installation.write',
    circuits: 'installation.write',
    equipment: 'installation.write',
    inverters: 'installation.write',
    pv_strings: 'installation.write',
    pv_modules: 'installation.write',
    jobs: 'job.write',
    documents: 'document.write',
    // A position is not a subject of its own. Whoever may write the document
    // may write its lines, and whoever may not, may not: a technician filling
    // in a report on site is doing one thing, not two.
    document_lines: 'document.write',
    // The same for a signature. The technician who wrote the report is the
    // one who hands the device to the customer.
    document_signatures: 'document.write',
    // No device writes the sources of a collective invoice (#135); the policy
    // answers any attempt with `online_only`. Named here so that the answer
    // is that conflict about the one operation and not a refused transmission.
    document_sources: 'document.write',
    tasks: 'task.write',
    // A file and its versions are one thing to whoever adds them: taking a
    // photo on site is adding it, and a new version is the same act again.
    attachments: 'attachment.write',
    attachment_versions: 'attachment.write',
    // Everybody's own working time, and nobody else's: the owner of an entry
    // is written by the database from the request.
    time_entries: 'time.write',
  }

  return subject[entity] ?? null
}

@Controller('sync')
export class SyncController {
  constructor(private readonly database: Database) {}

  /**
   * One transmission of a device's outbox.
   *
   * The whole batch runs in one transaction, so it either lands or it does
   * not, and a device whose connection dropped can simply send it again. What
   * makes the repeat harmless is the operation id, minted on the device before
   * there was any network.
   */
  @Post()
  @RequiresPermission('sync.write')
  async push(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const { deviceId, operations } = parseOperations(body)

    for (const operation of operations) {
      const needed = permissionFor(operation.entity, operation.kind, operation.patches)

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
      if (!isAllowed(identity, needed)) {
        throw naming(
          operation.id,
          new BadRequestException(`Fehlendes Recht für ${operation.entity}: ${needed}`),
        )
      }
    }

    try {
      return await this.database.forTenant({ ...identity, deviceId }, async (tx) => ({
        receipts: await applyOperations(tx, identity.tenantId, operations),
      }))
    } catch (error) {
      if (error instanceof OperationRefused) {
        throw naming(
          error.operationId,
          error.cause instanceof UnknownFieldError
            ? new BadRequestException(error.cause.message)
            : answerFor(error.cause),
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
   */
  @Get()
  @RequiresPermission('sync.read')
  async pull(@CurrentIdentity() identity: RequestIdentity, @Query('since') since?: string) {
    const from = Number(since ?? 0)

    if (!Number.isInteger(from) || from < 0) {
      throw new BadRequestException('Der Stand muss eine Zahl ab null sein.')
    }

    // The working time of the others only for whoever may read it (#76).
    const ownTimeOnly = !isAllowed(identity, 'time.read')
    const answer = await this.database.forTenant(identity, (tx) =>
      changesSince(tx, from, undefined, (entity) =>
        entity === 'time_entries' && ownTimeOnly
          ? eq(timeEntries.userId, identity.userId)
          : undefined,
      ),
    )

    // What the answer was narrowed to, per entity whose rows depend on who
    // asks. The store on a device belongs to the business, not to a person,
    // and a device handed from the office to a technician would otherwise go
    // on holding everybody's time, or one handed the other way would miss
    // what lies behind its cursor. A device that finds a different value than
    // last time drops what it holds of that entity and asks from the start.
    return {
      ...answer,
      narrowed: { time_entries: ownTimeOnly ? `user:${identity.userId}` : 'all' },
    }
  }

  /** The list somebody has to work through. */
  @Get('conflicts')
  @RequiresPermission('sync.read')
  conflicts(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) => openConflicts(tx))
  }

  /**
   * Marks a conflict as decided. What the decision was is a change like any
   * other and comes through the ordinary routes; this only says that nobody
   * has to look at it again.
   */
  @Post('conflicts/:id/resolve')
  @RequiresPermission('sync.write')
  async resolve(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const closed = await this.database.forTenant(identity, (tx) => closeConflict(tx, id))

    if (!closed) {
      throw new NotFoundException()
    }

    return { resolved: id }
  }
}
