import { StaffScreen as Staff } from '@opengewerk/platform-web/office'
import { useQuery } from '@tanstack/react-query'

import { mailStatus } from '../../session/mail.js'

/**
 * "Zugänge" in the office. The screen is the foundation's (ADR 0010): who
 * works in the business, with which roles and on which devices, and the
 * invitations still open. Two things only this application knows, and it
 * hands them in here.
 *
 * Whether the business sends mail is asked at the route of its mail settings
 * (#81), which is this application's: with a mail server an invitation can
 * go out by mail instead of as a link to pass on.
 *
 * A new colleague is a technician more often than anything else, so the form
 * starts with that role ticked, as it always has.
 */
export function StaffScreen() {
  const mail = useQuery({ queryKey: ['mail-status'], queryFn: mailStatus })

  return <Staff byMail={mail.data?.configured === true} suggestedRoles={['technician']} />
}
