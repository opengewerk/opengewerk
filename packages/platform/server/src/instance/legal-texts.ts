import { BadRequestException } from '@nestjs/common'
import {
  type InstanceLegalTextsView,
  type LegalTextKind,
  legalTextKinds,
  legalTextProblem,
  type LegalTexts,
} from '@opengewerk/platform-domain'
import { eq, sql } from 'drizzle-orm'

import { accountsOf } from '../authentication/administration.js'
import type { Database } from '../database/database.js'
import { instanceSettings } from '../schema.js'

/**
 * The legal texts of the instance (opengewerk-haustechnik#129): its legal
 * notice and its notice on data protection, kept by whoever runs it on a
 * screen of its area and read by anybody, before signing in as well. Two
 * columns of the settings of the instance, so that a change stands in its log
 * like every other change of the instance.
 */

/** The column each text is kept in, as the log of the instance names it. */
const columns = {
  imprint: 'imprint',
  privacy: 'privacy_notice',
} as const satisfies Record<LegalTextKind, string>

const missing =
  'The settings of the instance are missing; the migration that creates the table writes them.'

async function textsOf(
  database: Database,
  asUser?: string,
): Promise<{ readonly imprint: string | null; readonly privacy: string | null }> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .select({ imprint: instanceSettings.imprint, privacy: instanceSettings.privacyNotice })
        .from(instanceSettings)
        .where(eq(instanceSettings.id, 1)),
    asUser,
  )

  if (!row) {
    throw new Error(missing)
  }

  return row
}

/**
 * The texts for anybody: the text, or null where none is kept. Nothing else
 * of the instance comes with them, neither who keeps them nor when.
 */
export function readLegalTexts(database: Database): Promise<LegalTexts> {
  return textsOf(database)
}

/** The texts for their screen: each with when it was last changed and by whom, out of the log. */
export async function readInstanceLegalTexts(
  database: Database,
  asUser: string,
): Promise<InstanceLegalTextsView> {
  const texts = await textsOf(database, asUser)
  const last = await database.forInstance(async (tx) => {
    const found = await tx.execute(sql`
      select distinct on (field) field, changed_at, user_id
        from instance_changes
       where table_name = 'instance_settings' and field in (${columns.imprint}, ${columns.privacy})
       order by field, id desc`)

    return found.rows as { field: string; changed_at: string; user_id: string | null }[]
  }, asUser)
  const people = last.flatMap((change) => (change.user_id ? [change.user_id] : []))
  const accounts = await accountsOf(database, people, asUser)

  const view = (kind: LegalTextKind) => {
    const change = last.find((entry) => entry.field === columns[kind])
    const person = change?.user_id ? accounts.get(change.user_id) : undefined

    return {
      text: texts[kind],
      changedAt: change ? new Date(change.changed_at).toISOString() : null,
      changedBy: person?.name ?? null,
    }
  }

  return { imprint: view('imprint'), privacy: view('privacy') }
}

/**
 * What a request may change: either text, or both. An empty text, or one of
 * nothing but spaces, removes it, and with it the link to it.
 */
export function checkedLegalTexts(body: unknown): Partial<Record<LegalTextKind, string | null>> {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const change: Partial<Record<LegalTextKind, string | null>> = {}

  for (const kind of legalTextKinds) {
    if (!(kind in record)) {
      continue
    }

    const value = record[kind]

    if (value !== null && typeof value !== 'string') {
      throw new BadRequestException(`${kind} ist ein Text.`)
    }

    const text = (value ?? '').replace(/\r\n?/g, '\n').trim()
    const problem = legalTextProblem(text)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    change[kind] = text === '' ? null : text
  }

  if (Object.keys(change).length === 0) {
    throw new BadRequestException('Es fehlt der Text, der gespeichert werden soll.')
  }

  return change
}

/** Saves what changed, on the way the log of the instance names "Rechtstexte ändern". */
export async function saveLegalTexts(
  database: Database,
  userId: string,
  change: Partial<Record<LegalTextKind, string | null>>,
): Promise<InstanceLegalTextsView> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .update(instanceSettings)
        .set({
          ...('imprint' in change ? { imprint: change.imprint } : {}),
          ...('privacy' in change ? { privacyNotice: change.privacy } : {}),
          updatedAt: new Date(),
        })
        .where(eq(instanceSettings.id, 1))
        .returning({ id: instanceSettings.id }),
    userId,
    'instance.legal',
  )

  if (!row) {
    throw new Error(missing)
  }

  return readInstanceLegalTexts(database, userId)
}
