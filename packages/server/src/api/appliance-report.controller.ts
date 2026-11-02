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
import {
  Database,
  isUuid,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import type { Response } from 'express'

import { type ApplianceReport, applianceReportJob } from '../forms/appliance-report.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { reportedAppliances, siteHead } from './site-reports.js'

/**
 * The report of a site after DGUV Vorschrift 3 (#303), as a PDF: every
 * appliance of its register with its last signed test. Under the right of
 * the installations, like the protocols it is made of.
 */
@Controller('sites/:siteId/appliance-report')
export class ApplianceReportController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get()
  @RequiresPermission('installation.read')
  async print(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('siteId') siteId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(siteId)) {
      throw new NotFoundException()
    }

    const report = await this.database.forTenant(identity, async (tx): Promise<ApplianceReport> => {
      const head = await siteHead(tx, identity.tenantId, siteId)

      if (!head) {
        throw new NotFoundException()
      }

      return { ...head, appliances: await reportedAppliances(tx, siteId) }
    })

    let bytes: Uint8Array

    try {
      bytes = await this.render(applianceReportJob(report), identity)
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    const name = `Prüfbericht DGUV V3 ${report.site} ${report.on}.pdf`.replaceAll(
      /[/:*?"<>|]+/g,
      '-',
    )

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="Pruefbericht.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      length: bytes.byteLength,
    })
  }
}
