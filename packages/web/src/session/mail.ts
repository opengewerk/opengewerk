import { request } from '../sync/transport.js'

/** Whether the instance sends mail, and from which address. */
export interface MailStatus {
  readonly configured: boolean
  readonly from: string | null
}

/**
 * Read at the route, like the other settings: whether a mail server is set up
 * is a fact about the instance, and nothing a device carries around.
 */
export function mailStatus(): Promise<MailStatus> {
  return request<MailStatus>('/settings/mail')
}
