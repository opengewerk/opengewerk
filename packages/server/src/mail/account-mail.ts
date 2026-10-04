import { type Database, everyTenant } from '@opengewerk/platform-server'

/**
 * Whether a mail to an account may go out through the mail server of a
 * business at all (opengewerk-haustechnik#31).
 *
 * An account belongs to the instance, and every mail server to a business,
 * set up by whoever leads it. With a second business on the instance, its lead
 * could take somebody's account into it and set up a mail server of their own,
 * and the link to a new password would go out through that server, to be read
 * there; the notice of a new passkey would land in the outbox of that business.
 * Until the instance has a mail server of its own, set up by those who run it,
 * a mail to an account goes out only on an instance with one business. On any
 * other the way back into an account is the owner, or `reset-password` on the
 * server.
 */
export async function mayMailAccounts(database: Database): Promise<boolean> {
  return (await everyTenant(database)).length === 1
}
