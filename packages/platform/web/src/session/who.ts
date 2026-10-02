import { useQuery } from '@tanstack/react-query'

import { accountQuery, tenantsQuery } from './queries.js'

/** Who is signed in and where, as the header and the menu show it. */
export interface Who {
  readonly name: string
  readonly email: string
  /** Two letters for the round badge in the header. */
  readonly initials: string
  /** The tenant of this session by name, once the list of memberships has arrived. */
  readonly tenant: string | null
  /** The roles there in words, by the names the tenant gives them. */
  readonly roles: string
}

/**
 * Both questions are asked elsewhere already and cached, so the header costs
 * nothing: the account by the gate, the memberships by every check of a right.
 */
export function useWho(): Who {
  const account = useQuery(accountQuery)
  const tenants = useQuery(tenantsQuery)
  const here = tenants.data?.find((tenant) => tenant.id === account.data?.tenantId)
  const name = account.data?.name ?? ''

  return {
    name,
    email: account.data?.email ?? '',
    initials: initialsOf(name),
    tenant: here?.name ?? null,
    roles: here ? rolesInWords(here.roleLabels) : '',
  }
}

/**
 * Several roles in one line, by the names their tenant gives them, for a
 * table cell and for a sentence.
 *
 * A comma and not a slash: somebody with two roles has both, and a slash reads
 * like a choice between them.
 */
export function rolesInWords(labels: readonly string[]): string {
  return labels.join(', ')
}

/** "Erika Berg" becomes "EB", "Beate" becomes "B". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]

  if (!first) {
    return '?'
  }

  const last = parts.length > 1 ? parts[parts.length - 1] : undefined

  return `${first.charAt(0)}${last ? last.charAt(0) : ''}`.toUpperCase()
}
