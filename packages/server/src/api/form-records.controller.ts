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
  acceptanceOf,
  applianceSubject,
  type FormRecordStatus,
  type IsoDate,
  readFormValues,
  shippedRules,
  warrantyTerms,
  yearsText,
} from '@opengewerk/domain'
import {
  addressLines,
  Database,
  isUuid,
  present,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import {
  appliances,
  formRecords,
  installations,
  jobs,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'
import { protocolPrintJob, type PrintedProtocol } from '../forms/protocol-print.js'
import { tradeForms, tradeRules } from '../forms/registry.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** "Gewährleistung bis 05.11.2031: fünf Jahre ab der Abnahme (§ 634a Abs. 1 Nr. 2 BGB)." and the parts, where they end sooner (#310). */
export function warrantyNotes(
  values: Parameters<typeof acceptanceOf>[0],
  acceptedOn: IsoDate,
): readonly string[] {
  const acceptance = acceptanceOf(values)
  const terms = acceptance ? warrantyTerms(acceptedOn, acceptance, shippedRules) : null
  const day = (on: IsoDate) => `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`

  if (acceptance?.result === 'refused') {
    return ['Abnahme verweigert: die Gewährleistung beginnt nicht.']
  }

  return terms === null
    ? []
    : [
        `Gewährleistung bis ${day(terms.whole.endsOn)}: ${yearsText(terms.whole.years)} ab der Abnahme (${terms.whole.source}).`,
        ...(terms.parts === null
          ? []
          : [
              `Für wartungsbedürftige Teile ohne übertragene Wartung bis ${day(terms.parts.endsOn)}: ${yearsText(terms.parts.years)} (${terms.parts.source}).`,
            ]),
      ]
}

/**
 * The PDF of a filled form (#78), the test protocol of #79 first.
 *
 * Under the right of the installation it hangs on, like its circuit chart;
 * the test of an appliance of the register under the same (#303).
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

        const [installation] = record.installationId
          ? await tx.select().from(installations).where(eq(installations.id, record.installationId))
          : []
        const [appliance] = record.applianceId
          ? await tx.select().from(appliances).where(eq(appliances.id, record.applianceId))
          : []
        // A form of a job alone is its acceptance (#310): the job is what it is about.
        const [job] =
          !record.installationId && !record.applianceId && record.jobId
            ? await tx.select().from(jobs).where(eq(jobs.id, record.jobId))
            : []
        const siteId = installation?.siteId ?? appliance?.siteId ?? job?.siteId
        const [site] = siteId ? await tx.select().from(sites).where(eq(sites.id, siteId)) : []
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
          installation:
            installation?.designation ??
            (appliance
              ? applianceSubject(appliance)
              : job
                ? [job.designation, job.number].filter(present).join(', ')
                : ''),
          appliance: appliance
            ? {
                protectionClass: appliance.protectionClass,
                cordLengthMilli: appliance.cordLengthMilli,
              }
            : null,
          site: site
            ? [site.designation, ...addressLines(site, 'DE')].filter(present).join(', ')
            : '',
          rules: tradeRules,
          notes:
            definition.purpose === 'acceptance'
              ? warrantyNotes(readFormValues(record.values) ?? {}, record.performedOn as IsoDate)
              : [],
        }
      },
    )

    let bytes: Uint8Array

    try {
      bytes = await this.render(protocolPrintJob(protocol), identity)
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
