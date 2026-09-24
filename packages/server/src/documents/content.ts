import {
  currentContent,
  defaultPaymentTermDays,
  type DocumentContent,
  documentContent,
  type DocumentId,
  type InstructionGap,
  type IssuerContent,
  type LogoContent,
  type RuleSet,
  type SiteContent,
  type TenantId,
} from '@opengewerk/domain'
import { and, asc, eq, isNull } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { parameterAt } from '../database/parameters.js'
import { deductionsFor } from './deductions.js'
import { instructionsFor } from './instructions.js'
import {
  customers,
  documentLines,
  type documents,
  documentSignatures,
  documentSnapshots,
  files,
  jobs,
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
 *
 * A progress invoice and a final invoice take off what the progress invoices
 * before them in the chain billed, read from what those froze when they were
 * issued. Every other kind deducts nothing.
 *
 * Whether the business calculated its tax on the amounts received is read as
 * it stood on the document's date, like the small business claim that
 * proposed the treatment: an invoice of 2028 says what applied in 2028. The
 * payment term the same way, unless the document states its own.
 *
 * The instructions go in filled with the same letterhead the document prints,
 * and what they lack comes back beside the content, for the one caller that
 * has to refuse over it: issuing.
 */
export async function contentAndGapsOf(
  tx: TenantTransaction,
  document: DocumentRow,
  rules: RuleSet,
): Promise<{ readonly content: DocumentContent; readonly gaps: readonly InstructionGap[] }> {
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

  // The signature, when a customer has signed. What is printed of it is the
  // name, the moment and the picture; the device information stays in the row.
  const [signature] = await tx
    .select({
      signerName: documentSignatures.signerName,
      signedAt: documentSignatures.signedAt,
      path: documentSignatures.path,
    })
    .from(documentSignatures)
    .where(eq(documentSignatures.documentId, document.id))

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

  const issuer = await issuerOf(tx, document.tenantId)
  const instructions = await instructionsFor(tx, document, issuer, customer.isBusiness)
  // The number of the job, which the customer names on the phone (#145). A
  // deleted job still has it: the document was written for that job.
  const [job] = document.jobId
    ? await tx.select({ number: jobs.number }).from(jobs).where(eq(jobs.id, document.jobId))
    : []

  const content = documentContent(rules, {
    document,
    lines: rows,
    issuer,
    recipient: {
      name: customer.name,
      street: customer.street,
      houseNumber: customer.houseNumber,
      postalCode: customer.postalCode,
      city: customer.city,
      country: customer.country,
      isBusiness: customer.isBusiness,
      email: customer.email,
      vatId: customer.vatId,
      buyerReference: customer.buyerReference,
    },
    site,
    signature: signature
      ? {
          signerName: signature.signerName,
          signedAt: signature.signedAt.toISOString(),
          path: signature.path,
        }
      : null,
    cashAccounting:
      (await parameterAt(tx, 'cash_accounting.permitted', document.documentDate))?.value === 1,
    deductions: await deductionsFor(tx, document),
    paymentTermDays: await paymentTermDaysOf(tx, document),
    instructions: instructions.contents,
    jobNumber: job?.number ?? null,
  })

  return { content, gaps: instructions.gaps }
}

/** Everything a document says, as `contentAndGapsOf` puts it together. */
export async function contentOf(
  tx: TenantTransaction,
  document: DocumentRow,
  rules: RuleSet,
): Promise<DocumentContent> {
  return (await contentAndGapsOf(tx, document, rules)).content
}

/**
 * The payment term that applies to a document, in days: its own when it
 * states one, else the business's setting on the document's date, else the
 * default. Asked for every kind, and only the kinds that state a term print
 * it; reading one parameter too many costs less than a second list of kinds
 * to keep in step with `statesPaymentTerm`.
 */
export async function paymentTermDaysOf(
  tx: TenantTransaction,
  document: Pick<DocumentRow, 'paymentTermDays' | 'documentDate'>,
): Promise<number> {
  if (document.paymentTermDays !== null) {
    return document.paymentTermDays
  }

  const setting = await parameterAt(tx, 'invoice.payment_term_days', document.documentDate)

  return setting?.value ?? defaultPaymentTermDays
}

/**
 * What an issued document froze when it got its number, in the shape of
 * today, or null for one issued before 0013, which froze nothing.
 *
 * Null rather than an error, because the callers say different things about
 * it: a route refuses with a sentence, a message about the document is not
 * written at all.
 */
export async function frozenContent(
  tx: TenantTransaction,
  documentId: DocumentId,
): Promise<DocumentContent | null> {
  const [snapshot] = await tx
    .select({ content: documentSnapshots.content })
    .from(documentSnapshots)
    .where(eq(documentSnapshots.documentId, documentId))

  return snapshot ? currentContent(snapshot.content) : null
}
