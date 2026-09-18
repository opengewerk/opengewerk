import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are SQL files in the repository, not something an ORM invents at
 * startup (ADR 0003). Once a migration is merged it is immutable: a correction
 * is a new file, because the old one has already run on someone's database.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://opengewerk:probe@127.0.0.1:5433/opengewerk',
  },
})
