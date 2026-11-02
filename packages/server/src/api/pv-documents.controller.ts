import {
  BadGatewayException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'
import {
  type InstallationId,
  inStructureOrder,
  type IsoDate,
  readFormValues,
  type TenantId,
} from '@opengewerk/domain'
import {
  Database,
  isUuid,
  listColleagues,
  present,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import {
  formRecords,
  installations,
  inverters,
  pvHandovers,
  pvModules,
  pvStrings,
} from '../database/schema/index.js'
import { bound } from '../forms/inspection-report.js'
import { protocolPrintJob } from '../forms/protocol-print.js'
import {
  isPvHandoverContent,
  type PvComponent,
  type PvDossier,
  pvDocumentsJob,
  type PvHandoverContent,
  type PvHandoverProtocol,
  type PvStringRow,
} from '../forms/pv-documents.js'
import { tradeForms, tradeRules } from '../forms/registry.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { siteHead } from './site-reports.js'

/** A handover as the office lists it. */
export interface PvHandoverEntry {
  readonly id: string
  readonly handedOverOn: IsoDate
  readonly handedOverBy: string | null
  readonly protocols: number
}

/** A name as it may stand in a file name. */
function safe(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]+/g, '-')
}

function joined(...parts: readonly (string | null)[]): string | null {
  const said = parts.filter((part): part is string => present(part)).join(', ')

  return said === '' ? null : said
}

/**
 * The papers of a PV system as its structure stands (#305), or not found for
 * an installation that is no PV system, is not there or belongs to another
 * business: the same answer on purpose, as everywhere else.
 */
async function dossierOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  installationId: string,
): Promise<PvDossier> {
  if (!isUuid(installationId)) {
    throw new NotFoundException()
  }

  const [system] = await tx
    .select()
    .from(installations)
    .where(
      and(eq(installations.id, installationId as InstallationId), isNull(installations.deletedAt)),
    )

  if (system?.kind !== 'pv_system') {
    throw new NotFoundException()
  }

  const head = await siteHead(tx, tenantId, system.siteId)

  if (!head) {
    throw new NotFoundException()
  }

  const ownInverters = (
    await tx
      .select()
      .from(inverters)
      .where(and(eq(inverters.installationId, system.id), isNull(inverters.deletedAt)))
  ).sort(inStructureOrder)
  const strings =
    ownInverters.length === 0
      ? []
      : (
          await tx
            .select()
            .from(pvStrings)
            .where(
              and(
                inArray(
                  pvStrings.inverterId,
                  ownInverters.map((inverter) => inverter.id),
                ),
                isNull(pvStrings.deletedAt),
              ),
            )
        ).sort(inStructureOrder)
  const modules =
    strings.length === 0
      ? []
      : (
          await tx
            .select()
            .from(pvModules)
            .where(
              and(
                inArray(
                  pvModules.pvStringId,
                  strings.map((entry) => entry.id),
                ),
                isNull(pvModules.deletedAt),
              ),
            )
        ).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
  const companions = (
    await tx
      .select()
      .from(installations)
      .where(and(eq(installations.pvSystemId, system.id), isNull(installations.deletedAt)))
  ).sort((left, right) => left.designation.localeCompare(right.designation, 'de'))

  const rows: PvStringRow[] = []
  const moduleParts: PvComponent[] = []

  for (const inverter of ownInverters) {
    for (const entry of strings.filter((candidate) => candidate.inverterId === inverter.id)) {
      const own = modules.filter((module) => module.pvStringId === entry.id)

      rows.push({
        inverter: inverter.designation,
        inverterModel: joined(inverter.manufacturer, inverter.model),
        mppInput: entry.mppInput,
        designation: entry.designation,
        modules: own.length,
        ratedPowerW:
          own.length > 0 && own.every((module) => module.ratedPowerW !== null)
            ? own.reduce((sum, module) => sum + (module.ratedPowerW ?? 0), 0)
            : null,
        azimuthDeg: entry.azimuthDeg,
        tiltDeg: entry.tiltDeg,
      })
      own.forEach((module, index) => {
        moduleParts.push({
          kind: 'module',
          designation: `${entry.designation}, Modul ${String(index + 1)}`,
          maker: joined(module.manufacturer, module.model),
          serialNumber: module.serialNumber,
          ratedPowerW: module.ratedPowerW,
        })
      })
    }
  }

  const companionKinds = { battery: 'battery', meter: 'meter', wallbox: 'wallbox' } as const

  return {
    keeper: head.keeper,
    system: system.designation,
    site: head.site,
    customer: head.customer,
    forecast:
      system.yieldForecastKwh === null
        ? null
        : { kwh: system.yieldForecastKwh, source: system.yieldForecastSource },
    components: [
      ...ownInverters.map((inverter): PvComponent => ({
        kind: 'inverter',
        designation: inverter.designation,
        maker: joined(inverter.manufacturer, inverter.model),
        serialNumber: inverter.serialNumber,
        ratedPowerW: inverter.ratedPowerW,
      })),
      ...companions.flatMap((companion): PvComponent[] =>
        companion.kind === 'battery' || companion.kind === 'meter' || companion.kind === 'wallbox'
          ? [
              {
                kind: companionKinds[companion.kind],
                designation: companion.designation,
                maker: joined(companion.manufacturer, companion.model),
                serialNumber: companion.serialNumber,
                ratedPowerW: null,
              },
            ]
          : [],
      ),
      ...moduleParts,
    ],
    strings: rows,
  }
}

/**
 * The newest signed protocol of each form at the PV system and at what belongs
 * to it, a battery with its commissioning protocol among them: what the folder
 * holds behind its papers, those of the system first.
 */
async function protocolsOf(
  tx: TenantTransaction,
  systemId: string,
): Promise<readonly PvHandoverProtocol[]> {
  // The system itself, and everything that says it belongs to it.
  const subjects = await tx
    .select({ id: installations.id, designation: installations.designation })
    .from(installations)
    .where(and(eq(installations.id, systemId as InstallationId), isNull(installations.deletedAt)))
  const companions = await tx
    .select({ id: installations.id, designation: installations.designation })
    .from(installations)
    .where(
      and(
        eq(installations.pvSystemId, systemId as InstallationId),
        isNull(installations.deletedAt),
      ),
    )
  const named = new Map([...subjects, ...companions].map((entry) => [entry.id, entry.designation]))
  const records = await tx
    .select()
    .from(formRecords)
    .where(
      and(
        inArray(formRecords.installationId, [...named.keys()]),
        eq(formRecords.status, 'signed'),
        isNull(formRecords.deletedAt),
      ),
    )
    .orderBy(desc(formRecords.performedOn), desc(formRecords.updatedAt), desc(formRecords.id))
  const seen = new Set<string>()
  const held: PvHandoverProtocol[] = []

  for (const record of records) {
    const definition = tradeForms.definitionFor(record.definitionKey, record.definitionVersion)
    const key = `${record.installationId ?? ''} ${record.definitionKey}`

    if (definition && record.installationId !== null && !seen.has(key)) {
      seen.add(key)
      held.push({
        id: record.id,
        title: definition.title,
        installation: named.get(record.installationId) ?? '',
        performedOn: record.performedOn as IsoDate,
      })
    }
  }

  // The system's own first, then what belongs to it, each newest first.
  return [
    ...held.filter((protocol) => protocol.installation === named.get(systemId as InstallationId)),
    ...held.filter((protocol) => protocol.installation !== named.get(systemId as InstallationId)),
  ]
}

/**
 * The papers of a PV system for its operator (#305): "Stringplan und
 * Komponentenliste" as the structure stands, and the folder of each handover,
 * frozen that day.
 *
 * Under the installation and its rights: whoever may see the structure may
 * print it and read what was handed over, and whoever may change the
 * installation may hand it over. A handover is a row that is never changed:
 * the application may add one and read it and nothing else.
 */
@Controller('installations/:installationId')
export class PvDocumentsController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get('pv-plan')
  @RequiresPermission('installation.read')
  async plan(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const dossier = await this.database.forTenant(identity, (tx) =>
      dossierOf(tx, identity.tenantId, installationId),
    )
    const bytes = await this.printed(identity, [pvDocumentsJob(dossier, todayInGermany(), null)])

    return pdf(response, bytes, `Stringplan und Komponentenliste ${safe(dossier.system)}`)
  }

  @Get('handovers')
  @RequiresPermission('installation.read')
  async handovers(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
  ): Promise<readonly PvHandoverEntry[]> {
    if (!isUuid(installationId)) {
      throw new NotFoundException()
    }

    const rows = await this.database.forTenant(identity, (tx) =>
      tx
        .select()
        .from(pvHandovers)
        .where(eq(pvHandovers.installationId, installationId as InstallationId))
        .orderBy(desc(pvHandovers.handedOverOn), desc(pvHandovers.createdAt)),
    )

    return rows.map((row) => {
      const content = isPvHandoverContent(row.content) ? row.content : null

      return {
        id: row.id,
        handedOverOn: row.handedOverOn as IsoDate,
        handedOverBy: content?.handedOverBy ?? null,
        protocols: content?.protocols.length ?? 0,
      }
    })
  }

  /**
   * Hands the papers over today: what the structure says now, and the newest
   * signed protocol of each form at the system and what belongs to it, kept as
   * they are. Nothing done to the system later reaches this folder.
   */
  @Post('handovers')
  @RequiresPermission('installation.write')
  async handOver(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
  ): Promise<PvHandoverEntry> {
    const colleagues = await listColleagues(this.database, identity)
    const by = colleagues.find((colleague) => colleague.userId === identity.userId)?.name ?? null
    const on = todayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const dossier = await dossierOf(tx, identity.tenantId, installationId)
      const content: PvHandoverContent = {
        ...dossier,
        protocols: await protocolsOf(tx, installationId),
        handedOverBy: by,
      }
      const [row] = await tx
        .insert(pvHandovers)
        .values({
          tenantId: identity.tenantId,
          installationId: installationId as InstallationId,
          handedOverOn: on,
          content,
          createdBy: identity.userId ?? null,
        })
        .returning({ id: pvHandovers.id })

      if (!row) {
        throw new Error('The handover was not written.')
      }

      return { id: row.id, handedOverOn: on, handedOverBy: by, protocols: content.protocols.length }
    })
  }

  @Get('handovers/:handoverId/pdf')
  @RequiresPermission('installation.read')
  async folder(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Param('handoverId') handoverId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(installationId) || !isUuid(handoverId)) {
      throw new NotFoundException()
    }

    const found = await this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .select()
        .from(pvHandovers)
        .where(
          and(
            eq(pvHandovers.id, handoverId as never),
            eq(pvHandovers.installationId, installationId as InstallationId),
          ),
        )

      if (!row || !isPvHandoverContent(row.content)) {
        throw new NotFoundException()
      }

      const ids = row.content.protocols.map((protocol) => protocol.id)
      const records =
        ids.length === 0
          ? []
          : await tx
              .select()
              .from(formRecords)
              .where(and(inArray(formRecords.id, ids as never[]), eq(formRecords.status, 'signed')))

      return { row, content: row.content, records }
    })
    const { content } = found
    const on = found.row.handedOverOn as IsoDate
    const jobs = [pvDocumentsJob(content, on, { protocols: content.protocols })]

    // In the order the folder names them; a signed protocol never changes.
    for (const protocol of content.protocols) {
      const record = found.records.find((entry) => entry.id === protocol.id)
      const definition = record
        ? tradeForms.definitionFor(record.definitionKey, record.definitionVersion)
        : null

      if (record && definition) {
        jobs.push(
          protocolPrintJob({
            definition,
            values: readFormValues(record.values) ?? {},
            performedOn: record.performedOn as IsoDate,
            status: 'signed',
            keeper: content.keeper,
            installation: protocol.installation,
            appliance: null,
            site: content.site,
            rules: tradeRules,
          }),
        )
      }
    }

    const bytes = await this.printed(identity, jobs)

    return pdf(response, bytes, `Unterlagen ${safe(content.system)} ${on}`)
  }

  /** The pages one after another, bound into one PDF: the renderer of an instance is a single browser. */
  private async printed(
    identity: RequestIdentity,
    jobs: readonly Parameters<Renderer>[0][],
  ): Promise<Uint8Array> {
    try {
      const parts: Uint8Array[] = []

      for (const job of jobs) {
        parts.push(await this.render(job, identity))
      }

      return parts.length === 1 && parts[0] ? parts[0] : await bound(parts, 'Unterlagen')
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }
  }
}

function pdf(response: Response, bytes: Uint8Array, name: string): StreamableFile {
  response.setHeader('Cache-Control', 'no-store')

  return new StreamableFile(Buffer.from(bytes), {
    type: 'application/pdf',
    disposition: `inline; filename="Unterlagen.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`,
    length: bytes.byteLength,
  })
}
