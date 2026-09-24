import {
  BadGatewayException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'
import { type FormRecordStatus, type IsoDate, readFormValues } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { Database } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import {
  formRecords,
  installations,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'
import { type Renderer, RendererUnavailableError } from '../documents/renderer.js'
import { addressLines, present } from '../documents/template.js'
import { protocolPrintJob, type PrintedProtocol } from '../forms/protocol-print.js'
import { tradeForms, tradeRules } from '../forms/registry.js'
import { RequiresPermission } from './authorization.js'
import { RENDERER } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The PDF of a filled form (#78), the test protocol of #79 first.
 *
 * Under the right of the installation it hangs on, like its circuit chart.
 * Printed on every request out of the record and kept nowhere: a signed
 * protocol does not change, and everything it depends on is in it.
 */
@Controller('form-records')
export class FormRecordsController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get(':id/pdf')
  @RequiresPermission('installation.read')
  async print(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(id)) {
      throw new NotFoundException()
    }

    const protocol = await this.database.forTenant(
      identity,
      async (tx): Promise<PrintedProtocol> => {
        const [record] = await tx
          .select()
          .from(formRecords)
          .where(and(eq(formRecords.id, id as never), isNull(formRecords.deletedAt)))
        const definition = record
          ? tradeForms.definitionFor(record.definitionKey, record.definitionVersion)
          : null

        if (!record || !definition) {
          throw new NotFoundException()
        }

        const [installation] = await tx
          .select()
          .from(installations)
          .where(eq(installations.id, record.installationId))
        const [site] = installation
          ? await tx.select().from(sites).where(eq(sites.id, installation.siteId))
          : []
        const [letterhead] = await tx
          .select({ companyName: letterheads.companyName, phone: letterheads.phone })
          .from(letterheads)
          .where(eq(letterheads.tenantId, identity.tenantId))
        const [tenant] = await tx.select({ name: tenants.name }).from(tenants)
        const companyName = letterhead?.companyName ?? null

        return {
          definition,
          values: readFormValues(record.values) ?? {},
          performedOn: record.performedOn as IsoDate,
          status: record.status as FormRecordStatus,
          keeper: {
            name: present(companyName) ? companyName : (tenant?.name ?? ''),
            phone: letterhead?.phone ?? null,
          },
          installation: installation?.designation ?? '',
          site: site
            ? [site.designation, ...addressLines(site, 'DE')].filter(present).join(', ')
            : '',
          rules: tradeRules,
        }
      },
    )

    let bytes: Uint8Array

    try {
      bytes = await this.render(protocolPrintJob(protocol))
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    const name =
      `${protocol.definition.title} ${protocol.installation} ${protocol.performedOn}.pdf`.replaceAll(
        /[/:*?"<>|]+/g,
        '-',
      )

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="Protokoll.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      length: bytes.byteLength,
    })
  }
}
