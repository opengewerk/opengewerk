import { secretsSchema } from '@opengewerk/platform-server'

/**
 * Credentials of somebody else a business hands the instance, sealed. The
 * table and what keeps it are the foundation's (`secretsSchema`, ADR 0010);
 * what a secret opens is this application's list: the login to the mail
 * server of a business, once per business, and the value of a way into a site
 * (#286), once per access.
 *
 * The one table of a business the audit log does not watch, and on purpose:
 * the log is written once and never touched again, and a sealed password in
 * it would be there for good. What the log does get is the moment a password
 * was set, from `mail_settings`, which it watches like every other table.
 *
 * Nothing but `secrets/` reads or writes this table; a test holds that.
 */
export const { secretPurpose, secrets } = secretsSchema(['smtp_password', 'site_access'])
