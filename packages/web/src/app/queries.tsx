import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { isUnauthenticated } from '../sync/transport.js'

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
      retry: (attempt, error) => attempt < 1 && !isUnauthenticated(error),
      // An expired session has to be noticed, and these answers are small.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  },
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
