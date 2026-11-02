import {
  applianceLabel,
  berlinClock,
  type CustomerId,
  qualificationCatalogue,
  type DeadlineSource,
  type DocumentId,
  type FormDefinition,
  type InstallationId,
  type IsoDate,
  type JobId,
  nextInspectionField,
  nextInspectionOn,
  readFormValues,
  type SiteId,
  testsPart,
} from '@opengewerk/domain'
import { type SourceQuery, stockLevels } from '@opengewerk/platform-server'
import { and, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'

import { documents } from '../database/schema/index.js'
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
 * predecessor. A draft that follows counts as well, because somebody is
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
 * does not count (#814), and the last test of the whole stands. An
 * installation, site or customer deleted lets the deadline drop.
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

  // The newest protocol of each installation that tests the whole of it.
  const counted = new Set<string>()

  return rows.flatMap((row) => {
    const definition = tradeForms.definitionFor(row.definition_key, Number(row.definition_version))
    const values = readFormValues(row.values) ?? {}

    if (counted.has(row.installation_id) || (definition && testsPart(definition, values))) {
      return []
    }

    counted.add(row.installation_id)

    const performedOn = row.performed_on as IsoDate
    const due = definition === null ? null : nextInspectionOn(definition, values, performedOn)

    return due === null
      ? []
      : [
          {
            sourceId: row.installation_id,
            sourceLabel: `${row.designation} am Objekt ${row.site}`,
            anchorOn: performedOn,
            namedDueOn: due,
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

/** Every source there is, by the name a kind gives it. */
export const deadlineSourceQueries: Readonly<Record<DeadlineSource, SourceQuery<DeadlineValues>>> =
  {
    quote: openQuotes,
    store_minimum: storesBelowMinimum,
    qualification: qualificationsRunningOut,
    inspection: inspectionsDue,
    appliance_inspection: appliancesDue,
  }
