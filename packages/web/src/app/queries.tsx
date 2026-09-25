import type { Permission, RoleKey } from '@opengewerk/domain'
import { rolesAllow } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider, queryOptions, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { isForbidden, isUnauthenticated } from '../sync/transport.js'
import { availableTenants, currentAccount } from '../session/session.js'

/**
 * The cache for what is not a synced record.
 *
 * Two kinds of state live in this application and they are kept apart. What a
 * device has to be able to read in a cellar goes through the sync client,
 * which holds it in IndexedDB and answers without a network. What only makes
 * sense with a connection, who is signed in, which businesses, which devices,
 * goes through here.
 *
 * Mixing them is the mistake this split exists to avoid: a customer list
 * behind a query cache would be empty offline and would look like a business
 * with no customers.
 */
export const queries = new QueryClient({
  defaultOptions: {
    queries: {
      // Once. The office is not on a train, and a question that fails twice
      // usually fails for a reason that a third attempt will not change.
      retry: (attempt, error) => attempt < 1 && !isUnauthenticated(error) && !isForbidden(error),
      // An expired session has to be noticed, and these answers are small.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  },
})

/**
 * Who is signed in, the one question every screen may ask and every screen
 * asks in the same way.
 *
 * One definition, because the options travel with the query and not with the
 * screen: a second screen asking with other options changes them for all.
 * That is how the site could not start offline even after it could: the gate
 * asked without retrying, a list further down asked with a retry, and the
 * retry, waiting for a focus that a phone in a pocket does not have, put the
 * question back to "not answered yet" and the gate back in front (#123).
 *
 * Asked even when the browser says it is offline. Paused, as TanStack Query
 * does by default, the question never settles; asked, `currentAccount`
 * answers with who was signed in here last.
 */
export const accountQuery = queryOptions({
  queryKey: ['account'],
  queryFn: currentAccount,
  // An expired session has to be noticed, and the answer is cheap. Asking
  // again on every focus is what turns "nothing works any more" into a sign
  // in screen.
  staleTime: 30_000,
  retry: false,
  networkMode: 'always',
})

export function QueryProvider({
  client,
  children,
}: {
  readonly client: QueryClient
  readonly children: ReactNode
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * What the person in front of this screen may do in the business they are
 * working in.
 *
 * Both answers are already asked for elsewhere and both are cached, so this
 * costs nothing on a screen that has been open for a moment. It is read from
 * the same two places the gate reads: which business the session is on, and
 * what the membership in it says.
 *
 * It decides what the navigation offers and nothing else. A hidden entry is a
 * courtesy; the gate is the guard on the server, which asks the membership the
 * same question on every request. Somebody who types the address of a screen
 * they may not use reaches it and then gets a refusal from the routes behind
 * it, which is the right way round.
 */
export function useMay(permission: Permission): boolean {
  const account = useQuery(accountQuery)
  const tenants = useQuery({
    queryKey: ['tenants'],
    queryFn: availableTenants,
    // The roles of a session do not change while somebody looks at a screen,
    // and when they do the routes behind this say so at once.
    staleTime: 5 * 60_000,
    retry: false,
  })

  const here = tenants.data?.find((tenant) => tenant.id === account.data?.tenantId)

  return here ? rolesAllow(here.roles as readonly RoleKey[], permission) : false
}
