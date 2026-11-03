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
  acceptanceFormKey,
  acceptanceOf,
  berlinClock,
  type DefectStatus,
  defectStatusLabel,
  defectWarranty,
  defectWarrantyText,
  type IsoDate,
  type JobId,
  readFormValues,
  shippedRules,
  type WarrantyWindow,
  warrantyTerms,
} from '@opengewerk/domain'
import {
  addressLines,
  Database,
  isUuid,
  listColleagues,
  present,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import {
  attachments,
  attachmentVersions,
  customers,
  defects,
  defectSteps,
  formRecords,
  installations,
  jobs,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'
import { day } from '../forms/appliance-report.js'
import { type DefectReportPhoto, defectReportJob, momentText } from '../forms/defect-report.js'
import { DocumentFiles } from './document-files.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { pdf, safe } from './pv-documents.controller.js'

/** The photos a page can show. */
const photoTypes = ['image/jpeg', 'image/png', 'image/webp']

/** The warranty out of the last signed acceptance among these jobs, or null where there is none or it is refused. */
async function acceptedWarranty(
  tx: TenantTransaction,
  jobIds: readonly JobId[],
): Promise<WarrantyWindow | null> {
  if (jobIds.length === 0) {
    return null
  }

  const [last] = await tx
    .select({ performedOn: formRecords.performedOn, values: formRecords.values })
    .from(formRecords)
    .where(
      and(
        eq(formRecords.definitionKey, acceptanceFormKey),
        eq(formRecords.status, 'signed'),
        isNull(formRecords.deletedAt),
        inArray(formRecords.jobId, [...jobIds]),
      ),
    )
    .orderBy(desc(formRecords.performedOn), desc(formRecords.updatedAt), desc(formRecords.id))
    .limit(1)

  if (!last) {
    return null
  }

  const acceptedOn = last.performedOn as IsoDate
  const acceptance = acceptanceOf(readFormValues(last.values) ?? {})
  const terms = acceptance ? warrantyTerms(acceptedOn, acceptance, shippedRules) : null

  return terms ? { acceptedOn, endsOn: terms.whole.endsOn } : null
}

/**
 * The warranty a defect is measured against (#311): the job's, out of its
 * last signed acceptance; else the installation's, out of the last signed
 * acceptance of a job there or, where there is none, the end typed in.
 */
export async function warrantyWindow(
  tx: TenantTransaction,
  jobId: JobId | null,
  installationId: string | null,
): Promise<WarrantyWindow | null> {
  const ofJob = jobId ? await acceptedWarranty(tx, [jobId]) : null

  if (ofJob !== null || installationId === null) {
    return ofJob
  }

  const there = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.installationId, installationId as never), isNull(jobs.deletedAt)))
  const ofInstallation = await acceptedWarranty(
    tx,
    there.map((job) => job.id as JobId),
  )

  if (ofInstallation !== null) {
    return ofInstallation
  }

  const [installation] = await tx
    .select({ warrantyEndsOn: installations.warrantyEndsOn })
    .from(installations)
    .where(eq(installations.id, installationId as never))

  return installation?.warrantyEndsOn
    ? { acceptedOn: null, endsOn: installation.warrantyEndsOn as IsoDate }
    : null
}

/**
 * The report of the defects of a job (#311), as a PDF on the letterhead of
 * the business: every defect not removed, with its installation, origin,
 * customer's deadline and warranty, each step with who took it and when, the
 * customer's signature of an acceptance and the photos. Printed on every
 * request and kept nowhere.
 */
@Controller('jobs/:jobId')
export class DefectReportController {
  constructor(
    private readonly database: Database,
    private readonly files: DocumentFiles,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get('defect-report')
  @RequiresPermission('job.read')
  async report(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(jobId)) {
      throw new NotFoundException()
    }

    const on = todayInGermany()
    const colleagues = await listColleagues(this.database, identity)
    const nameOf = (userId: string | null) =>
      colleagues.find((colleague) => colleague.userId === userId)?.name ?? 'Jemand aus dem Betrieb'

    const gathered = await this.database.forTenant(identity, async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, jobId as JobId), isNull(jobs.deletedAt)))

      if (!job) {
        throw new NotFoundException()
      }

      const [customer] = await tx.select().from(customers).where(eq(customers.id, job.customerId))
      const [site] = job.siteId ? await tx.select().from(sites).where(eq(sites.id, job.siteId)) : []
      const [letterhead] = await tx
        .select()
        .from(letterheads)
        .where(eq(letterheads.tenantId, identity.tenantId))
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants)
      const companyName = letterhead?.companyName ?? null

      const rows = await tx
        .select()
        .from(defects)
        .where(and(eq(defects.jobId, job.id), isNull(defects.deletedAt)))
        .orderBy(asc(defects.reportedAt), asc(defects.id))
      const ids = rows.map((row) => row.id)
      const steps =
        ids.length === 0
          ? []
          : await tx
              .select()
              .from(defectSteps)
              .where(and(inArray(defectSteps.defectId, ids), isNull(defectSteps.deletedAt)))
              .orderBy(asc(defectSteps.takenAt), asc(defectSteps.id))
      const installationIds = [
        ...new Set(rows.map((row) => row.installationId).filter((id) => id !== null)),
      ]
      const named =
        installationIds.length === 0
          ? []
          : await tx
              .select({ id: installations.id, designation: installations.designation })
              .from(installations)
              .where(inArray(installations.id, installationIds))
      const acceptances =
        ids.length === 0
          ? []
          : await tx
              .select({ id: formRecords.id, performedOn: formRecords.performedOn })
              .from(formRecords)
              .where(
                inArray(
                  formRecords.id,
                  rows.map((row) => row.acceptanceRecordId).filter((id) => id !== null),
                ),
              )
      const photos =
        ids.length === 0
          ? []
          : await tx
              .select({
                id: attachments.id,
                defectId: attachments.defectId,
                title: attachments.title,
                fileName: attachmentVersions.fileName,
                mediaType: attachmentVersions.mediaType,
                sha256: attachmentVersions.sha256,
              })
              .from(attachments)
              .innerJoin(attachmentVersions, eq(attachmentVersions.attachmentId, attachments.id))
              .where(
                and(
                  inArray(attachments.defectId, ids),
                  isNull(attachments.deletedAt),
                  isNull(attachmentVersions.deletedAt),
                ),
              )
              .orderBy(asc(attachments.createdAt), desc(attachmentVersions.createdAt))
      const windows = new Map<string, WarrantyWindow | null>()

      for (const row of rows) {
        const key = `${String(row.installationId)}`

        if (!windows.has(key)) {
          windows.set(key, await warrantyWindow(tx, job.id as JobId, row.installationId))
        }
      }

      return {
        keeper: {
          name: present(companyName) ? companyName : (tenant?.name ?? ''),
          address: letterhead ? addressLines(letterhead, 'DE').join(', ') : '',
          phone: letterhead?.phone ?? null,
          email: letterhead?.email ?? null,
        },
        customer: customer?.name ?? '',
        job: { designation: job.designation, number: job.number },
        site: site
          ? [site.designation, ...addressLines(site, 'DE')].filter(present).join(', ')
          : null,
        rows,
        steps,
        named,
        acceptances,
        photos,
        windows,
      }
    })

    const newest = new Map<string, (typeof gathered.photos)[number]>()

    for (const photo of gathered.photos) {
      if (!newest.has(photo.id) && photoTypes.includes(photo.mediaType)) {
        newest.set(photo.id, photo)
      }
    }

    const bytes = new Map<string, DefectReportPhoto>()

    for (const photo of newest.values()) {
      bytes.set(photo.id, {
        title: photo.title,
        fileName: photo.fileName,
        mediaType: photo.mediaType,
        bytes: await this.files.read(photo.sha256),
      })
    }

    const entries = gathered.rows.map((row) => {
      const acceptedOn = gathered.acceptances.find(
        (record) => record.id === row.acceptanceRecordId,
      )?.performedOn
      const reportedOn = berlinClock(row.reportedAt).day
      const own = gathered.steps.filter((step) => step.defectId === row.id)
      const signed = own.find((step) => step.step === 'accepted')

      return {
        description: row.description,
        status: row.status as DefectStatus,
        installation:
          gathered.named.find((installation) => installation.id === row.installationId)
            ?.designation ?? null,
        origin: acceptedOn ? `Vorbehalt der Abnahme vom ${day(acceptedOn)}` : null,
        remedyDueOn: row.remedyDueOn as IsoDate | null,
        warranty: defectWarrantyText(
          defectWarranty(
            reportedOn,
            row.acceptanceRecordId !== null,
            gathered.windows.get(`${String(row.installationId)}`) ?? null,
          ),
        ),
        steps: [
          acceptedOn
            ? { label: defectStatusLabel.reported, who: 'aus der Abnahme', at: day(acceptedOn) }
            : {
                label: defectStatusLabel.reported,
                who: nameOf(row.createdBy),
                at: momentText(row.reportedAt),
              },
          ...own.map((step) => ({
            label: defectStatusLabel[step.step],
            who:
              step.step === 'accepted' && step.signerName
                ? step.signerName
                : nameOf(step.createdBy),
            at: momentText(step.takenAt),
          })),
        ],
        signature:
          signed?.signerName && signed.signaturePath
            ? {
                signer: signed.signerName,
                at: momentText(signed.takenAt),
                path: signed.signaturePath,
              }
            : null,
        photos: gathered.photos
          .filter((photo) => photo.defectId === row.id && newest.get(photo.id) === photo)
          .map((photo) => bytes.get(photo.id))
          .filter((photo) => photo !== undefined),
      }
    })

    let rendered: Uint8Array

    try {
      rendered = await this.render(
        defectReportJob(
          {
            keeper: gathered.keeper,
            customer: gathered.customer,
            job: gathered.job,
            site: gathered.site,
            defects: entries,
          },
          on,
        ),
        identity,
      )
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    return pdf(response, rendered, `Mängelbericht ${safe(gathered.job.designation)}`)
  }
}
