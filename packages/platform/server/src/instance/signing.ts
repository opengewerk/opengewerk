import { createPrivateKey, X509Certificate } from 'node:crypto'

import type { InstanceCertificateView } from '@opengewerk/platform-domain'
import { eq } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'
import { instanceSettings } from '../schema.js'
import type { SecretKey } from '../secrets/key.js'
import { type CertificateSubject, newSigningKey, type SigningKey } from '../signing/signing.js'

/**
 * The key the instance signs PDFs with (opengewerk-haustechnik#457). Only an
 * application that signs hands this in; the routes of the instance answer
 * that it signs nothing otherwise.
 */
export const SIGNING = Symbol('Signing')

export interface SigningContext {
  /** The key the signing key is sealed with, from `SESSION_SECRET`. */
  readonly key: SecretKey
  /** Whom a new certificate names. */
  readonly subject: CertificateSubject
}

/**
 * What the key is sealed for. Named again to open it, see `SecretKey`: a value
 * sealed for a tenant or for the mail server opens nothing here.
 */
const sealedFor = 'instance:signing'

const missing =
  'The settings of the instance are missing; the migration that creates the table writes them.'

type Row = typeof instanceSettings.$inferSelect

async function rowOf(tx: TenantTransaction, forUpdate = false): Promise<Row> {
  const query = tx.select().from(instanceSettings).where(eq(instanceSettings.id, 1))
  const [row] = await (forUpdate ? query.for('update') : query)

  if (!row) {
    throw new Error(missing)
  }

  return row
}

/** The kept key, opened; null while there is none or it no longer opens. */
function keptKey(row: Row, key: SecretKey): SigningKey | null {
  if (row.signingKey === null || row.signingCertificate === null) {
    return null
  }

  const pem = key.unseal(sealedFor, row.signingKey)

  return pem === null
    ? null
    : {
        privateKey: createPrivateKey(pem),
        certificate: Buffer.from(row.signingCertificate, 'base64'),
      }
}

/**
 * A new key in place of the kept one, whose certificate joins the earlier
 * ones. Inside the transaction that holds the row.
 */
async function replaceKey(
  tx: TenantTransaction,
  row: Row,
  context: SigningContext,
): Promise<{ readonly signing: SigningKey; readonly row: Row }> {
  const signing = newSigningKey(context.subject)
  const [written] = await tx
    .update(instanceSettings)
    .set({
      signingKey: context.key.seal(
        sealedFor,
        signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ),
      signingCertificate: signing.certificate.toString('base64'),
      signingSince: new Date(),
      signingEarlier:
        row.signingCertificate === null
          ? row.signingEarlier
          : [...row.signingEarlier, row.signingCertificate],
      updatedAt: new Date(),
    })
    .where(eq(instanceSettings.id, 1))
    .returning()

  if (!written) {
    throw new Error(missing)
  }

  return { signing, row: written }
}

/**
 * The key to sign with now: the kept one, or a new one while there is none
 * or the kept one no longer opens. Two who ask for the first at the same
 * moment get the same: the second waits for the row and finds the key.
 */
export async function instanceSigningKey(
  database: Database,
  context: SigningContext,
): Promise<SigningKey> {
  const kept = keptKey(await database.forInstance((tx) => rowOf(tx)), context.key)

  if (kept !== null) {
    return kept
  }

  return database.forInstance(
    async (tx) => {
      const row = await rowOf(tx, true)

      return keptKey(row, context.key) ?? (await replaceKey(tx, row, context)).signing
    },
    undefined,
    'instance.signing',
  )
}

function viewOf(row: Row, key: SecretKey): InstanceCertificateView | null {
  if (row.signingCertificate === null || row.signingSince === null) {
    return null
  }

  const certificate = new X509Certificate(Buffer.from(row.signingCertificate, 'base64'))
  const part = (name: string) =>
    certificate.subject
      .split('\n')
      .find((line) => line.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ''

  return {
    commonName: part('CN'),
    organisation: part('O'),
    fingerprint: certificate.fingerprint256,
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
    since: row.signingSince.toISOString(),
    readable: keptKey(row, key) !== null,
    earlier: row.signingEarlier.length,
  }
}

/** The certificate the instance signs with, as its settings show it; null while there is none. */
export async function readInstanceSigning(
  database: Database,
  context: SigningContext,
): Promise<InstanceCertificateView | null> {
  return viewOf(await database.forInstance((tx) => rowOf(tx)), context.key)
}

/**
 * A new key, made by whoever runs the instance: every PDF from now on is
 * signed with it, and the certificate of the one before stays known.
 */
export async function renewInstanceSigning(
  database: Database,
  context: SigningContext,
  userId: string,
): Promise<InstanceCertificateView> {
  return database.forInstance(
    async (tx) => {
      const { row } = await replaceKey(tx, await rowOf(tx, true), context)
      const view = viewOf(row, context.key)

      if (view === null) {
        throw new Error(missing)
      }

      return view
    },
    userId,
    'instance.signing',
  )
}

/**
 * Every certificate a PDF of this instance can be signed with, DER: the one
 * of the key now, then those of the keys before, the newest first. A PDF
 * whose signature names one of them comes from this instance.
 */
export async function instanceCertificates(database: Database): Promise<readonly Buffer[]> {
  const row = await database.forInstance((tx) => rowOf(tx))

  return [
    ...(row.signingCertificate === null ? [] : [row.signingCertificate]),
    ...[...row.signingEarlier].reverse(),
  ].map((each) => Buffer.from(each, 'base64'))
}
