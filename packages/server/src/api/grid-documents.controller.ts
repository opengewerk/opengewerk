import {
  BadGatewayException,
  ConflictException,
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
  type GridOperatorId,
  type InstallationId,
  inStructureOrder,
  type IsoDate,
  readFormValues,
  registrationFor,
  reportsToGridOperator,
  type TenantId,
} from '@opengewerk/domain'
import {
  addressLines,
  Database,
  isUuid,
  present,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import {
  customers,
  formRecords,
  gridOperators,
  installations,
  inverters,
  letterheads,
  pvModules,
  pvStrings,
  sites,
  tenants,
} from '../database/schema/index.js'
import {
  type GridPapers,
  type GridPart,
  gridPaperJob,
  marketRegisterDueOn,
  marketRegisterJob,
  totalPower,
} from '../forms/grid-documents.js'
import { bound } from '../forms/inspection-report.js'
import { protocolPrintJob } from '../forms/protocol-print.js'
import { tradeForms, tradeRules } from '../forms/registry.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { pdf, safe } from './pv-documents.controller.js'

/** The grid operator of an installation as its card shows it. */
export interface InstallationGridOperator {
  readonly operator: {
    readonly id: string
    readonly name: string
    readonly portalUrl: string | null
  } | null
  readonly reference: string | null
}

function maker(part: { readonly manufacturer: string | null; readonly model: string | null }) {
  const said = [part.manufacturer, part.model].filter(present).join(' ')

  return said === '' ? null : said
}

/** The newest signed commissioning protocol of each installation, by its key. */
async function commissioningOf(
  tx: TenantTransaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, typeof formRecords.$inferSelect>> {
  if (ids.length === 0) {
    return new Map()
  }

  const records = await tx
    .select()
    .from(formRecords)
    .where(
      and(
        inArray(formRecords.installationId, ids as InstallationId[]),
        eq(formRecords.status, 'signed'),
        isNull(formRecords.deletedAt),
      ),
    )
    .orderBy(desc(formRecords.performedOn), desc(formRecords.updatedAt), desc(formRecords.id))
  const newest = new Map<string, typeof formRecords.$inferSelect>()

  for (const record of records) {
    const definition = tradeForms.definitionFor(record.definitionKey, record.definitionVersion)

    if (
      definition?.purpose === 'commissioning' &&
      record.installationId !== null &&
      !newest.has(record.installationId)
    ) {
      newest.set(record.installationId, record)
    }
  }

  return newest
}

/** What the papers print, and the protocols the completion binds behind them. */
interface Gathered {
  readonly papers: GridPapers
  readonly protocols: readonly (typeof formRecords.$inferSelect)[]
  readonly keeper: { readonly name: string; readonly phone: string | null }
}

/**
 * The papers of an installation that is reported to a grid operator (#306):
 * a PV system with what belongs to it, or a battery or wallbox of its own.
 * Not found for anything else, for one that is not there, and for one of
 * another business: the same answer on purpose, as everywhere else.
 */
async function papersOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  installationId: string,
  on: IsoDate,
): Promise<Gathered> {
  if (!isUuid(installationId)) {
    throw new NotFoundException()
  }

  const [installation] = await tx
    .select()
    .from(installations)
    .where(
      and(eq(installations.id, installationId as InstallationId), isNull(installations.deletedAt)),
    )

  if (!installation || !reportsToGridOperator(installation.kind, installation.pvSystemId)) {
    throw new NotFoundException()
  }

  const [site] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.id, installation.siteId), isNull(sites.deletedAt)))

  if (!site) {
    throw new NotFoundException()
  }

  const [customer] = await tx.select().from(customers).where(eq(customers.id, site.customerId))
  const [letterhead] = await tx.select().from(letterheads).where(eq(letterheads.tenantId, tenantId))
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants)
  const operators = await tx.select().from(gridOperators).where(isNull(gridOperators.deletedAt))
  const operator = operators.find((entry) => entry.id === installation.gridOperatorId) ?? null
  const registration = registrationFor(
    operators.map((entry) => ({
      ...entry,
      registeredUntil: entry.registeredUntil as IsoDate | null,
    })),
    installation.gridOperatorId as GridOperatorId | null,
    on,
  )

  const ownInverters =
    installation.kind === 'pv_system'
      ? (
          await tx
            .select()
            .from(inverters)
            .where(and(eq(inverters.installationId, installation.id), isNull(inverters.deletedAt)))
        ).sort(inStructureOrder)
      : []
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
      : await tx
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
  const companions =
    installation.kind === 'pv_system'
      ? (
          await tx
            .select()
            .from(installations)
            .where(
              and(eq(installations.pvSystemId, installation.id), isNull(installations.deletedAt)),
            )
        ).sort((left, right) => left.designation.localeCompare(right.designation, 'de'))
      : []
  const batteries = companions.filter((entry) => entry.kind === 'battery')
  const commissioning = await commissioningOf(tx, [
    installation.id,
    ...batteries.map((entry) => entry.id),
  ])
  const commissionedOf = (entry: typeof installation): IsoDate | null =>
    (commissioning.get(entry.id)?.performedOn as IsoDate | undefined) ??
    (entry.commissionedOn as IsoDate | null)
  const part = (entry: typeof installation): GridPart => ({
    designation: entry.designation,
    maker: maker(entry),
    serialNumber: entry.serialNumber,
    ratedPowerW: null,
    inverter:
      ownInverters.find((inverter) => inverter.id === entry.inverterId)?.designation ?? null,
    commissionedOn: commissionedOf(entry),
  })
  const makers = new Map<string, number>()

  for (const module of modules) {
    const said = maker(module)

    if (said !== null) {
      makers.set(said, (makers.get(said) ?? 0) + 1)
    }
  }

  const companyName = letterhead?.companyName ?? null
  const keeper = {
    name: present(companyName) ? companyName : (tenant?.name ?? ''),
    phone: letterhead?.phone ?? null,
  }
  const protocols = [installation, ...batteries].flatMap((entry) => {
    const record = commissioning.get(entry.id)
    return record ? [{ record, installation: entry.designation }] : []
  })

  return {
    keeper,
    protocols: protocols.map((entry) => entry.record),
    papers: {
      keeper: {
        ...keeper,
        address: letterhead ? addressLines(letterhead, 'DE').join(', ') : '',
        email: letterhead?.email ?? null,
      },
      customer: {
        name: customer?.name ?? '',
        address: customer ? addressLines(customer, 'DE').join(', ') : '',
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
        naturalPerson: customer?.kind === 'private',
        vatId: customer?.vatId ?? null,
      },
      site: { designation: site.designation, address: addressLines(site, 'DE').join(', ') },
      installation: {
        kind: installation.kind,
        designation: installation.designation,
        maker: maker(installation),
        serialNumber: installation.serialNumber,
      },
      operator:
        operator === null
          ? null
          : {
              name: operator.name,
              portalUrl: operator.portalUrl,
              requirements: operator.requirements,
            },
      reference: installation.gridOperatorReference,
      registration:
        registration === null || registration.registrationNumber === null
          ? null
          : {
              operator: registration.name,
              number: registration.registrationNumber,
              until: registration.registeredUntil,
              electrician: registration.responsibleElectrician,
            },
      modules: {
        count: modules.length,
        makers: [...makers.keys()],
        ratedPowerW: totalPower(modules),
      },
      inverters: ownInverters.map((inverter) => ({
        designation: inverter.designation,
        maker: maker(inverter),
        serialNumber: inverter.serialNumber,
        ratedPowerW: inverter.ratedPowerW,
        inverter: null,
        commissionedOn: null,
      })),
      batteries: batteries.map(part),
      meters: companions.filter((entry) => entry.kind === 'meter').map(part),
      wallboxes: companions.filter((entry) => entry.kind === 'wallbox').map(part),
      strings: strings.map((entry) => {
        const own = modules.filter((module) => module.pvStringId === entry.id)

        return {
          azimuthDeg: entry.azimuthDeg,
          tiltDeg: entry.tiltDeg,
          modules: own.length,
          ratedPowerW: totalPower(own),
        }
      }),
      commissionedOn: commissionedOf(installation),
      protocols: protocols.map((entry) => ({
        title:
          tradeForms.definitionFor(entry.record.definitionKey, entry.record.definitionVersion)
            ?.title ?? '',
        installation: entry.installation,
        performedOn: entry.record.performedOn as IsoDate,
      })),
    },
  }
}

/**
 * The papers of an installation for its grid operator and the help for the
 * Marktstammdatenregister (#306): "Anmeldung", "Fertigmeldung" with the signed
 * commissioning protocols behind it, and "Ausfüllhilfe".
 *
 * Under the installation and its rights: whoever may see it prints them, and
 * reads the name of its grid operator, without the right to the list of grid
 * operators. The application and the completion need a grid operator to go
 * to; the help for the register does not, it names none then.
 */
@Controller('installations/:installationId')
export class GridDocumentsController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get('grid-operator')
  @RequiresPermission('installation.read')
  async gridOperator(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
  ): Promise<InstallationGridOperator> {
    if (!isUuid(installationId)) {
      throw new NotFoundException()
    }

    return this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .select({
          reference: installations.gridOperatorReference,
          id: gridOperators.id,
          name: gridOperators.name,
          portalUrl: gridOperators.portalUrl,
        })
        .from(installations)
        .leftJoin(gridOperators, eq(gridOperators.id, installations.gridOperatorId))
        .where(
          and(
            eq(installations.id, installationId as InstallationId),
            isNull(installations.deletedAt),
          ),
        )

      if (!row) {
        throw new NotFoundException()
      }

      return {
        operator:
          row.id === null || row.name === null
            ? null
            : { id: row.id, name: row.name, portalUrl: row.portalUrl },
        reference: row.reference,
      }
    })
  }

  @Get('grid-application')
  @RequiresPermission('installation.read')
  async application(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const on = todayInGermany()
    const { papers } = await this.gathered(identity, installationId, on, true)
    const bytes = await this.printed(identity, [gridPaperJob(papers, false, on)])

    return pdf(response, bytes, `Anmeldung ${safe(papers.installation.designation)}`)
  }

  @Get('grid-completion')
  @RequiresPermission('installation.read')
  async completion(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const on = todayInGermany()
    const { papers, protocols, keeper } = await this.gathered(identity, installationId, on, true)
    const jobs: Parameters<Renderer>[0][] = [gridPaperJob(papers, true, on)]

    // Behind the sheet the signed commissioning protocols, as each prints on its own.
    protocols.forEach((record, index) => {
      const definition = tradeForms.definitionFor(record.definitionKey, record.definitionVersion)

      if (definition) {
        jobs.push(
          protocolPrintJob({
            definition,
            values: readFormValues(record.values) ?? {},
            performedOn: record.performedOn as IsoDate,
            status: 'signed',
            keeper,
            installation: papers.protocols[index]?.installation ?? papers.installation.designation,
            appliance: null,
            site: [papers.site.designation, papers.site.address].filter(present).join(', '),
            rules: tradeRules,
          }),
        )
      }
    })

    const bytes = await this.printed(identity, jobs)

    return pdf(response, bytes, `Fertigmeldung ${safe(papers.installation.designation)}`)
  }

  /** The help for the register, for a PV system and a battery of its own; a wallbox is no unit it registers. */
  @Get('market-register')
  @RequiresPermission('installation.read')
  async marketRegister(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const on = todayInGermany()
    const { papers } = await this.gathered(identity, installationId, on, false)

    if (papers.installation.kind === 'wallbox') {
      throw new NotFoundException()
    }

    const dueOn = marketRegisterDueOn(papers.commissionedOn, tradeRules)
    const bytes = await this.printed(identity, [marketRegisterJob(papers, dueOn, on)])

    return pdf(
      response,
      bytes,
      `Ausfüllhilfe Marktstammdatenregister ${safe(papers.installation.designation)}`,
    )
  }

  private async gathered(
    identity: RequestIdentity,
    installationId: string,
    on: IsoDate,
    needsOperator: boolean,
  ): Promise<Gathered> {
    const gathered = await this.database.forTenant(identity, (tx) =>
      papersOf(tx, identity.tenantId, installationId, on),
    )

    if (needsOperator && gathered.papers.operator === null) {
      throw new ConflictException(
        'Die Anlage nennt noch keinen Netzbetreiber. Unter „Bearbeiten“ lässt er sich wählen.',
      )
    }

    return gathered
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
