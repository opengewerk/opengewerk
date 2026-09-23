import {
  BadGatewayException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'
import { type InstallationId, inStructureOrder, type TenantId } from '@opengewerk/domain'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { Database, type TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import {
  boardSections,
  circuits,
  distributionBoards,
  installations,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'
import { type Renderer, RendererUnavailableError } from '../documents/renderer.js'
import { addressLines, present } from '../documents/template.js'
import { type ChartBoard, type CircuitChart, circuitChartJob } from '../electrical/circuit-chart.js'
import { RequiresPermission } from './authorization.js'
import { RENDERER } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { todayInGermany } from '../today.js'

/** A name as it may stand in a file name. A board called `UV 1/2` is one. */
function safe(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]+/g, '-')
}

/**
 * The circuit chart of an installation, for the door of its boards.
 *
 * Under the installation, because it is a way of reading the installation and
 * not a thing of its own, and under its right: whoever may see the structure
 * may print it. Printed on every request and kept nowhere. Unlike a document
 * it records no act, it shows the structure as it stands, and a chart kept
 * from yesterday would be one that is already wrong.
 *
 * `board` narrows it to one board, the one whose door it is for. Without it
 * every board of the installation comes out, one to a page.
 */
@Controller('installations/:installationId/circuit-chart')
export class CircuitChartController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get()
  @RequiresPermission('installation.read')
  async print(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('installationId') installationId: string,
    @Query('board') board: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const chart = await this.database.forTenant(identity, (tx) =>
      chartOf(tx, identity.tenantId, installationId, board),
    )

    let bytes: Uint8Array

    try {
      bytes = await this.render(circuitChartJob(chart))
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    const only = board === undefined ? null : chart.boards[0]
    const name = `Stromkreisverzeichnis ${safe(only ? only.designation : chart.installation)}.pdf`

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="Stromkreisverzeichnis.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      length: bytes.byteLength,
    })
  }
}

/**
 * Everything the chart prints, read in one transaction so that it is one
 * state of the structure and not two.
 *
 * Only what is not marked as deleted. An installation that is not there, or
 * belongs to another business, is not found, and neither is a board that is
 * not one of its own: the same answer on purpose, as everywhere else.
 */
async function chartOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  installationId: string,
  board: string | undefined,
): Promise<CircuitChart> {
  if (!isUuid(installationId) || (board !== undefined && !isUuid(board))) {
    throw new NotFoundException()
  }

  const [installation] = await tx
    .select()
    .from(installations)
    .where(
      and(eq(installations.id, installationId as InstallationId), isNull(installations.deletedAt)),
    )

  if (!installation) {
    throw new NotFoundException()
  }

  const [site] = await tx.select().from(sites).where(eq(sites.id, installation.siteId))
  const [letterhead] = await tx
    .select({ companyName: letterheads.companyName, phone: letterheads.phone })
    .from(letterheads)
    .where(eq(letterheads.tenantId, tenantId))
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants)

  const boards = (
    await tx
      .select()
      .from(distributionBoards)
      .where(
        and(
          eq(distributionBoards.installationId, installation.id),
          isNull(distributionBoards.deletedAt),
          ...(board === undefined ? [] : [eq(distributionBoards.id, board as never)]),
        ),
      )
  ).sort(inStructureOrder)

  if (board !== undefined && boards.length === 0) {
    throw new NotFoundException()
  }

  const ids = boards.map((row) => row.id)
  const sections =
    ids.length === 0
      ? []
      : (
          await tx
            .select()
            .from(boardSections)
            .where(
              and(inArray(boardSections.distributionBoardId, ids), isNull(boardSections.deletedAt)),
            )
        ).sort(inStructureOrder)
  const lines =
    ids.length === 0
      ? []
      : (
          await tx
            .select()
            .from(circuits)
            .where(and(inArray(circuits.distributionBoardId, ids), isNull(circuits.deletedAt)))
        ).sort(inStructureOrder)

  const printed: ChartBoard[] = boards.map((row) => {
    const own = sections.filter((section) => section.distributionBoardId === row.id)
    const onBoard = lines.filter((circuit) => circuit.distributionBoardId === row.id)
    // A circuit whose section is gone hangs on the board directly. The
    // migration empties the column when a section is removed for real, and
    // one that is only marked is left out of `own`.
    const known = new Set(own.map((section) => section.id))
    const direct = onBoard.filter(
      (circuit) => circuit.boardSectionId === null || !known.has(circuit.boardSectionId),
    )
    const changed = [row, ...own, ...onBoard].reduce(
      (latest, part) => (part.updatedAt > latest ? part.updatedAt : latest),
      row.updatedAt,
    )

    return {
      designation: row.designation,
      kind: row.kind,
      location: row.location,
      changedOn: todayInGermany(changed),
      groups: [
        ...(direct.length > 0 || own.length === 0 ? [{ section: null, circuits: direct }] : []),
        ...own.map((section) => ({
          section: section.designation,
          circuits: onBoard.filter((circuit) => circuit.boardSectionId === section.id),
        })),
      ],
    }
  })

  const place = site
    ? [site.designation, ...addressLines(site, 'DE')].filter(present).join(', ')
    : ''
  // The name on the letterhead, and the one the business was set up with
  // while that is empty, the same as on every document.
  const companyName = letterhead?.companyName ?? null

  return {
    keeper: {
      name: present(companyName) ? companyName : (tenant?.name ?? ''),
      phone: letterhead?.phone ?? null,
    },
    installation: installation.designation,
    site: place,
    boards: printed,
  }
}
