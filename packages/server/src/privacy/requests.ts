import {
  customerErasureDueOn,
  type CustomerId,
  type ErasureRequest,
  type ErasureRequestId,
  erasureRequestAnswer,
  type ErasureRequestView,
  type IsoDate,
} from '@opengewerk/domain'
import { type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, ne } from 'drizzle-orm'

import { erasureRequests } from '../database/schema/index.js'
import { contactMonthsOf, customerStandings } from './customer-erasure.js'

/** What a request reads as, from its row. */
export function erasureRequestOf(row: typeof erasureRequests.$inferSelect): ErasureRequest {
  return {
    id: row.id as ErasureRequestId,
    customerId: row.customerId as CustomerId,
    receivedOn: row.receivedOn as IsoDate,
    channel: row.channel,
    status: row.status,
    answerDueOn: row.answerDueOn as IsoDate,
    restrictedAt: row.restrictedAt?.toISOString() ?? null,
    erasedAt: row.erasedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * The requests that run, open and restricted, oldest first, or the one of a
 * customer: each with what holds its customer today, how it can be answered
 * and when the customer falls due (#845).
 */
export async function runningRequestsOf(
  tx: TenantTransaction,
  today: IsoDate,
  customerId?: string,
): Promise<ErasureRequestView[]> {
  const rows = await tx
    .select()
    .from(erasureRequests)
    .where(
      and(
        ne(erasureRequests.status, 'erased'),
        customerId === undefined
          ? undefined
          : eq(erasureRequests.customerId, customerId.toLowerCase() as CustomerId),
      ),
    )
    .orderBy(asc(erasureRequests.receivedOn), asc(erasureRequests.createdAt))

  if (rows.length === 0) {
    return []
  }

  const standings = await customerStandings(
    tx,
    today,
    rows.map((row) => row.customerId),
  )
  const months = await contactMonthsOf(tx)

  return rows.flatMap((row) => {
    const standing = standings.get(row.customerId)

    if (standing === undefined) {
      return []
    }

    return [
      {
        request: erasureRequestOf(row),
        customerName: standing.name,
        holds: standing.holds,
        answer: erasureRequestAnswer(standing.holds),
        dueOn: customerErasureDueOn({
          holds: standing.holds,
          lastContactOn: standing.lastContactOn,
          contactMonths: months,
          requestedOn: row.receivedOn as IsoDate,
        }),
      },
    ]
  })
}
