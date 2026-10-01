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
  Query,
} from '@nestjs/common'
import {
  isAllowed,
  isJobProgress,
  missingPermission,
  type Operation,
  type OperationId,
  type OperationKind,
  operationKinds,
  type Permission,
  type SiteAccessId,
  type SyncValue,
  type TenantId,
} from '@opengewerk/domain'

import { Database, type TenantTransaction } from '@opengewerk/platform-server'
import { eq, sql } from 'drizzle-orm'

import {
  accessesOfOpenJobs,
  articlesNarrowedTo,
  articlesOnDevices,
  deviceScope,
  narrowedTo,
  scopedEntities,
  sitesWithOpenJobs,
} from '../database/device-scope.js'
import { siteAccessDeliveries, siteAccessReveals, timeEntries } from '../database/schema/index.js'
import type { SecretKey } from '../secrets/key.js'
import { readAccessValues } from '../secrets/site-access.js'
import {
  applyOperations,
  type ChangedRows,
  changesSince,
  closeConflict,
  OperationRefused,
  openConflicts,
  UnknownFieldError,
} from '../database/sync.js'
import { RequiresPermission } from './authorization.js'
import { answerFor } from './database-errors.js'
import { SECRETS } from './handed-in.js'
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

/** Whether an operation sets a field to a value, as a create sets every field it has. */
function setsField(patches: Operation['patches'], field: string): boolean {
  return patches.some((patch) => patch.field === field && patch.to !== null && patch.to !== '')
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
 * is what a technician does on site, and asks for `job.progress`; a change
 * that also says who the job is for, where it is, what it is called or what is
 * to be done asks for `job.write`, however small the rest of it is. Writing
 * down what happened is a note of its own (#220) and asks for `job.progress`
 * as well.
 * The operation is asked for the narrowest right that covers it, and whoever
 * holds `job.write` holds `job.progress` as well.
 */
export function permissionFor(
  entity: string,
  kind: OperationKind,
  patches: Operation['patches'] = [],
): Permission | null {
  // A contact of a supplier is the supplier's (#296), which a technician, who
  // may add a customer's contact on site, may not keep. Creating one names the
  // supplier; a change to a contact asks `customer.write`, which a technician
  // lacks, and the route asks for the supplier's right on top.
  if (entity === 'contacts' && kind === 'create' && setsField(patches, 'supplierId')) {
    return 'supplier.write'
  }

  if ((entity === 'customers' || entity === 'contacts') && kind === 'create') {
    return 'customer.create'
  }

  if (entity === 'jobs' && kind === 'update' && isJobProgress(patches)) {
    return 'job.progress'
  }

  // What happened on site (#220), which is the progress of the job and not
  // what the job is: the technician on it writes it.
  if (entity === 'job_notes' && kind === 'create') {
    return 'job.progress'
  }

  const subject: Record<string, Permission> = {
    customers: 'customer.write',
    contacts: 'customer.write',
    suppliers: 'supplier.write',
    // Kept at the routes of the office (#296); the policy refuses every write
    // from a device, and this names the right that keeps them.
    articles: 'article.write',
    article_prices: 'article.write',
    sites: 'site.write',
    installations: 'installation.write',
    distribution_boards: 'installation.write',
    board_sections: 'installation.write',
    circuits: 'installation.write',
    equipment: 'installation.write',
    inverters: 'installation.write',
    pv_strings: 'installation.write',
    pv_modules: 'installation.write',
    // The labels of an installation (#308) are made and blocked at its
    // routes; the policy refuses every write from a device.
    installation_labels: 'installation.write',
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
    // The same for who is on a job (#140), which the office sets at a route.
    job_assignments: 'job.write',
    // The ways into a site (#286), kept at the routes of the site, which ask
    // for `site.access`; the policy refuses every write from a device, and
    // this names the right to change the site they belong to. A showing is
    // written by the device that showed a value, and every device that holds
    // one writes through the sync: no right beyond that, and the person comes
    // from the request.
    site_accesses: 'site.write',
    site_access_reveals: 'sync.write',
    // And for the tags (#314): made and put on at the routes of the office.
    tags: 'customer.write',
    customer_tags: 'customer.write',
    site_tags: 'site.write',
    // A note is never changed (#220); a change sent anyway asks for the
    // right on the job itself, and the policy answers it `online_only`.
    job_notes: 'job.write',
    // A test protocol is measured at an installation and belongs to it (#79):
    // whoever may record its structure may record its test.
    form_records: 'installation.write',
    // The fields of the reports are written in the settings (#78), and a
    // device only reads them. The owner, who may write them, gets
    // `online_only` for one sent anyway; anybody else the missing right.
    form_definitions: 'settings.write',
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

/**
 * The rows of the ways into a site with what the device may know of their
 * value (#286): whether there is one and whether it opens, `valueState`, and
 * the value itself for the sites in `valued`, the ones of the open jobs the
 * person whose device asked is assigned to, whatever their role (#447).
 * Nothing else in any answer carries it, and every value handed out is
 * recorded the first time it reaches that device, in `site_access_deliveries`,
 * with the person, the device and when the value was set: what a showing from
 * that device is measured against.
 */
async function withAccessStates(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  changes: readonly ChangedRows[],
  valued: ReadonlySet<string> | null,
  recipient: { readonly userId: string; readonly deviceId: string } | null,
): Promise<readonly ChangedRows[]> {
  const rows = changes.find((change) => change.entity === 'site_accesses')?.rows ?? []
  const live = rows.filter((row) => row['deletedAt'] === null)

  if (live.length === 0) {
    return changes
  }

  const values = await readAccessValues(
    tx,
    key,
    tenantId,
    live.map((row) => row['id'] as SiteAccessId),
  )

  const delivered: { readonly siteAccessId: SiteAccessId; readonly valueSetAt: Date }[] = []
  const answered = changes.map((change) =>
    change.entity !== 'site_accesses'
      ? change
      : {
          entity: change.entity,
          rows: change.rows.map((row) => {
            if (row['deletedAt'] !== null) {
              return row
            }

            const stored = values.get(row['id'] as SiteAccessId) ?? { state: 'none' as const }

            if (
              recipient &&
              valued?.has(String(row['siteId'])) &&
              stored.state === 'readable' &&
              row['valueSetAt'] !== null
            ) {
              delivered.push({
                siteAccessId: row['id'] as SiteAccessId,
                valueSetAt: new Date(row['valueSetAt'] as string | Date),
              })

              return { ...row, valueState: stored.state, value: stored.value }
            }

            return { ...row, valueState: stored.state }
          }),
        },
  )

  if (recipient && delivered.length > 0) {
    await tx
      .insert(siteAccessDeliveries)
      .values(
        delivered.map(({ siteAccessId, valueSetAt }) => ({
          tenantId,
          siteAccessId,
          userId: recipient.userId,
          deviceId: recipient.deviceId,
          valueSetAt,
        })),
      )
      .onConflictDoNothing({
        target: [
          siteAccessDeliveries.tenantId,
          siteAccessDeliveries.siteAccessId,
          siteAccessDeliveries.userId,
          siteAccessDeliveries.deviceId,
          siteAccessDeliveries.valueSetAt,
        ],
      })
  }

  return answered
}

@Controller('sync')
export class SyncController {
  constructor(
    private readonly database: Database,
    @Inject(SECRETS) private readonly key: SecretKey | null,
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
          // In words, as the conflict screen shows it under the refused change (#271).
          new BadRequestException(missingPermission(needed)),
        )
      }
    }

    try {
      return await this.database.forTenant({ ...identity, deviceId }, async (tx) => ({
        receipts: await applyOperations(tx, identity.tenantId, operations, identity),
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
  async pull(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('since') since?: string,
    @Query('access') access?: string,
  ) {
    const from = Number(since ?? 0)

    if (!Number.isInteger(from) || from < 0) {
      throw new BadRequestException('Der Stand muss eine Zahl ab null sein.')
    }

    // The working time of the others only for whoever may read it (#76), and
    // only their part of the business for whoever may not hold all of it
    // (#140): the jobs they are on, with what hangs on them.
    const ownTimeOnly = !isAllowed(identity, 'time.read')
    const wholeBusiness = isAllowed(identity, 'job.read.all')
    // The ways into a site (#286): all of them for whoever keeps them, the
    // ones of the sites of their open jobs for a technician. A value comes
    // with a row only when the device asks for it, which the site does and
    // the office does not, so that it opens the door in a cellar without a
    // network, and only for a site of an open job the person is assigned to,
    // whatever their role (#447): the owner who drives out holds the code of
    // their own job, and nobody holds one more than a technician on that job
    // would. Any other value the owner and the office ask the route for, which
    // leaves a trace there. The parameter is the client's to choose, the
    // assignment is not (Greptile on #445).
    // A value goes only to a device the session names, since what it was
    // handed is recorded for that device and a showing is taken only from it.
    const keepsAccess = isAllowed(identity, 'site.access')
    const withValues = access === 'values' && identity.deviceId !== undefined
    const { answer, scope, sites, held } = await this.database.forTenant(identity, async (tx) => {
      const scope = wholeBusiness ? null : await deviceScope(tx, identity.userId)
      const held = await articlesOnDevices(tx)
      // The jobs of the person are asked for this alone where they hold the
      // whole business, and only when the device wants values.
      const own = scope ?? (withValues ? await deviceScope(tx, identity.userId) : null)
      const sites =
        own !== null && (withValues || !keepsAccess) ? await sitesWithOpenJobs(tx, own) : null
      const found = await changesSince(tx, from, undefined, (entity) => {
        if (entity === 'time_entries' && ownTimeOnly) {
          return eq(timeEntries.userId, identity.userId)
        }

        // Who saw which value is for the audit log; a device gets its own.
        if (entity === 'site_access_reveals') {
          return eq(siteAccessReveals.userId, identity.userId)
        }

        // The catalogue does not fit on a device (#296): every device, the
        // office's too, holds the frequent articles and their prices.
        if (entity === 'articles' || entity === 'article_prices') {
          return articlesNarrowedTo(held, entity)
        }

        if (entity === 'site_accesses') {
          return keepsAccess ? undefined : scope ? accessesOfOpenJobs(scope) : sql`false`
        }

        return scope ? narrowedTo(scope, entity) : undefined
      })
      const changes = this.key
        ? await withAccessStates(
            tx,
            this.key,
            identity.tenantId,
            found.changes,
            withValues ? (sites?.siteIds ?? null) : null,
            identity.deviceId === undefined
              ? null
              : { userId: identity.userId, deviceId: identity.deviceId },
          )
        : found.changes

      return { answer: { ...found, changes }, scope, sites, held }
    })

    // What the answer was narrowed to, per entity whose rows depend on who
    // asks. The store on a device belongs to the business, not to a person,
    // and a device handed from the office to a technician would otherwise go
    // on holding everybody's time, or one handed the other way would miss
    // what lies behind its cursor. A device that finds a different value than
    // last time drops what it holds of that entity and asks from the start;
    // for the part of the business that is every change of the jobs in it.
    return {
      ...answer,
      narrowed: {
        time_entries: ownTimeOnly ? `user:${identity.userId}` : 'all',
        ...Object.fromEntries(
          scopedEntities.map((entity) => [entity, scope ? scope.value : 'all']),
        ),
        // Changes with the sites of the open jobs, so that a closed job takes
        // the ways into its site off the device, and with whether values were
        // asked for. For whoever keeps them all, only while some carry a value
        // (#447): a device that holds none has nothing to let go of.
        site_accesses: keepsAccess
          ? withValues && sites && sites.siteIds.size > 0
            ? `all:${sites.value}:values`
            : 'all'
          : scope && sites
            ? `${sites.value}:${withValues ? 'values' : 'bare'}`
            : 'none',
        site_access_reveals: `user:${identity.userId}`,
        // The articles every device holds, which change with the articles and
        // not with who asks (#296).
        articles: held.value,
        article_prices: held.value,
      },
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
