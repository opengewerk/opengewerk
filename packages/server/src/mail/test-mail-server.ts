import type { Pool } from 'pg'

import { SecretKey } from '../secrets/key.js'

/** The key the tests seal with, in place of one derived from SESSION_SECRET. */
export const testKey = SecretKey.from('t'.repeat(64))

/**
 * Sets up a mail server for a business, without a login, as the superuser.
 *
 * For the tests that need a business which sends mail and do not care how it
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
