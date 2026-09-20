import type { Operation, OperationReceipt, RecordState, SyncConflict } from '@opengewerk/domain'

/**
 * The four calls an exchange makes, and nothing else.
 *
 * Kept behind an interface because the client is the piece that has to be
 * testable without a server: what it does with a refusal, a repeat, a lost
 * connection. A test that needs a running instance to check the behaviour
 * offline would be testing the wrong thing.
 */
export interface SyncTransport {
  push(deviceId: string, operations: readonly Operation[]): Promise<readonly OperationReceipt[]>
  pull(since: number): Promise<PullResult>
  conflicts(): Promise<readonly SyncConflict[]>
  resolve(id: string): Promise<void>
}

export interface ChangedRows {
  readonly entity: string
  readonly rows: readonly RecordState[]
}

export interface PullResult {
  readonly changes: readonly ChangedRows[]
  readonly cursor: number
  /** The server stopped at a limit. Ask again from the new cursor. */
  readonly hasMore: boolean
}

/**
 * The server said no, and said why.
 *
 * Told apart from a lost connection on purpose. A refusal is an answer and the
 * outbox must not simply try again in thirty seconds; a lost connection is not
 * an answer and trying again is exactly right. Treating both the same is how
 * an outbox ends up hammering a server that has already said the record is
 * fixed.
 */
export class RequestRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RequestRefused'
  }
}

/** Nobody is signed in, or the session has run out. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof RequestRefused && (error.status === 401 || error.status === 403)
}

async function refusal(response: Response): Promise<RequestRefused> {
  // Nest puts the sentence in `message`; anything else gets the status.
  const fallback = `Der Server hat die Anfrage abgelehnt (${response.status}).`

  try {
    const body = (await response.json()) as { message?: unknown }
    const message = body.message

    return new RequestRefused(
      response.status,
      typeof message === 'string' ? message : Array.isArray(message) ? message.join(' ') : fallback,
    )
  } catch {
    return new RequestRefused(response.status, fallback)
  }
}

export async function request<Answer>(path: string, init?: RequestInit): Promise<Answer> {
  const response = await fetch(path, {
    // The session is a cookie. Without this it is simply not sent, and every
    // call comes back as "not signed in" while the browser holds the cookie.
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw await refusal(response)
  }

  if (response.status === 204) {
    return undefined as Answer
  }

  return (await response.json()) as Answer
}

/**
 * An operation on the wire.
 *
 * `recordedAt` becomes its ISO form here and nowhere else. The server parses
 * it back into a moment, and both sides then compare the same thing; a `Date`
 * handed to `JSON.stringify` would do the same silently, which is fine until
 * somebody changes the field and the silence stops being a coincidence.
 */
function onTheWire(operation: Operation) {
  return {
    id: operation.id,
    entity: operation.entity,
    recordId: operation.recordId,
    kind: operation.kind,
    baseVersion: operation.baseVersion,
    patches: operation.patches,
    recordedAt: operation.recordedAt.toISOString(),
  }
}

/**
 * The other way a change reaches the server: straight at the route that owns
 * the record, with a connection, now.
 *
 * ADR 0005 says master data is only corrected online, and that is what this
 * is. It is not a shortcut past the outbox: the outbox exists so that work in
 * a cellar is not lost, and correcting a customer's address is not that kind
 * of work. Two devices that both fix the same address are a question for the
 * office, and the office has a connection.
 *
 * The route is the table name, which holds for every entity a screen here
 * writes. A document line is the exception and is not one of them: it is
 * written through its document and only through the outbox.
 */
export const directWrite = {
  patch(entity: string, id: string, values: Readonly<Record<string, unknown>>): Promise<unknown> {
    return request(`/${entity}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    })
  },

  remove(entity: string, id: string): Promise<unknown> {
    return request(`/${entity}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}

export const httpTransport: SyncTransport = {
  async push(deviceId, operations) {
    const answer = await request<{ receipts: readonly OperationReceipt[] }>('/sync', {
      method: 'POST',
      body: JSON.stringify({ deviceId, operations: operations.map(onTheWire) }),
    })

    return answer.receipts
  },

  pull(since) {
    return request<PullResult>(`/sync?since=${String(since)}`)
  },

  conflicts() {
    return request<readonly SyncConflict[]>('/sync/conflicts')
  },

  async resolve(id) {
    await request(`/sync/conflicts/${encodeURIComponent(id)}/resolve`, { method: 'POST' })
  },
}
