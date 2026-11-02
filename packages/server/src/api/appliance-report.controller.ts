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
import { type IsoDate, readFormValues, type SiteId } from '@opengewerk/domain'
import {
  addressLines,
  Database,
  isUuid,
  present,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import {
  appliances,
  customers,
  formRecords,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'
import {
  type ApplianceReport,
  applianceReportJob,
  type LastTest,
} from '../forms/appliance-report.js'
import { tradeForms } from '../forms/registry.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** Inventory numbers as a person counts them: 9 before 10. */
const byNumber = new Intl.Collator('de', { numeric: true })

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
      const [site] = await tx
        .select()
        .from(sites)
        .where(and(eq(sites.id, siteId as SiteId), isNull(sites.deletedAt)))

      if (!site) {
        throw new NotFoundException()
      }

      const [customer] = await tx
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.id, site.customerId))
      const register = await tx
        .select()
        .from(appliances)
        .where(and(eq(appliances.siteId, site.id), isNull(appliances.deletedAt)))
      const records =
        register.length === 0
          ? []
          : await tx
              .select()
              .from(formRecords)
              .where(
                and(
                  inArray(
                    formRecords.applianceId,
                    register.map((entry) => entry.id),
                  ),
                  eq(formRecords.status, 'signed'),
                  isNull(formRecords.deletedAt),
                ),
              )
              .orderBy(
                desc(formRecords.performedOn),
                desc(formRecords.updatedAt),
                desc(formRecords.id),
              )
      const lastOf = new Map<string, LastTest>()

      // The newest signed test of each appliance in a form this version reads.
      for (const record of records) {
        const definition = tradeForms.definitionFor(record.definitionKey, record.definitionVersion)

        if (
          record.applianceId !== null &&
          definition?.attachesTo === 'appliance' &&
          !lastOf.has(record.applianceId)
        ) {
          lastOf.set(record.applianceId, {
            definition,
            values: readFormValues(record.values) ?? {},
            performedOn: record.performedOn as IsoDate,
          })
        }
      }

      const [letterhead] = await tx
        .select({ companyName: letterheads.companyName, phone: letterheads.phone })
        .from(letterheads)
        .where(eq(letterheads.tenantId, identity.tenantId))
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants)
      const companyName = letterhead?.companyName ?? null

      return {
        keeper: {
          name: present(companyName) ? companyName : (tenant?.name ?? ''),
          phone: letterhead?.phone ?? null,
        },
        site: [site.designation, ...addressLines(site, 'DE')].filter(present).join(', '),
        customer: customer?.name ?? '',
        on: todayInGermany(),
        appliances: [...register]
          .sort(
            (left, right) =>
              // Without a number last, the others as a person counts them.
              Number(left.inventoryNumber === null) - Number(right.inventoryNumber === null) ||
              byNumber.compare(left.inventoryNumber ?? '', right.inventoryNumber ?? '') ||
              byNumber.compare(left.designation, right.designation),
          )
          .map((appliance) => ({ appliance, last: lastOf.get(appliance.id) ?? null })),
      }
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
