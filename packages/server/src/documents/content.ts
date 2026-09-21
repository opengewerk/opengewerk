import {
  type DocumentContent,
  documentContent,
  type IssuerContent,
  type LogoContent,
  type RuleSet,
  type SiteContent,
  type TenantId,
} from '@opengewerk/domain'
import { and, asc, eq, isNull } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import {
  customers,
  documentLines,
  type documents,
  files,
  letterheads,
  sites,
  tenants,
} from '../database/schema/index.js'

type DocumentRow = typeof documents.$inferSelect

/**
 * The letterhead of a business as a document prints it.
 *
 * A business that has not filled in its letterhead still has a name, the one
 * it was set up with, and every other field stays empty. Whether that is
 * enough for the document at hand is not decided here but by
 * `missingDetails`, which says what is missing and why.
 */
export async function issuerOf(tx: TenantTransaction, tenantId: TenantId): Promise<IssuerContent> {
  const [tenant] = await tx
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  const [letterhead] = await tx.select().from(letterheads).where(eq(letterheads.tenantId, tenantId))

  let logo: LogoContent | null = null

  if (letterhead?.logoFileId) {
    const [file] = await tx
      .select({ id: files.id, sha256: files.sha256, mediaType: files.mediaType })
      .from(files)
      .where(eq(files.id, letterhead.logoFileId))

    logo = file ? { fileId: file.id, sha256: file.sha256, mediaType: file.mediaType } : null
  }

  const companyName = letterhead?.companyName?.trim()

  return {
    name: companyName || (tenant?.name ?? ''),
    street: letterhead?.street ?? null,
    houseNumber: letterhead?.houseNumber ?? null,
    postalCode: letterhead?.postalCode ?? null,
    city: letterhead?.city ?? null,
    country: letterhead?.country ?? 'DE',
    phone: letterhead?.phone ?? null,
    email: letterhead?.email ?? null,
    website: letterhead?.website ?? null,
    taxNumber: letterhead?.taxNumber ?? null,
    vatId: letterhead?.vatId ?? null,
    iban: letterhead?.iban ?? null,
    bic: letterhead?.bic ?? null,
    bankName: letterhead?.bankName ?? null,
    registerCourt: letterhead?.registerCourt ?? null,
    registerNumber: letterhead?.registerNumber ?? null,
    managingDirectors: letterhead?.managingDirectors ?? null,
    logo,
  }
}

/**
 * Everything a document says, gathered from the five places it draws on and
 * put together by the same function in `domain` that a device would use.
 *
 * Read inside the caller's transaction, and for issuing that matters: the
 * check of the mandatory details, the number and the snapshot all see the
 * same customer and the same letterhead. A customer whose address changes in
 * between waits for the lock or comes after, and either way the invoice says
 * what was checked.
 *
 * A line that was deleted from a draft stays behind as a row with `deletedAt`
 * set, like every synced record, and is left out here.
 */
export async function contentOf(
  tx: TenantTransaction,
  document: DocumentRow,
  rules: RuleSet,
): Promise<DocumentContent> {
  const rows = await tx
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.documentId, document.id), isNull(documentLines.deletedAt)))
    .orderBy(asc(documentLines.position), asc(documentLines.id))

  const [customer] = await tx.select().from(customers).where(eq(customers.id, document.customerId))

  if (!customer) {
    // The foreign key makes this impossible inside one business, so reaching
    // it means the row is out of reach, which is a bug and not a user error.
    throw new Error(`The customer of document ${document.id} is not readable.`)
  }

  let site: SiteContent | null = null

  if (document.siteId) {
    const [row] = await tx.select().from(sites).where(eq(sites.id, document.siteId))

    site = row
      ? {
          designation: row.designation,
          street: row.street,
          houseNumber: row.houseNumber,
          postalCode: row.postalCode,
          city: row.city,
          country: row.country,
        }
      : null
  }

  return documentContent(rules, {
    document,
    lines: rows,
    issuer: await issuerOf(tx, document.tenantId),
    recipient: {
      name: customer.name,
      street: customer.street,
      houseNumber: customer.houseNumber,
      postalCode: customer.postalCode,
      city: customer.city,
      country: customer.country,
      isBusiness: customer.isBusiness,
    },
    site,
  })
}
