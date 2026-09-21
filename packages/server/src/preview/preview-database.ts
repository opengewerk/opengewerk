import type { RoleKey, TenantId } from '@opengewerk/domain'
import { Pool } from 'pg'

import { allowApplicationLogin, applyMigrations, resetSchema } from '../database/test-database.js'

/**
 * A start of the preview that was refused, with the sentence why. Its own
 * class so that the entry point prints the sentence and not a stack trace
 * above it.
 */
export class PreviewRefused extends Error {}

/**
 * Where the preview keeps its data unless told otherwise: a database of its
 * own in the container the tests use, next to their database and never in it.
 * Start it with `docker compose -f docker/compose.test.yaml up -d`.
 */
export const defaultPreviewDatabaseUrl =
  'postgres://opengewerk:opengewerk@127.0.0.1:5433/opengewerk_preview'

const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * The database the preview may use.
 *
 * It empties that database on every start, so the rules are the ones the
 * tests follow, and one more. The name has to end in `_preview`, so that no
 * development database or installation is lost to a stray variable. The
 * database has to be on this machine. And it is read from a variable of its
 * own, `PREVIEW_DATABASE_URL`, and never from `DATABASE_URL`: that one points
 * at a real database in an `.env` more often than not.
 */
export function previewDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(environment['PREVIEW_DATABASE_URL'] ?? defaultPreviewDatabaseUrl)
  const name = url.pathname.replace(/^\//, '')

  if (!localHosts.has(url.hostname)) {
    throw new PreviewRefused(
      `Die Vorschau läuft nur gegen eine Datenbank auf diesem Rechner, nicht gegen "${url.hostname}".`,
    )
  }

  // Letters, digits and underscores only, because the name ends up inside a
  // CREATE DATABASE, where a parameter cannot stand.
  if (!/^[a-z0-9_]+_preview$/.test(name)) {
    throw new PreviewRefused(
      `Die Vorschau leert ihre Datenbank bei jedem Start. Deshalb muss ihr Name aus ` +
        `Kleinbuchstaben, Ziffern und Unterstrichen bestehen und auf "_preview" enden, ` +
        `"${name}" tut das nicht.`,
    )
  }

  return url.toString()
}

/** The preview lets everything through, so it does not start where that would matter. */
export function refuseProduction(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment['NODE_ENV'] === 'production') {
    throw new PreviewRefused(
      'Die Vorschau lässt jede Anfrage ohne Anmeldung durch und startet deshalb nicht mit ' +
        'NODE_ENV=production.',
    )
  }
}

/** The port, 3000 unless `PREVIEW_PORT` says otherwise: where vite's proxy looks. */
export function previewPort(environment: NodeJS.ProcessEnv = process.env): number {
  const port = Number(environment['PREVIEW_PORT'] ?? 3000)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PreviewRefused(`PREVIEW_PORT muss eine Portnummer sein, nicht "${String(port)}".`)
  }

  return port
}

/**
 * Makes sure the database exists, then empties and migrates it the way the
 * tests do, and hands back a superuser pool on it.
 *
 * Emptied on every start rather than kept. The interface keeps a local copy
 * per business, and a database that was reset under a copy that was not would
 * leave the copy ahead of the server, with records the server never had. A new
 * business on every start gets a new copy instead.
 */
export async function preparePreviewDatabase(url: string): Promise<Pool> {
  const maintenance = new URL(url)
  maintenance.pathname = '/postgres'

  const name = new URL(url).pathname.replace(/^\//, '')
  const server = new Pool({ connectionString: maintenance.toString(), max: 1 })

  try {
    const { rowCount } = await server.query('select 1 from pg_database where datname = $1', [name])

    if (rowCount === 0) {
      await server.query(`create database "${name}"`)
    }
  } catch (cause) {
    throw new PreviewRefused(
      'Keine Datenbank erreichbar. Gestartet wird sie mit ' +
        '"docker compose -f docker/compose.test.yaml up -d".',
      { cause },
    )
  } finally {
    await server.end()
  }

  const admin = new Pool({ connectionString: url, max: 2 })

  await resetSchema(admin, url)
  await applyMigrations(url)
  await allowApplicationLogin(admin)

  return admin
}

/** The person every request of the preview counts as. */
export const previewUser = {
  id: 'preview',
  name: 'Vorschau',
  email: 'vorschau@opengewerk.invalid',
} as const

/** Owner, so that every screen is reachable, the ones only an owner sees included. */
export const previewRoles: readonly RoleKey[] = ['owner']

/**
 * The business and the person, straight into the tables, the way the tests
 * set up theirs.
 *
 * The user row carries no credential of any kind: no password, no passkey, no
 * second factor behind the flag. Nobody can sign in as it, and the preview
 * mounts no sign in anyway. It exists because a membership has to point at a
 * user, and the membership is what the route that lists the businesses of the
 * person asking reads.
 */
export async function admitPreviewUser(
  admin: Pool,
  tenant: { readonly id: TenantId; readonly name: string },
): Promise<void> {
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
  await admin.query(
    `insert into auth_users (id, name, email, email_verified, two_factor_enabled)
     values ($1, $2, $3, true, true)`,
    [previewUser.id, previewUser.name, previewUser.email],
  )
  await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
    tenant.id,
    previewUser.id,
    previewRoles,
  ])
}
