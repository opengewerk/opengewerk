import {
  backupTimeProblem,
  type InstanceSettingsView,
  mailHostProblem,
} from '@opengewerk/domain'
import { BadRequestException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { instanceSettings } from '../database/schema/index.js'

/**
 * The settings of the instance (#188), one row written by migration 0051:
 * the mail servers in the own network a business may send through, and the
 * hour of the nightly backup. Both lived in the `.env` or in a script before,
 * and both belong to the instance and to no business on it.
 */

type Row = typeof instanceSettings.$inferSelect

function view(row: Row): InstanceSettingsView {
  return {
    mailInternalHosts: row.mailInternalHosts,
    // The database writes a time with seconds, the screen asks for minutes.
    backupTime: row.backupTime.slice(0, 5),
    takenOverAt: row.importedFromEnvironmentAt?.toISOString() ?? null,
  }
}

export async function readInstanceSettings(database: Database): Promise<InstanceSettingsView> {
  const [row] = await database.forInstance((tx) =>
    tx.select().from(instanceSettings).where(eq(instanceSettings.id, 1)),
  )

  if (!row) {
    throw new Error('The settings of the instance are missing; migration 0051 writes them.')
  }

  return view(row)
}

/** What an operator may change, refused in the words of the screen where it does not fit. */
export interface InstanceSettingsChange {
  readonly mailInternalHosts?: readonly string[]
  readonly backupTime?: string
}

export function checkedChange(body: unknown): InstanceSettingsChange {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const change: { mailInternalHosts?: string[]; backupTime?: string } = {}

  if ('mailInternalHosts' in record) {
    const hosts = record['mailInternalHosts']

    if (!Array.isArray(hosts) || hosts.some((host) => typeof host !== 'string')) {
      throw new BadRequestException('mailInternalHosts ist eine Liste von Servern.')
    }

    const cleaned = [...new Set((hosts as string[]).map((host) => host.trim()).filter((host) => host !== ''))]

    if (cleaned.length > 50) {
      throw new BadRequestException('Höchstens 50 freigegebene Mailserver.')
    }

    for (const host of cleaned) {
      const problem = mailHostProblem(host)

      if (problem !== null) {
        throw new BadRequestException(problem)
      }
    }

    change.mailInternalHosts = cleaned
  }

  if ('backupTime' in record) {
    const time = record['backupTime']
    const problem = typeof time === 'string' ? backupTimeProblem(time) : 'backupTime fehlt.'

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    change.backupTime = time as string
  }

  return change
}

export async function saveInstanceSettings(
  database: Database,
  userId: string,
  change: InstanceSettingsChange,
): Promise<InstanceSettingsView> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .update(instanceSettings)
        .set({
          ...(change.mailInternalHosts ? { mailInternalHosts: [...change.mailInternalHosts] } : {}),
          ...(change.backupTime ? { backupTime: change.backupTime } : {}),
          updatedAt: new Date(),
        })
        .where(eq(instanceSettings.id, 1))
        .returning(),
    userId,
    'instance.settings',
  )

  if (!row) {
    throw new Error('The settings of the instance are missing; migration 0051 writes them.')
  }

  return view(row)
}

/**
 * Takes `MAIL_INTERNAL_HOSTS` over from the `.env`, once, so that an update
 * switches off no mail server that worked before it. After that the screen
 * decides, and a later value in the `.env` changes nothing; the template says
 * so. An empty value takes nothing over and leaves the door open for a value
 * set later.
 */
export async function takeOverFromEnvironment(
  database: Database,
  hosts: readonly string[],
): Promise<boolean> {
  if (hosts.length === 0) {
    return false
  }

  const taken = await database.forInstance(
    (tx) =>
      tx
        .update(instanceSettings)
        .set({
          mailInternalHosts: [...hosts],
          importedFromEnvironmentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(instanceSettings.id, 1), isNull(instanceSettings.importedFromEnvironmentAt)))
        .returning({ id: instanceSettings.id }),
    undefined,
    'environment',
  )

  return taken.length > 0
}

/**
 * The settings in memory, for the one question asked on every connection to
 * a mail server: is this host allowed. Read at the start, again after every
 * change through the screen, and every half minute besides, so that a change
 * made by another process of the same instance arrives as well.
 */
export class InstanceSettingsCache {
  private constructor(
    /** Null for settings that never change, `fixed`. */
    private readonly database: Database | null,
    private value: InstanceSettingsView,
  ) {}

  static async load(database: Database): Promise<InstanceSettingsCache> {
    return new InstanceSettingsCache(database, await readInstanceSettings(database))
  }

  /** Settings that never change, for the tests and the preview. */
  static fixed(value: InstanceSettingsView): InstanceSettingsCache {
    return new InstanceSettingsCache(null, value)
  }

  current(): InstanceSettingsView {
    return this.value
  }

  async refresh(): Promise<void> {
    if (this.database === null) {
      return
    }

    this.value = await readInstanceSettings(this.database)
  }

  /** Refreshes every so often until the returned function is called. */
  every(milliseconds: number): () => void {
    const timer = setInterval(() => {
      this.refresh().catch((error: unknown) => {
        console.error('Die Einstellungen der Instanz ließen sich nicht lesen:', error)
      })
    }, milliseconds)

    timer.unref()

    return () => {
      clearInterval(timer)
    }
  }
}
