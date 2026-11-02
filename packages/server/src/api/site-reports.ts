import {
  type InstallationKind,
  installationKindLabel,
  type IsoDate,
  readFormValues,
  type SiteId,
  type TenantId,
  testsPart,
} from '@opengewerk/domain'
import { addressLines, present, type TenantTransaction } from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'

import {
  appliances,
  customers,
  formRecords,
  installations,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'
import type { ApplianceReport, LastTest, ReportedAppliance } from '../forms/appliance-report.js'
import type { ReportedInstallation } from '../forms/inspection-report.js'
import { tradeForms } from '../forms/registry.js'
import { todayInGermany } from '../today.js'

/**
 * What the reports of a site read (#303, #302): the site with its customer
 * and the business that keeps the report, and the last signed test of each
 * appliance and each installation of the site. Asked inside the transaction
 * of the tenant, so a site of another business is not found.
 */

/** Inventory numbers and designations as a person counts them: 9 before 10. */
const byNumber = new Intl.Collator('de', { numeric: true })

type Subject = 'installation' | 'appliance'

/**
 * The newest signed test of each subject, in a form this version reads that
 * hangs on that kind of subject. For an installation only a test of the whole
 * counts: a first inspection after an extension or a change tests a part
 * (#814), and the report names the last test of the whole installation.
 */
function lastTests(
  records: readonly (typeof formRecords.$inferSelect)[],
  subject: Subject,
): Map<string, LastTest> {
  const lastOf = new Map<string, LastTest>()

  for (const record of records) {
    const id = subject === 'installation' ? record.installationId : record.applianceId
    const definition = tradeForms.definitionFor(record.definitionKey, record.definitionVersion)
    const values = readFormValues(record.values) ?? {}

    if (
      id !== null &&
      definition?.attachesTo === subject &&
      !lastOf.has(id) &&
      !(subject === 'installation' && testsPart(definition, values))
    ) {
      lastOf.set(id, { definition, values, performedOn: record.performedOn as IsoDate })
    }
  }

  return lastOf
}

async function signedOf(tx: TenantTransaction, subject: Subject, ids: readonly string[]) {
  if (ids.length === 0) {
    return []
  }

  const column = subject === 'installation' ? formRecords.installationId : formRecords.applianceId

  return tx
    .select()
    .from(formRecords)
    .where(
      and(
        inArray(column, ids as never[]),
        eq(formRecords.status, 'signed'),
        isNull(formRecords.deletedAt),
      ),
    )
    .orderBy(desc(formRecords.performedOn), desc(formRecords.updatedAt), desc(formRecords.id))
}

/**
 * The site as a report heads it, or null where the tenant has none of that
 * id: the line with its address, its customer, the business with its phone,
 * and today.
 */
export async function siteHead(
  tx: TenantTransaction,
  tenantId: TenantId,
  siteId: string,
): Promise<Pick<ApplianceReport, 'keeper' | 'site' | 'customer' | 'on'> | null> {
  const [site] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId as SiteId), isNull(sites.deletedAt)))

  if (!site) {
    return null
  }

  const [customer] = await tx
    .select({ name: customers.name })
    .from(customers)
    .where(eq(customers.id, site.customerId))
  const [letterhead] = await tx
    .select({ companyName: letterheads.companyName, phone: letterheads.phone })
    .from(letterheads)
    .where(eq(letterheads.tenantId, tenantId))
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
  }
}

/** Every appliance of the register of a site with its last signed test, in the order of their numbers. */
export async function reportedAppliances(
  tx: TenantTransaction,
  siteId: string,
): Promise<readonly ReportedAppliance[]> {
  const register = await tx
    .select()
    .from(appliances)
    .where(and(eq(appliances.siteId, siteId as SiteId), isNull(appliances.deletedAt)))
  const lastOf = lastTests(
    await signedOf(
      tx,
      'appliance',
      register.map((entry) => entry.id),
    ),
    'appliance',
  )

  return [...register]
    .sort(
      (left, right) =>
        // Without a number last, the others as a person counts them.
        Number(left.inventoryNumber === null) - Number(right.inventoryNumber === null) ||
        byNumber.compare(left.inventoryNumber ?? '', right.inventoryNumber ?? '') ||
        byNumber.compare(left.designation, right.designation),
    )
    .map((appliance) => ({ appliance, last: lastOf.get(appliance.id) ?? null }))
}

/**
 * The installations of a site with the last signed test of the whole of each
 * (#302), by their designation. A heating comes in only where somebody
 * tested it with a protocol of an installation: the report is of the
 * electrical installation, and a heating nobody tested that way is no gap in
 * it.
 */
export async function reportedInstallations(
  tx: TenantTransaction,
  siteId: string,
): Promise<readonly ReportedInstallation[]> {
  const rows = await tx
    .select()
    .from(installations)
    .where(and(eq(installations.siteId, siteId as SiteId), isNull(installations.deletedAt)))
  const lastOf = lastTests(
    await signedOf(
      tx,
      'installation',
      rows.map((entry) => entry.id),
    ),
    'installation',
  )

  return rows
    .map((installation) => ({
      designation: installation.designation,
      kind: installationKindLabel[installation.kind as InstallationKind],
      heating: installation.kind === 'heating',
      last: lastOf.get(installation.id) ?? null,
    }))
    .filter((entry) => !entry.heating || entry.last !== null)
    .sort((left, right) => byNumber.compare(left.designation, right.designation))
    .map(({ designation, kind, last }) => ({ designation, kind, last }))
}
