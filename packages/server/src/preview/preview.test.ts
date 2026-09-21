import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import type { Identity } from '@opengewerk/domain'
import express from 'express'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import {
  admitPreviewUser,
  defaultPreviewDatabaseUrl,
  previewDatabaseUrl,
  previewPort,
  PreviewRefused,
  previewRoles,
  previewUser,
  refuseProduction,
} from './preview-database.js'
import { previewSession } from './preview-identity.js'
import { openPreview } from './preview-server.js'
import { plantSampleData } from './sample-data.js'

/**
 * The preview lets every request through as the owner of a sample business.
 * These tests hold the fences around that, and they run the sample data
 * against the real routes, so that a route which changes its mind about a
 * field breaks here and not on the next start of the preview.
 */

describe('the fences around the preview', () => {
  it('uses its own database in the local test container unless told otherwise', () => {
    expect(previewDatabaseUrl({})).toBe(defaultPreviewDatabaseUrl)
  })

  it('never reads DATABASE_URL, which usually points at a real database', () => {
    expect(
      previewDatabaseUrl({ DATABASE_URL: 'postgres://app:secret@127.0.0.1:5432/opengewerk' }),
    ).toBe(defaultPreviewDatabaseUrl)
  })

  it('refuses a database that is not on this machine', () => {
    expect(() =>
      previewDatabaseUrl({
        PREVIEW_DATABASE_URL: 'postgres://app:secret@db.example.com:5432/opengewerk_preview',
      }),
    ).toThrow(PreviewRefused)
  })

  it('refuses a database that is not named for the purpose, the test database included', () => {
    for (const name of [
      'opengewerk',
      'opengewerk_test',
      'preview',
      'x"; drop table y; --_preview',
    ]) {
      expect(() =>
        previewDatabaseUrl({
          PREVIEW_DATABASE_URL: `postgres://app:secret@127.0.0.1:5433/${encodeURIComponent(name)}`,
        }),
      ).toThrow(PreviewRefused)
    }
  })

  it('does not start in production', () => {
    expect(() => {
      refuseProduction({ NODE_ENV: 'production' })
    }).toThrow(PreviewRefused)
    expect(() => {
      refuseProduction({ NODE_ENV: 'development' })
    }).not.toThrow()
  })

  it('listens on 3000 unless told otherwise, and only on a real port', () => {
    expect(previewPort({})).toBe(3000)
    expect(previewPort({ PREVIEW_PORT: '3100' })).toBe(3100)
    expect(() => previewPort({ PREVIEW_PORT: 'irgendwo' })).toThrow(PreviewRefused)
    expect(() => previewPort({ PREVIEW_PORT: '70000' })).toThrow(PreviewRefused)
  })
})

describe('the question who is signed in', () => {
  const identity: Identity = {
    userId: previewUser.id,
    tenantId: newId<'tenant'>(),
    roles: previewRoles,
  }
  const answering = express().use('/api/auth', previewSession(identity, previewUser))

  it('is answered with the preview person, the business already chosen', async () => {
    const answer = await request(answering).get('/api/auth/get-session').expect(200)

    expect(answer.body).toMatchObject({
      user: { id: 'preview', twoFactorEnabled: true },
      session: { activeTenantId: identity.tenantId },
    })
  })

  it('is the only one: there is no sign in to reach', async () => {
    const refused = await request(answering)
      .post('/api/auth/sign-in/email')
      .send({ email: 'jemand@example.com', password: 'egal' })
      .expect(404)

    expect((refused.body as { message: string }).message).toContain('keine Anmeldung')
  })
})

describe('the sample data', () => {
  const tenant = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH (Vorschau)' }
  const identity: Identity = { userId: previewUser.id, tenantId: tenant.id, roles: previewRoles }

  let admin: Pool
  let database: Database
  let application: INestApplication
  let base: string

  beforeAll(async () => {
    admin = await connect()
    await resetSchema(admin)
    await applyMigrations()
    await allowApplicationLogin(admin)
    await admitPreviewUser(admin, tenant)

    database = Database.connect(applicationDatabaseUrl())
    application = await openPreview(database, identity)
    await application.listen(0, '127.0.0.1')

    const { port } = application.getHttpServer().address() as AddressInfo
    base = `http://127.0.0.1:${String(port)}`

    await plantSampleData(base, '2026-09-21')
  })

  afterAll(async () => {
    await application.close()
    await database.close()
    await admin.end()
  })

  async function read<Rows>(path: string): Promise<Rows> {
    const response = await fetch(new URL(path, base))

    expect(response.status).toBe(200)

    return (await response.json()) as Rows
  }

  it('goes in through the real routes, and the business is the only one on offer', async () => {
    expect(await read('/auth/tenants')).toEqual([
      { id: tenant.id, name: tenant.name, roles: ['owner'] },
    ])
  })

  it('shows a document in each state and the chain between two of them', async () => {
    const documents = await read<
      {
        id: string
        kind: string
        status: string
        number: string | null
        predecessorDocumentId: string | null
      }[]
    >('/documents')
    const byKind = new Map(documents.map((document) => [document.kind, document]))

    expect(byKind.get('quote')).toMatchObject({ status: 'issued' })
    expect(byKind.get('quote')?.number).toMatch(/\d/)
    expect(byKind.get('order_confirmation')).toMatchObject({
      status: 'draft',
      predecessorDocumentId: byKind.get('quote')?.id,
    })
    expect(byKind.get('cost_estimate')).toMatchObject({ status: 'draft' })
    expect(byKind.get('time_and_material_report')).toMatchObject({ status: 'signed', number: null })
    expect(byKind.get('progress_invoice')).toMatchObject({ status: 'issued' })
    expect(byKind.get('final_invoice')).toMatchObject({
      status: 'draft',
      predecessorDocumentId: byKind.get('progress_invoice')?.id,
    })
  })

  it('carries titles among the lines and snippets for all three places', async () => {
    const documents = await read<{ id: string; kind: string }[]>('/documents')
    const estimate = documents.find((document) => document.kind === 'cost_estimate')
    const lines = await read<{ kind: string }[]>(`/documents/${estimate?.id ?? ''}/lines`)
    const snippets = await read<{ purpose: string }[]>('/documents/text-snippets')

    expect(lines.filter((line) => line.kind === 'title')).toHaveLength(2)
    expect(new Set(snippets.map((snippet) => snippet.purpose))).toEqual(
      new Set(['line', 'intro', 'closing']),
    )
  })

  it('is written down in the audit log under the preview person', async () => {
    const { rows } = await admin.query<{ count: string }>(
      "select count(*) from audit_entries where tenant_id = $1 and user_id = 'preview'",
      [tenant.id],
    )

    expect(Number(rows[0]?.count)).toBeGreaterThan(0)
  })
})
