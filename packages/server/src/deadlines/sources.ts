import {
  acceptanceFormKey,
  addDays,
  acceptanceOf,
  applianceLabel,
  berlinClock,
  type CustomerId,
  qualificationCatalogue,
  type DeadlineSource,
  type DocumentId,
  type FormDefinition,
  installationDueOn,
  type InstallationId,
  type IsoDate,
  type JobId,
  lastNoticeDay,
  lastServiceDay,
  nextInspectionField,
  nextInspectionOn,
  nextPeriod,
  nextVisitOn,
  type PaymentRhythm,
  prospectErasureLabel,
  customerErasureDueOn,
  customerErasureLabel,
  readFormValues,
  type SignedTest,
  shippedRules,
  type SiteId,
  termEndOn,
  warrantyTerms,
} from '@opengewerk/domain'
import { type SourceQuery, stockLevels } from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'

import {
  defects,
  documents,
  erasureRequests,
  formRecords,
  gridOperators,
  installations,
  jobs,
  maintenanceContracts,
  offerDeclines,
  prospects,
  sites,
} from '../database/schema/index.js'
import { contactMonthsOf, customerStandings } from '../privacy/customer-erasure.js'
import { tradeForms } from '../forms/registry.js'

/**
 * What a deadline of this application hangs on beside its source, as its
 * sources say it: the columns this application gives the table of the
 * foundation. The task is not among them; the action that makes it writes it.
 */
export interface DeadlineValues {
  readonly documentId: DocumentId | null
  readonly installationId: InstallationId | null
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
}

/**
 * The quotes that went out and that nothing has followed: no order
 * confirmation, no invoice, no document at all with the quote as its
 * predecessor, no maintenance contract made out of it, and no mark that the
 * customer declined it (#841). A draft that follows counts as well, because somebody is
 * already on it; if it is thrown away, the quote is open again, and so is its
 * deadline.
 *
 * Counted from the day it was issued, in Berlin, and named by its number.
 */
export const openQuotes: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await tx
    .select({
      id: documents.id,
      number: documents.number,
      customerId: documents.customerId,
      siteId: documents.siteId,
      jobId: documents.jobId,
      issuedAt: documents.issuedAt,
      issuedBy: documents.issuedBy,
    })
    .from(documents)
    .where(
      and(
        eq(documents.kind, 'quote'),
        eq(documents.status, 'issued'),
        isNull(documents.deletedAt),
        isNotNull(documents.issuedAt),
        sql`not exists (
          select 1 from ${documents} as following
           where following.tenant_id = ${documents.tenantId}
             and following.predecessor_document_id = ${documents.id}
             and following.deleted_at is null
        )`,
        // A maintenance contract made out of the quote (#294) is its order as
        // much as a confirmation would be (#312): nothing to follow up.
        sql`not exists (
          select 1 from ${maintenanceContracts} as contract
           where contract.tenant_id = ${documents.tenantId}
             and contract.quote_id = ${documents.id}
        )`,
        // Nor one the office marked as declined (#841): nobody follows it up.
        sql`not exists (
          select 1 from ${offerDeclines} as declined
           where declined.tenant_id = ${documents.tenantId}
             and declined.document_id = ${documents.id}
        )`,
      ),
    )

  return rows.flatMap((row) =>
    row.issuedAt === null
      ? []
      : [
          {
            sourceId: row.id,
            sourceLabel: row.number ?? '',
            anchorOn: berlinClock(row.issuedAt).day,
            namedDueOn: null,
            naturalUserId: row.issuedBy,
            values: {
              documentId: row.id,
              installationId: null,
              customerId: row.customerId,
              siteId: row.siteId,
              jobId: row.jobId,
            },
          },
        ],
  )
}

/**
 * The articles below the minimum their store keeps (#298): one source for
 * each place an article has in a store, named by the article and the store,
 * as "Leitungsschutzschalter B16 im Transporter HD-OG 412". Due on the day of
 * the last booking of the article there, or the day the minimum was set where
 * nothing was ever booked; the stock is the sum of the bookings
 * (`stockLevels`). The person it names is who booked last there.
 */
export const storesBelowMinimum: SourceQuery<DeadlineValues> = async (tx) => {
  const { rows } = await tx.execute<{
    id: string
    store_id: string
    article_id: string
    minimum_milli: number
    designation: string
    store_name: string
    since: Date
    booked_by: string | null
  }>(sql`
    select p.id, p.store_id, p.article_id, p.minimum_milli, a.designation, s.name as store_name,
           coalesce((select max(m.created_at) from stock_movements m
                      where m.store_id = p.store_id and m.article_id = p.article_id and m.deleted_at is null),
                    p.updated_at) as since,
           (select m.booked_by from stock_movements m
             where m.store_id = p.store_id and m.article_id = p.article_id and m.deleted_at is null
             order by m.created_at desc, m.id desc limit 1) as booked_by
      from store_articles p
      join stores s on s.id = p.store_id and s.deleted_at is null
      join articles a on a.id = p.article_id and a.deleted_at is null
     where p.deleted_at is null and p.minimum_milli is not null`)

  if (rows.length === 0) {
    return []
  }

  const levels = new Map(
    (await stockLevels(tx)).map((row) => [`${row.storeId}:${row.articleId}`, row.levelMilli]),
  )

  return rows.flatMap((row) => {
    const level = levels.get(`${row.store_id}:${row.article_id}`) ?? 0

    if (level >= Number(row.minimum_milli)) {
      return []
    }

    const day = berlinClock(new Date(row.since)).day

    return [
      {
        sourceId: row.id,
        sourceLabel: `${row.designation} im ${row.store_name}`,
        anchorOn: day,
        namedDueOn: day,
        naturalUserId: row.booked_by,
        values: {
          documentId: null,
          installationId: null,
          customerId: null,
          siteId: null,
          jobId: null,
        },
      },
    ]
  })
}

/**
 * The qualifications in the files that run out (#287): one source for each
 * qualification with a last day, of a person who has not left before today,
 * named by its kind and the person, as "Höhenarbeit von Anna Weber". Due on
 * its last day; the lead of the kind makes the task in time. The person it
 * names is the one whose qualification it is, where they have an account.
 *
 * The office reads the deadline and its task like any other, which says
 * whose qualification runs out and of which kind and nothing else of the
 * file (decided on 01.11.2026).
 */
export const qualificationsRunningOut: SourceQuery<DeadlineValues> = async (tx) => {
  const today = berlinClock(new Date()).day
  const { rows } = await tx.execute<{
    id: string
    kind_key: string | null
    own_label: string | null
    valid_until: string
    name: string
    user_id: string | null
  }>(sql`
    select q.id, q.kind_key, k.label as own_label, q.valid_until::text as valid_until, p.name, p.user_id
      from qualifications q
      join people p on p.id = q.person_id and p.deleted_at is null
      left join qualification_kinds k on k.id = q.own_kind_id
     where q.deleted_at is null and q.valid_until is not null
       and (p.left_on is null or p.left_on >= ${today})`)
  const catalogue = new Map(qualificationCatalogue.map((kind) => [kind.key, kind.label]))

  return rows.map((row) => ({
    sourceId: row.id,
    sourceLabel: `${(row.kind_key === null ? null : catalogue.get(row.kind_key)) ?? row.own_label ?? row.kind_key ?? 'Qualifikation'} von ${row.name}`,
    anchorOn: row.valid_until,
    namedDueOn: row.valid_until,
    naturalUserId: row.user_id,
    values: {
      documentId: null,
      installationId: null,
      customerId: null,
      siteId: null,
      jobId: null,
    },
  }))
}

/**
 * The forms that hang on an installation or an appliance and name a next
 * inspection, each version on its own (#814): a form names it from a version
 * on, as the first inspection after DIN VDE 0100-600 from its third, and a
 * protocol in an older version names none and is passed over.
 */
function namingNextInspection(subject: FormDefinition['attachesTo']): SQL | null {
  const versions = tradeForms
    .current()
    .filter((definition) => definition.attachesTo === subject)
    .flatMap((current) =>
      Array.from({ length: current.version }, (_, index) =>
        tradeForms.definitionFor(current.key, index + 1),
      ),
    )
    .filter(
      (definition): definition is FormDefinition =>
        definition !== null && nextInspectionField(definition) !== null,
    )

  return versions.length === 0
    ? null
    : sql`(r.definition_key, r.definition_version) in (${sql.join(
        versions.map((definition) => sql`(${definition.key}, ${definition.version}::integer)`),
        sql`, `,
      )})`
}

/**
 * The next inspections the protocols name (#301): one source for each
 * installation, out of its last signed protocol whose form names a next
 * inspection, the newest day of the test first. Due when that protocol says,
 * its interval counted from the day of the test (`nextInspectionOn`), and
 * named by the installation and its site, as "Zählerschrank, Keller am Objekt
 * Rheinstraße 12". The person it names is who signed it, the last to write a
 * signed protocol.
 *
 * A newer protocol moves the day, and one that names no interval it can use
 * leaves the installation without a deadline rather than falling back on an
 * older one: the last test is the one that counts. A test of only a part of
 * the installation, the first inspection after an extension or a change,
 * leaves the last test of the whole standing (#814) and draws its day forward
 * where the part is to be tested sooner (#822, `installationDueOn`); the
 * deadline then hangs on that protocol. An installation, site or customer
 * deleted lets the deadline drop.
 */
export const inspectionsDue: SourceQuery<DeadlineValues> = async (tx) => {
  const forms = namingNextInspection('installation')

  if (forms === null) {
    return []
  }

  const { rows } = await tx.execute<{
    definition_key: string
    definition_version: number
    performed_on: string
    values: string
    updated_by: string | null
    installation_id: string
    designation: string
    site_id: string
    site: string
    customer_id: string
  }>(sql`
    select r.definition_key, r.definition_version, r.performed_on::text as performed_on, r.values,
           r.updated_by, i.id as installation_id, i.designation, s.id as site_id,
           s.designation as site, s.customer_id
      from form_records r
      join installations i on i.id = r.installation_id and i.deleted_at is null
      join sites s on s.id = i.site_id and s.deleted_at is null
      join customers c on c.id = s.customer_id and c.deleted_at is null
     where r.deleted_at is null and r.status = 'signed' and ${forms}
     order by r.installation_id, r.performed_on desc, r.updated_at desc, r.id desc`)

  // The protocols of each installation together, the newest first.
  const testsOf = new Map<string, (SignedTest & { readonly row: (typeof rows)[number] })[]>()

  for (const row of rows) {
    const definition = tradeForms.definitionFor(row.definition_key, Number(row.definition_version))

    if (definition !== null) {
      testsOf.set(row.installation_id, [
        ...(testsOf.get(row.installation_id) ?? []),
        {
          definition,
          values: readFormValues(row.values) ?? {},
          performedOn: row.performed_on as IsoDate,
          row,
        },
      ])
    }
  }

  return [...testsOf.values()].flatMap((tests) => {
    const due = installationDueOn(tests)

    if (due === null) {
      return []
    }

    const { row } = due.test

    return [
      {
        sourceId: row.installation_id,
        sourceLabel: `${row.designation} am Objekt ${row.site}`,
        anchorOn: due.test.performedOn,
        namedDueOn: due.on,
        naturalUserId: row.updated_by,
        values: {
          documentId: null,
          installationId: row.installation_id as InstallationId,
          customerId: row.customer_id as CustomerId,
          siteId: row.site_id as SiteId,
          jobId: null,
        },
      },
    ]
  })
}

/**
 * The appliances of the register whose last signed test names the next one
 * (#303): the same question as `inspectionsDue`, asked of the protocols that
 * hang on an appliance. One deadline per appliance, labelled with its number
 * and designation at its site; an appliance, site or customer deleted lets it
 * drop. The task it makes names the site, and the kind shares it among the
 * appliances of a site due the same day (`sharesTasksBySite`).
 */
export const appliancesDue: SourceQuery<DeadlineValues> = async (tx) => {
  const forms = namingNextInspection('appliance')

  if (forms === null) {
    return []
  }

  const { rows } = await tx.execute<{
    definition_key: string
    definition_version: number
    performed_on: string
    values: string
    updated_by: string | null
    appliance_id: string
    inventory_number: string | null
    designation: string
    site_id: string
    site: string
    customer_id: string
  }>(sql`
    select distinct on (r.appliance_id)
           r.definition_key, r.definition_version, r.performed_on::text as performed_on, r.values,
           r.updated_by, a.id as appliance_id, a.inventory_number, a.designation,
           s.id as site_id, s.designation as site, s.customer_id
      from form_records r
      join appliances a on a.id = r.appliance_id and a.deleted_at is null
      join sites s on s.id = a.site_id and s.deleted_at is null
      join customers c on c.id = s.customer_id and c.deleted_at is null
     where r.deleted_at is null and r.status = 'signed' and ${forms}
     order by r.appliance_id, r.performed_on desc, r.updated_at desc, r.id desc`)

  return rows.flatMap((row) => {
    const definition = tradeForms.definitionFor(row.definition_key, Number(row.definition_version))
    const performedOn = row.performed_on as IsoDate
    const due =
      definition === null
        ? null
        : nextInspectionOn(definition, readFormValues(row.values) ?? {}, performedOn)

    return due === null
      ? []
      : [
          {
            sourceId: row.appliance_id,
            sourceLabel: `${applianceLabel({ inventoryNumber: row.inventory_number, designation: row.designation })} am Objekt ${row.site}`,
            anchorOn: performedOn,
            namedDueOn: due,
            naturalUserId: row.updated_by,
            values: {
              documentId: null,
              installationId: null,
              customerId: row.customer_id as CustomerId,
              siteId: row.site_id as SiteId,
              jobId: null,
            },
          },
        ]
  })
}

/**
 * The entries of the business in the installer directories of its grid
 * operators (#306): one source for each grid operator with a number and a
 * last day, named by the grid operator, as "Stadtwerke Neckartal Netze GmbH".
 * Due on that day; the lead of the kind makes the task in time. The entry is
 * the business's and names nobody, so the kind gives it to the owner. A later
 * day moves it, and a grid operator removed or a day taken out lets it drop.
 */
export const installerRegistrationsRunningOut: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await tx
    .select({
      id: gridOperators.id,
      name: gridOperators.name,
      registeredUntil: gridOperators.registeredUntil,
    })
    .from(gridOperators)
    .where(
      and(
        isNull(gridOperators.deletedAt),
        isNotNull(gridOperators.registeredUntil),
        isNotNull(gridOperators.registrationNumber),
        sql`btrim(${gridOperators.registrationNumber}) <> ''`,
      ),
    )

  return rows.flatMap((row) =>
    row.registeredUntil === null
      ? []
      : [
          {
            sourceId: row.id,
            sourceLabel: row.name,
            anchorOn: row.registeredUntil,
            namedDueOn: row.registeredUntil,
            naturalUserId: null,
            values: {
              documentId: null,
              installationId: null,
              customerId: null,
              siteId: null,
              jobId: null,
            },
          },
        ],
  )
}

/**
 * The warranty that runs from the acceptance of a job (#310): out of the last
 * signed protocol of the acceptance of each living job, one source named by
 * the job, as "Wallbox Garage montieren, AU-2026-0231", due on the last day
 * of the warranty its rules give. Where the VOB/B is agreed and the
 * maintenance not handed over, a second source for the parts that need it,
 * named so and hanging on the protocol. A refused acceptance starts none; a
 * newer protocol moves the deadline, and with the job it drops.
 */
export const warrantiesRunningOut: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await tx
    .select({
      id: formRecords.id,
      performedOn: formRecords.performedOn,
      values: formRecords.values,
      jobId: jobs.id,
      designation: jobs.designation,
      number: jobs.number,
      customerId: jobs.customerId,
      siteId: jobs.siteId,
      installationId: jobs.installationId,
    })
    .from(formRecords)
    .innerJoin(jobs, eq(jobs.id, formRecords.jobId))
    .where(
      and(
        eq(formRecords.definitionKey, acceptanceFormKey),
        eq(formRecords.status, 'signed'),
        isNull(formRecords.deletedAt),
        isNull(formRecords.installationId),
        isNull(formRecords.applianceId),
        isNull(jobs.deletedAt),
      ),
    )
    .orderBy(desc(formRecords.performedOn), desc(formRecords.updatedAt), desc(formRecords.id))
  const seen = new Set<string>()

  return rows.flatMap((row) => {
    if (seen.has(row.jobId)) {
      return []
    }

    seen.add(row.jobId)

    const performedOn = row.performedOn as IsoDate
    const acceptance = acceptanceOf(readFormValues(row.values) ?? {})
    const terms = acceptance ? warrantyTerms(performedOn, acceptance, shippedRules) : null

    if (terms === null) {
      return []
    }

    const label = [row.designation, row.number].filter((part) => part !== null).join(', ')
    const values: DeadlineValues = {
      documentId: null,
      installationId: row.installationId as InstallationId | null,
      customerId: row.customerId as CustomerId,
      siteId: row.siteId as SiteId | null,
      jobId: row.jobId as JobId,
    }

    return [
      {
        sourceId: row.jobId,
        sourceLabel: label,
        anchorOn: performedOn,
        namedDueOn: terms.whole.endsOn,
        naturalUserId: null,
        values,
      },
      ...(terms.parts === null
        ? []
        : [
            {
              sourceId: row.id,
              sourceLabel: `${label}, wartungsbedürftige Teile`,
              anchorOn: performedOn,
              namedDueOn: terms.parts.endsOn,
              naturalUserId: null,
              values,
            },
          ]),
    ]
  })
}

/** The words of a defect a task names it by: the first line, and not more than a title holds. */
function defectLabel(description: string): string {
  const first = description.split('\n')[0]?.trim() ?? ''

  return first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first
}

/**
 * The days by which customers want defects remedied (#311): one source for
 * each defect still to be remedied, reported or in progress, that has one,
 * named by what is wrong and the number of its job, due on that day and
 * counted from the day it was reported. Remedied, accepted or removed, it drops.
 */
export const defectsToRemedy: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await tx
    .select({
      id: defects.id,
      description: defects.description,
      reportedAt: defects.reportedAt,
      remedyDueOn: defects.remedyDueOn,
      jobId: defects.jobId,
      installationId: defects.installationId,
      number: jobs.number,
      jobCustomerId: jobs.customerId,
      jobSiteId: jobs.siteId,
      installationSiteId: installations.siteId,
      siteCustomerId: sites.customerId,
    })
    .from(defects)
    .leftJoin(jobs, eq(jobs.id, defects.jobId))
    .leftJoin(installations, eq(installations.id, defects.installationId))
    .leftJoin(sites, eq(sites.id, installations.siteId))
    .where(
      and(
        isNull(defects.deletedAt),
        inArray(defects.status, ['reported', 'in_progress']),
        isNotNull(defects.remedyDueOn),
      ),
    )

  return rows.flatMap((row) =>
    row.remedyDueOn === null
      ? []
      : [
          {
            sourceId: row.id,
            sourceLabel: [defectLabel(row.description), row.number]
              .filter((part) => part !== null && part !== '')
              .join(', '),
            anchorOn: berlinClock(row.reportedAt).day,
            namedDueOn: row.remedyDueOn as IsoDate,
            naturalUserId: null,
            values: {
              documentId: null,
              installationId: row.installationId as InstallationId | null,
              customerId: (row.jobCustomerId ?? row.siteCustomerId) as CustomerId | null,
              siteId: (row.jobSiteId ?? row.installationSiteId) as SiteId | null,
              jobId: row.jobId as JobId | null,
            },
          },
        ],
  )
}

/** A maintenance contract as both of its sources read it. */
async function contractsOf(tx: Parameters<SourceQuery<DeadlineValues>>[0]) {
  // The last day a service job was made for, deleted ones included: a job
  // the office deleted stands for its day all the same, and is not made again.
  const made = await tx
    .select({
      contractId: jobs.maintenanceContractId,
      lastMadeOn: sql<string>`max(${jobs.maintenanceDueOn})::text`,
    })
    .from(jobs)
    .where(isNotNull(jobs.maintenanceContractId))
    .groupBy(jobs.maintenanceContractId)
  const lastMade = new Map(made.map((row) => [String(row.contractId), row.lastMadeOn]))
  const rows = await tx
    .select({
      id: maintenanceContracts.id,
      number: maintenanceContracts.number,
      designation: maintenanceContracts.designation,
      customerId: maintenanceContracts.customerId,
      siteId: maintenanceContracts.siteId,
      installationIds: maintenanceContracts.installationIds,
      startsOn: maintenanceContracts.startsOn,
      firstVisitOn: maintenanceContracts.firstVisitOn,
      intervalMonths: maintenanceContracts.intervalMonths,
      termMonths: maintenanceContracts.termMonths,
      renewal: maintenanceContracts.renewal,
      renewalMonths: maintenanceContracts.renewalMonths,
      noticeMonths: maintenanceContracts.noticeMonths,
      cancelledOn: maintenanceContracts.cancelledOn,
      paymentRhythm: maintenanceContracts.paymentRhythm,
      priceKind: maintenanceContracts.priceKind,
      endsOn: maintenanceContracts.endsOn,
      createdAt: maintenanceContracts.createdAt,
    })
    .from(maintenanceContracts)

  return rows.map((row) => ({ ...row, lastMadeOn: lastMade.get(row.id) ?? null }))
}

/** What a deadline of a contract hangs on: its customer and site, and its installation where it covers one. */
function contractValues(row: Awaited<ReturnType<typeof contractsOf>>[number]): DeadlineValues {
  return {
    documentId: null,
    installationId:
      row.installationIds.length === 1 ? (row.installationIds[0] as InstallationId) : null,
    customerId: row.customerId as CustomerId,
    siteId: row.siteId as SiteId | null,
    jobId: null,
  }
}

/**
 * The next maintenance of each contract that has one left (#294): one source
 * per contract, due on the first day the contract counts that has no service
 * job yet, and not before the day the contract was entered. Once the job of a
 * day is made, the deadline moves on to the next; after the last day of a
 * contract given notice, or of one that ends with its term, it drops.
 */
export const maintenanceVisitsDue: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await contractsOf(tx)

  return rows.flatMap((row) => {
    const terms = {
      ...row,
      startsOn: row.startsOn as IsoDate,
      endsOn: row.endsOn as IsoDate | null,
      renewal: row.renewal as 'none' | 'fixed' | 'indefinite',
    }
    const due = nextVisitOn(
      { firstVisitOn: row.firstVisitOn as IsoDate, intervalMonths: row.intervalMonths },
      {
        lastMadeOn: row.lastMadeOn as IsoDate | null,
        notBefore: berlinClock(row.createdAt).day,
        lastDay: lastServiceDay(terms),
      },
    )

    return due === null
      ? []
      : [
          {
            sourceId: row.id,
            sourceLabel: `${row.number} ${row.designation}`,
            anchorOn: terms.startsOn,
            namedDueOn: due,
            naturalUserId: null,
            values: contractValues(row),
          },
        ]
  })
}

/**
 * The last day a notice still ends a contract at the end of its term (#294):
 * for each contract that renews and has no notice yet. The term is the one
 * running today, or the next once the last day for this one has passed; a
 * contract that runs on without end has one only before its first term ends.
 */
export const maintenanceNoticesDue: SourceQuery<DeadlineValues> = async (tx) => {
  const today = berlinClock(new Date()).day
  const rows = await contractsOf(tx)

  return rows.flatMap((row) => {
    if (row.cancelledOn !== null || row.renewal === 'none') {
      return []
    }

    const terms = {
      startsOn: row.startsOn as IsoDate,
      termMonths: row.termMonths,
      renewal: row.renewal as 'fixed' | 'indefinite',
      renewalMonths: row.renewalMonths,
      noticeMonths: row.noticeMonths,
    }
    let end = termEndOn(terms, today)

    if (end !== null && lastNoticeDay(end, terms.noticeMonths) < today) {
      end = termEndOn(terms, addDays(end, 1))
    }

    if (end === null || (terms.renewal === 'indefinite' && end < today)) {
      return []
    }

    const due = lastNoticeDay(end, terms.noticeMonths)

    return due < today
      ? []
      : [
          {
            sourceId: row.id,
            sourceLabel: `${row.number} ${row.designation}`,
            anchorOn: terms.startsOn,
            namedDueOn: due,
            naturalUserId: null,
            values: contractValues(row),
          },
        ]
  })
}

/**
 * The next period of each contract paid per period that has no invoice yet
 * (#295): due on its first day, not before the day the contract was entered,
 * and none after the last day of a contract. Once the invoice of a period
 * exists, deleted drafts included, the deadline moves on to the next.
 */
export const maintenancePeriodsDue: SourceQuery<DeadlineValues> = async (tx) => {
  const billed = await tx
    .select({
      contractId: documents.maintenanceContractId,
      lastBilledFrom: sql<string>`max(${documents.serviceFrom})::text`,
    })
    .from(documents)
    .where(isNotNull(documents.maintenanceContractId))
    .groupBy(documents.maintenanceContractId)
  const lastBilled = new Map(billed.map((row) => [String(row.contractId), row.lastBilledFrom]))
  const rows = await contractsOf(tx)

  return rows.flatMap((row) => {
    if (row.paymentRhythm === 'visit' || row.priceKind !== 'flat') {
      return []
    }

    const period = nextPeriod(
      { startsOn: row.startsOn as IsoDate, paymentRhythm: row.paymentRhythm as PaymentRhythm },
      {
        lastBilledFrom: (lastBilled.get(row.id) ?? null) as IsoDate | null,
        notBefore: berlinClock(row.createdAt).day,
        lastDay: lastServiceDay({
          ...row,
          startsOn: row.startsOn as IsoDate,
          endsOn: row.endsOn as IsoDate | null,
          renewal: row.renewal as 'none' | 'fixed' | 'indefinite',
        }),
      },
    )

    return period === null
      ? []
      : [
          {
            sourceId: row.id,
            sourceLabel: `${row.number} ${row.designation}`,
            anchorOn: row.startsOn as IsoDate,
            namedDueOn: period.from,
            naturalUserId: null,
            values: contractValues(row),
          },
        ]
  })
}

/**
 * The leads that never became a customer (#317), each due the months of its
 * kind after its last contact. Named without a name (`prospectErasureLabel`):
 * the deadline outlives the lead it proposes for deletion, and so does the
 * task or the protocol line that may come from it. A later contact moves the
 * deadline; the lead becoming a customer or being deleted lets it drop.
 */
export const erasableProspects: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await tx
    .select({
      id: prospects.id,
      source: prospects.source,
      lastContactOn: prospects.lastContactOn,
    })
    .from(prospects)
    .where(isNull(prospects.customerId))

  return rows.map((row) => ({
    sourceId: row.id,
    sourceLabel: prospectErasureLabel(row),
    anchorOn: row.lastContactOn,
    namedDueOn: null,
    naturalUserId: null,
    values: {
      documentId: null,
      installationId: null,
      customerId: null,
      siteId: null,
      jobId: null,
    },
  }))
}

/**
 * The customers with whom nothing runs (#845), each due when
 * `customerErasureDueOn` says: the months the business set after its last
 * contact, or the day it asked to be deleted, and not before the day after
 * its last document to keep and its last warranty, and only from that day
 * on. The source names the day and reads the months itself, since the day
 * may be a hold's and not the interval's. An open job or a running contract lets the deadline drop, a
 * later contact moves it, and so does the customer being deleted. Named
 * without a name (`customerErasureLabel`), as for a lead.
 */
export const erasableCustomers: SourceQuery<DeadlineValues> = async (tx) => {
  const today = berlinClock(new Date()).day
  const standings = await customerStandings(tx, today)
  const months = await contactMonthsOf(tx)

  return [...standings.values()].flatMap((standing) => {
    const requestedOn = standing.request?.receivedOn ?? null
    const dueOn = customerErasureDueOn({
      holds: standing.holds,
      lastContactOn: standing.lastContactOn,
      contactMonths: months,
      requestedOn,
    })

    // Only once it is due: a deadline for every customer, years ahead, would
    // fill the list of deadlines and say nothing.
    if (dueOn === null || dueOn > today) {
      return []
    }

    return [
      {
        sourceId: standing.customerId,
        sourceLabel: customerErasureLabel({
          kind: standing.kind,
          lastContactOn: standing.lastContactOn,
          requestedOn,
        }),
        anchorOn: requestedOn ?? standing.lastContactOn,
        namedDueOn: dueOn,
        naturalUserId: null,
        values: {
          documentId: null,
          installationId: null,
          customerId: standing.customerId,
          siteId: null,
          jobId: null,
        },
      },
    ]
  })
}

/**
 * The requests for deletion not answered yet (#845), each due a month after
 * it came in (Art. 12 (3) DSGVO). Named by the day it came in; the deadline
 * hangs on the customer, so that its task opens the customer's file. The
 * answer lets it drop.
 */
export const openErasureRequests: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await tx
    .select({
      id: erasureRequests.id,
      customerId: erasureRequests.customerId,
      receivedOn: erasureRequests.receivedOn,
      answerDueOn: erasureRequests.answerDueOn,
    })
    .from(erasureRequests)
    .where(eq(erasureRequests.status, 'open'))

  return rows.map((row) => ({
    sourceId: row.id,
    sourceLabel: `Löschanfrage vom ${row.receivedOn.slice(8, 10)}.${row.receivedOn.slice(5, 7)}.${row.receivedOn.slice(0, 4)}`,
    anchorOn: row.receivedOn as IsoDate,
    namedDueOn: row.answerDueOn as IsoDate,
    naturalUserId: null,
    values: {
      documentId: null,
      installationId: null,
      customerId: row.customerId as CustomerId,
      siteId: null,
      jobId: null,
    },
  }))
}

/** Every source there is, by the name a kind gives it. */
export const deadlineSourceQueries: Readonly<Record<DeadlineSource, SourceQuery<DeadlineValues>>> =
  {
    quote: openQuotes,
    store_minimum: storesBelowMinimum,
    qualification: qualificationsRunningOut,
    inspection: inspectionsDue,
    appliance_inspection: appliancesDue,
    installer_registration: installerRegistrationsRunningOut,
    acceptance: warrantiesRunningOut,
    defect: defectsToRemedy,
    maintenance_visit: maintenanceVisitsDue,
    maintenance_notice: maintenanceNoticesDue,
    maintenance_period: maintenancePeriodsDue,
    prospect: erasableProspects,
    customer: erasableCustomers,
    erasure_request: openErasureRequests,
  }
