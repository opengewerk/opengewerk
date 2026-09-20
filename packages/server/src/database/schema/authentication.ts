import type { TenantId } from '@opengewerk/domain'
import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { outsideAnyTenant, readableByTheOwner } from './rls.js'
import { tenants } from './tenants.js'

/**
 * The tables better-auth keeps its accounts in (ADR 0006).
 *
 * Three things about them are different from every other table here, and all
 * three follow from one fact: a user belongs to the instance, not to a
 * business. The same person can be the owner of one company and the bookkeeper
 * of another, so there is no tenant to put in a column.
 *
 * 1. **No `tenant_id`.** What ties a user to a business is a membership, and
 *    that is a table of its own, with a tenant, in `memberships.ts`.
 * 2. **No audit trigger.** The trigger takes the tenant from the row and puts
 *    it in a column that cannot be null, so a row without one would make every
 *    sign up fail. What a business may see of a sign in is in `tenantSessions`
 *    instead, which does have a tenant and is watched like everything else.
 * 3. **A policy that turns the usual one around.** Everywhere else a row is
 *    visible while a tenant is set; here a row is visible only while none is.
 *    The two are mutually exclusive, so a request that is working inside a
 *    business cannot read the list of everybody on the instance, and it cannot
 *    do so by accident either. See `outsideAnyTenant`.
 *
 * The field names are better-auth's, because its adapter looks a column up by
 * the name the library uses. The column names are ours, snake case like the
 * rest of the schema. Anything renamed on either side stops the sign in, which
 * is why both names are written out here rather than left to a convention.
 */
export const authUsers = pgTable(
  'auth_users',
  {
    // better-auth mints these itself and they are not UUIDv7, so this is text
    // and not `primaryId`. Nothing offline creates a user, so the reason the
    // rest of the schema has UUIDv7 does not apply.
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /**
     * Whether a second factor is set up. Whether one is *required* is not
     * stored: it follows from the roles of the membership, so that it cannot
     * be switched off for an owner (ADR 0006, `requiresSecondFactor`).
     */
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The second one is for the first run setup, which asks whether there is an
  // account on this instance from a function that runs as the owner of the
  // tables. See `readableByTheOwner`.
  () => [outsideAnyTenant(), readableByTheOwner()],
)

/**
 * One sign in on one device.
 *
 * `activeTenantId` is the whole reason a session of ours is not just
 * better-auth's: the business is chosen after signing in and is then read from
 * here on every request. It never comes from the request body, and the test
 * that says so has been in place since before there was anything to sign in
 * to.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /**
     * The business this session is working in, chosen after signing in. Null
     * until it is, and a request in that state is refused: guessing a tenant
     * for somebody who belongs to two would be the one mistake that cannot be
     * noticed from the outside.
     */
    activeTenantId: uuid('active_tenant_id')
      .references(() => tenants.id, { onDelete: 'restrict' })
      .$type<TenantId>(),
    /**
     * The device, when the sign in came from a registered one. The same
     * identifier the sync layer stamps on a record, so that a change made in a
     * basement and the session it was made in can be put side by side.
     */
    deviceId: text('device_id'),
    /**
     * A long session on a registered device, a short one otherwise (ADR 0006).
     * Kept on the row rather than derived from the expiry, because the expiry
     * moves as the session is refreshed and would stop answering the question.
     */
    longLived: boolean('long_lived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [outsideAnyTenant()],
)

/** Where a password lives, and later where a connected provider would. */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** Argon2id, set in `authentication.ts`. Never the password itself. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [outsideAnyTenant()],
)

/** Short lived one time values: address confirmation, a pending second factor. */
export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [outsideAnyTenant()],
)

/** The TOTP secret and the backup codes, both encrypted by the library. */
export const authTwoFactors = pgTable(
  'auth_two_factors',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').default(false),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  () => [outsideAnyTenant()],
)

/**
 * A passkey. The better option of the two second factors on a building site:
 * it needs no phone in a pocket under a jacket, and it cannot be read out over
 * the shoulder.
 */
export const authPasskeys = pgTable(
  'auth_passkeys',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [outsideAnyTenant()],
)

/**
 * The counter behind the rate limits (ADR 0006).
 *
 * In the database rather than in memory on purpose: a limit that lives in one
 * process forgets everything on a restart, and restarting is exactly what an
 * attacker gets for free during an update.
 */
export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    count: integer('count').notNull(),
    // Milliseconds since the epoch, which is past what an integer holds.
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  () => [outsideAnyTenant()],
)
