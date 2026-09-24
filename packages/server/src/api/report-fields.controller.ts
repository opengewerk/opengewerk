import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common'
import {
  normalizedReportFields,
  reportDefinition,
  reportDefinitionKey,
  type ReportField,
  reportFieldsOf,
  reportFieldsProblems,
} from '@opengewerk/domain'

import { Database } from '../database/database.js'
import { formDefinitions } from '../database/schema/index.js'
import { currentReportDefinition } from '../forms/report-fields.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The fields a business gives its reports (#78), under "Einstellungen".
 *
 * Saving writes the next version and edits nothing: a report started before
 * keeps the version it was started with, and is signed, frozen and printed
 * with it. The same fields saved again are no new version. Devices get the
 * versions through the sync, since they fill the fields in without a network.
 */
@Controller('settings/report-fields')
export class ReportFieldsController {
  constructor(private readonly database: Database) {}

  /** The fields a report started now gets. Wrapped, so that none is a body too. */
  @Get()
  @RequiresPermission('settings.read')
  async current(@CurrentIdentity() identity: RequestIdentity) {
    return {
      definition: await this.database.forTenant(identity, (tx) => currentReportDefinition(tx)),
    }
  }

  @Put()
  @RequiresPermission('settings.write')
  async save(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const fields = (body as { fields?: unknown } | null)?.fields
    const [problem] = reportFieldsProblems(fields)

    if (problem !== undefined) {
      throw new BadRequestException(problem)
    }

    const wanted = normalizedReportFields(fields as readonly ReportField[])

    return this.database.forTenant(identity, async (tx) => {
      const current = await currentReportDefinition(tx)

      if (current && JSON.stringify(reportFieldsOf(current)) === JSON.stringify(wanted)) {
        return { definition: current }
      }

      const next = reportDefinition((current?.version ?? 0) + 1, wanted)

      await tx.insert(formDefinitions).values({
        tenantId: identity.tenantId,
        key: reportDefinitionKey,
        definitionVersion: next.version,
        definition: JSON.stringify(next),
      })

      return { definition: next }
    })
  }
}
