import type { RecordState } from '@opengewerk/domain'
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import type { SyncClient, SyncSnapshot } from './client.js'

const SyncContext = createContext<SyncClient | null>(null)

export function SyncProvider({
  client,
  children,
}: {
  readonly client: SyncClient
  readonly children: ReactNode
}) {
  return <SyncContext.Provider value={client}>{children}</SyncContext.Provider>
}

export function useSync(): SyncClient {
  const client = useContext(SyncContext)

  if (!client) {
    throw new Error('Diese Ansicht braucht den Abgleich-Client und steht außerhalb davon.')
  }

  return client
}

/**
 * `useSyncExternalStore` insists that the snapshot be the same value while
 * nothing has changed, and every read here builds a value. The client answers
 * that by caching what it derived and throwing the cache away on the next
 * change, so these three can subscribe to the values directly. Memoising on a
 * counter instead would work and would be a lie to the linter, which cannot
 * see that the counter is what the value depends on.
 */
export function useSyncStatus(): SyncSnapshot {
  const client = useSync()

  return useSyncExternalStore(client.subscribe, client.status, client.status)
}

/** Everything of one kind that still exists, with the outbox laid over it. */
export function useRecords(entity: string): readonly RecordState[] {
  const client = useSync()
  const read = useCallback(() => client.list(entity), [client, entity])

  return useSyncExternalStore(client.subscribe, read, read)
}

export function useRecord(entity: string, id: string | undefined): RecordState | null {
  const client = useSync()
  const read = useCallback(() => (id ? client.get(entity, id) : null), [client, entity, id])

  return useSyncExternalStore(client.subscribe, read, read)
}

/**
 * Everything of one kind whose field points at a given record.
 *
 * The one relation the screens ask for, and they ask for it everywhere: the
 * sites of a customer, the installations of a site, the jobs of a site. Doing
 * it here keeps the filter and its memoisation in one place instead of in six.
 */
export function useRelated(
  entity: string,
  field: string,
  id: string | undefined,
): readonly RecordState[] {
  const all = useRecords(entity)

  return useMemo(() => (id ? all.filter((row) => row[field] === id) : []), [all, field, id])
}
