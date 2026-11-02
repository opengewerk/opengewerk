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

import { bound, type InspectionReport, inspectionReportJob } from '../forms/inspection-report.js'
import { protocolPrintJob } from '../forms/protocol-print.js'
import { tradeRules } from '../forms/registry.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { reportedAppliances, reportedInstallations, siteHead } from './site-reports.js'

/**
 * The test of the electrical installation of a site (#302), as one PDF: the
 * report with the result of the whole and a line for each installation and
 * appliance, then the last protocol of each installation as it prints on its
 * own. Under the right of the installations, like the protocols it is made
 * of, and printed on every request, kept nowhere.
 */
@Controller('sites/:siteId/inspection-report')
export class InspectionReportController {
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

    const report = await this.database.forTenant(
      identity,
      async (tx): Promise<InspectionReport> => {
        const head = await siteHead(tx, identity.tenantId, siteId)

        if (!head) {
          throw new NotFoundException()
        }

        return {
          ...head,
          installations: await reportedInstallations(tx, siteId),
          appliances: await reportedAppliances(tx, siteId),
        }
      },
    )
    const name = `Prüfung der Elektroinstallation ${report.site} ${report.on}`.replaceAll(
      /[/:*?"<>|]+/g,
      '-',
    )

    let bytes: Uint8Array

    try {
      const parts = [await this.render(inspectionReportJob(report), identity)]

      // One after another: the renderer of an instance is a single browser.
      for (const entry of report.installations) {
        if (entry.last) {
          parts.push(
            await this.render(
              protocolPrintJob({
                ...entry.last,
                status: 'signed',
                keeper: report.keeper,
                installation: entry.designation,
                appliance: null,
                site: report.site,
                rules: tradeRules,
              }),
              identity,
            ),
          )
        }
      }

      bytes = await bound(parts, name)
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="Pruefung.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`,
      length: bytes.byteLength,
    })
  }
}
