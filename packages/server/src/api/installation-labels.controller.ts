import { randomBytes } from 'node:crypto'

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type InstallationId,
  type InstallationLabelId,
  type LabelFormat,
  labelCodeFrom,
  labelPrintProblem,
  type TenantId,
} from '@opengewerk/domain'
import {
  Database,
  isUniqueViolation,
  isUuid,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
  type TenantTransaction,
  TRUSTED_ORIGINS,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import {
  installationLabels,
  installations,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'
import { labelPrintJob } from '../labels/label-print.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** An installation that is not deleted, held until the transaction ends when `lock` says so. */
async function openInstallation(tx: TenantTransaction, installationId: string, lock: boolean) {
  if (!isUuid(installationId)) {
    return undefined
  }

  const query = tx
    .select()
    .from(installations)
    .where(
      and(eq(installations.id, installationId as InstallationId), isNull(installations.deletedAt)),
    )
  const [found] = lock ? await query.for('share') : await query

  return found
}

/** A label of this installation that is not deleted. */
async function labelOf(
  tx: TenantTransaction,
  installationId: InstallationId,
  id: string,
  lock: boolean,
) {
  if (!isUuid(id)) {
    return undefined
  }

  const query = tx
    .select()
    .from(installationLabels)
    .where(
      and(
        eq(installationLabels.id, id as InstallationLabelId),
        eq(installationLabels.installationId, installationId),
        isNull(installationLabels.deletedAt),
      ),
    )
  const [found] = lock ? await query.for('update') : await query

  return found
}

/** A whole number from the query, or NaN for anything else, which the check refuses. */
function whole(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback
  }

  return /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN
}

/**
 * The QR labels of an installation (#308). Under `installations`, so that no
 * new prefix of the API has to be added in three places.
 *
 * Made and blocked here and nowhere else; a device reads them through the
 * sync. The code is drawn by the server and never by the client: it is what
 * keeps the address on a label from being guessed.
 */
@Controller('installations/:installationId/labels')
export class InstallationLabelsController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
    @Inject(TRUSTED_ORIGINS) private readonly origins: readonly string[],
  ) {}

  /**
   * A new label. Refused while the installation has a valid one: a second
   * would leave two stickers that open it, and blocking the one would not
   * block the other. Block first, then make the new one.
   */
  @Post()
  @RequiresPermission('installation.write')
  async create(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
  ) {
    // A code drawn twice is as likely as none of these requests ever being
    // made; the loop is there so that the unique index is the last word and
    // not an error nobody could have caused.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.forTenant(identity, async (tx) => {
          // Held until the label is written: an installation deleted meanwhile
          // would otherwise keep a label nothing takes away.
          const installation = await openInstallation(tx, installationId, true)

          if (!installation) {
            throw new NotFoundException()
          }

          const [valid] = await tx
            .select({ id: installationLabels.id })
            .from(installationLabels)
            .where(
              and(
                eq(installationLabels.installationId, installation.id),
                isNull(installationLabels.blockedAt),
                isNull(installationLabels.deletedAt),
              ),
            )

          if (valid) {
            throw new ConflictException(
              'Diese Anlage hat schon ein gültiges Etikett. Erst sperren, dann ein neues anlegen.',
            )
          }

          const [created] = await tx
            .insert(installationLabels)
            .values({
              tenantId: identity.tenantId,
              installationId: installation.id,
              code: labelCodeFrom(randomBytes(10)),
            })
            .returning()

          return created
        })
      } catch (error) {
        // Two requests at once: the second finds the first one's label.
        if (isUniqueViolation(error, 'installation_labels_one_valid')) {
          throw new ConflictException(
            'Diese Anlage hat schon ein gültiges Etikett. Erst sperren, dann ein neues anlegen.',
          )
        }

        if (!isUniqueViolation(error, 'installation_labels_code_once')) {
          throw error
        }
      }
    }

    throw new ServiceUnavailableException(
      'Es ließ sich kein freier Code ziehen. Bitte noch einmal.',
    )
  }

  /**
   * Blocks a label for good: it opens nothing any more, in the app or in the
   * browser, and is not printed again. Blocking one that is blocked already
   * answers with it as it is.
   */
  @Post(':id/block')
  @RequiresPermission('installation.write')
  async block(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Param('id') id: string,
  ) {
    return this.database.forTenant(identity, async (tx) => {
      const installation = await openInstallation(tx, installationId, false)
      const existing = installation ? await labelOf(tx, installation.id, id, true) : undefined

      if (!installation || !existing) {
        throw new NotFoundException()
      }

      if (existing.blockedAt) {
        return existing
      }

      const [blocked] = await tx
        .update(installationLabels)
        .set({ blockedAt: new Date() })
        .where(eq(installationLabels.id, existing.id))
        .returning()

      return blocked
    })
  }

  /**
   * The label as a PDF, `format` `roll` for a label printer or `sheet` for a
   * sheet A4, `count` labels from field `start` of the sheet. Printed on every
   * request and kept nowhere.
   */
  @Get(':id/pdf')
  @RequiresPermission('installation.read')
  async print(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Param('id') id: string,
    @Query('format') formatParameter: string | undefined,
    @Query('count') countParameter: string | undefined,
    @Query('start') startParameter: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const format: LabelFormat | null =
      formatParameter === undefined || formatParameter === 'roll'
        ? 'roll'
        : formatParameter === 'sheet'
          ? 'sheet'
          : null

    if (!format) {
      throw new BadRequestException(
        'format ist roll für einen Etikettendrucker oder sheet für einen Bogen.',
      )
    }

    const count = whole(countParameter, 1)
    const start = whole(startParameter, 1)
    const problem = labelPrintProblem(format, count, start)

    if (problem) {
      throw new UnprocessableEntityException(problem)
    }

    const origin = this.origins[0]

    if (!origin) {
      throw new ServiceUnavailableException(
        'Diese Instanz kennt ihre Adresse nicht, TRUSTED_ORIGINS ist leer. Ohne sie weiß ein Etikett nicht, wohin es führt.',
      )
    }

    const facts = await this.database.forTenant(identity, (tx) =>
      labelFacts(tx, identity.tenantId, installationId, id),
    )

    if (facts.blocked) {
      throw new ConflictException('Ein gesperrtes Etikett wird nicht mehr gedruckt.')
    }

    let bytes: Uint8Array

    try {
      bytes = await this.render(labelPrintJob({ ...facts.print, origin, format, count, start }))
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="QR-Etikett.pdf"`,
      length: bytes.byteLength,
    })
  }
}

/**
 * What a label prints, read in one transaction. A label that is not there, or
 * belongs to another business or another installation, is not found.
 */
async function labelFacts(
  tx: TenantTransaction,
  tenantId: TenantId,
  installationId: string,
  id: string,
) {
  const installation = await openInstallation(tx, installationId, false)
  const label = installation ? await labelOf(tx, installation.id, id, false) : undefined

  if (!installation || !label) {
    throw new NotFoundException()
  }

  const [site] = await tx
    .select({ designation: sites.designation })
    .from(sites)
    .where(eq(sites.id, installation.siteId))
  const [letterhead] = await tx
    .select({ companyName: letterheads.companyName })
    .from(letterheads)
    .where(eq(letterheads.tenantId, tenantId))
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants)
  const business = letterhead?.companyName?.trim() || tenant?.name || ''

  return {
    blocked: label.blockedAt !== null,
    print: {
      business,
      installation: installation.designation,
      site: site?.designation ?? null,
      code: label.code,
    },
  }
}
