import { statementBreakpoint } from '../migration/blocks.js'
import { completeInitialMigration, initialMigrationRollback } from '../migration/initial.js'
import * as schema from '../schema.js'
import { defaultMigrationHistory, type MigrationHistory } from './migrations.js'

/** The first migration of an application that has nothing but the foundation. */
export interface FoundationMigration {
  readonly up: string
  readonly down: string
}

/**
 * The foundation alone, as the first migration of a new application carries
 * it: the tables of `@opengewerk/platform-server/schema` the way drizzle-kit
 * writes them, with the building blocks around them.
 *
 * This is what the blocks are measured by. A test builds a database from it
 * and holds the database of an application against the result, which is how a
 * block that has drifted from what the migrations arrived at is noticed.
 *
 * drizzle-kit is asked through its library entry and not through its command:
 * the command writes files and keeps a snapshot, and there is nothing here to
 * keep. It is loaded only when this is called, so that nothing else in the
 * kit pays for it.
 */
export async function foundationMigration(
  history: MigrationHistory = defaultMigrationHistory,
): Promise<FoundationMigration> {
  const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api')

  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson({ ...schema }),
  )
  const generated = statements.join(`${statementBreakpoint}\n`)

  return {
    up: completeInitialMigration(generated),
    down: initialMigrationRollback(generated, history),
  }
}
