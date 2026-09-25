import type { RoleKey } from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'

import { rolesInWords } from './labels.js'
import { accountQuery } from './queries.js'
import { availableTenants } from '../session/session.js'

/** Who is signed in and where, as the header and the menu show it. */
export interface Who {
  readonly name: string
  readonly email: string
  /** Two letters for the round badge in the header. */
  readonly initials: string
  /** The business of this session, once the list of memberships has arrived. */
  readonly business: string | null
  /** "Inhaber, Büro", in words. */
  readonly roles: string
}

/**
 * Both questions are asked elsewhere already and cached, so the header costs
 * nothing: the account by the gate, the memberships by every check of a right.
 */
export function useWho(): Who {
  const account = useQuery(accountQuery)
  const tenants = useQuery({
    queryKey: ['tenants'],
    queryFn: availableTenants,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const here = tenants.data?.find((tenant) => tenant.id === account.data?.tenantId)
  const name = account.data?.name ?? ''

  return {
    name,
    email: account.data?.email ?? '',
    initials: initialsOf(name),
    business: here?.name ?? null,
    roles: here ? rolesInWords(here.roles as readonly RoleKey[]) : '',
  }
}

/** "Moritz Kohm" becomes "MK", "Beate" becomes "B". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]

  if (!first) {
    return '?'
  }

  const last = parts.length > 1 ? parts[parts.length - 1] : undefined

  return `${first.charAt(0)}${last ? last.charAt(0) : ''}`.toUpperCase()
}
