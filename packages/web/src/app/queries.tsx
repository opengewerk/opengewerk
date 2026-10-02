import type { Permission } from '@opengewerk/domain'
import { useRight } from '@opengewerk/platform-web/session'

/**
 * What the person in front of this screen may do in the business they are
 * working in, asked with a right of this application.
 *
 * The question itself is the foundation's (ADR 0010) and is answered from
 * what the server resolved for the session. What is added here is the list of
 * names it may be asked with: a right this application does not have is a
 * type error at the screen that asks for it, instead of an entry that never
 * shows.
 */
export function useMay(permission: Permission): boolean {
  return useRight(permission)
}
