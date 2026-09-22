import type { SmtpSecurity } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/** Whether the business sends mail, and from which address. */
export interface MailStatus {
  readonly configured: boolean
  readonly from: string | null
}

/**
 * Read at the route, like the other settings: whether a business sends mail
 * is nothing a device carries around. Everybody who reads the settings may
 * ask, because the office needs the answer before it offers "Per E-Mail".
 */
export function mailStatus(): Promise<MailStatus> {
  return request<MailStatus>('/settings/mail')
}

/**
 * The mail server of the business as the server shows it: never with the
 * password, only whether there is one and whether it still opens.
 */
export interface MailServer {
  readonly host: string
  readonly port: number
  readonly security: SmtpSecurity
  readonly username: string | null
  readonly fromAddress: string
  readonly signature: string | null
  readonly password: 'none' | 'set' | 'unreadable'
  readonly passwordSetAt: string | null
  readonly updatedAt: string
}

/** What the form sends. A password is sent only when one was typed. */
export interface MailServerInput {
  readonly host: string
  readonly port: number | null
  readonly security: SmtpSecurity
  readonly username: string | null
  readonly password?: string
  readonly fromAddress: string
  readonly signature: string | null
}

/** What asking the mail server found. */
export type MailServerCheck =
  | { readonly outcome: 'ready' }
  | { readonly outcome: 'refused'; readonly reason: string }
  | { readonly outcome: 'unreachable'; readonly reason: string }

/** What saving answers: the settings as kept, and what the mail server said to them. */
export interface SavedMailServer {
  readonly server: MailServer
  readonly check: MailServerCheck
}

const server = '/settings/mail/server'

/** Behind `mail.read`, which only the owner has. */
export async function mailServer(): Promise<MailServer | null> {
  return (await request<{ server: MailServer | null }>(server)).server
}

/**
 * Saves the settings, after the server has asked the mail server. A new
 * connection the mail server refuses is not saved, and the refusal says why.
 */
export function saveMailServer(input: MailServerInput): Promise<SavedMailServer> {
  return request<SavedMailServer>(server, { method: 'PUT', body: JSON.stringify(input) })
}

export async function removeMailServer(): Promise<void> {
  await request(server, { method: 'DELETE' })
}

/** Tries the settings as they stand in the form, saved or not. Sends nothing. */
export function checkMailServer(input: MailServerInput): Promise<MailServerCheck> {
  return request<MailServerCheck>(`${server}/check`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
