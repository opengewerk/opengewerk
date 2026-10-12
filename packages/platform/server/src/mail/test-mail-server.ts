import type { Pool } from 'pg'

import { SecretKey } from '../secrets/key.js'

/**
 * Sets up the mail server of the instance, without a login, as the superuser
 * (opengewerk-haustechnik#81): for the tests that need an instance which
 * sends a mail to an account and do not care how it reaches its server.
 */
export async function anInstanceMailServer(
  admin: Pool,
  from = 'konten@instanz.example.de',
): Promise<void> {
  await admin.query(
    `update instance_settings
        set mail_server_host = 'mail.instanz.example.de', mail_server_port = 587,
            mail_server_security = 'starttls', mail_server_username = null,
            mail_server_from = $1, mail_server_password = null,
            mail_server_password_set_at = null`,
    [from],
  )
}

/** Takes the mail server of the instance away again. */
export async function noInstanceMailServer(admin: Pool): Promise<void> {
  await admin.query(
    `update instance_settings
        set mail_server_host = null, mail_server_port = null, mail_server_security = null,
            mail_server_username = null, mail_server_from = null, mail_server_password = null,
            mail_server_password_set_at = null`,
  )
}

/** The key the tests seal with, in place of one derived from SESSION_SECRET. */
export const testKey = SecretKey.from('t'.repeat(64))

/**
 * Sets up a mail server for a tenant, without a login, as the superuser.
 *
 * For the tests that need a tenant which sends mail and do not care how it
 * reaches its server: the job hands the settings to whatever transport the
 * test gives it, and nothing ever connects to `mail.example.de`.
 */
export async function aMailServer(
  admin: Pool,
  tenantId: string,
  over: { readonly from?: string; readonly signature?: string | null } = {},
): Promise<void> {
  await admin.query(
    `insert into mail_settings (tenant_id, host, port, security, from_address, signature)
     values ($1, 'mail.example.de', 587, 'starttls', $2, $3)
     on conflict (tenant_id) do update
       set host = excluded.host, port = excluded.port, security = excluded.security,
           username = null, password_set_at = null,
           from_address = excluded.from_address, signature = excluded.signature`,
    [tenantId, over.from ?? 'buero@nord.example.de', over.signature ?? null],
  )
}
