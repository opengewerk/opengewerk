import type { IsoDate, TenantParameterKey } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * One period of a setting the business made about its own taxation.
 *
 * Read and written straight at the route, like the letterhead. It is nothing a
 * device carries into a cellar: it decides how an invoice is issued, and that
 * happens on the server.
 */
export interface ParameterPeriod {
  readonly id: string
  readonly key: TenantParameterKey
  readonly validFrom: IsoDate
  readonly validUntil: IsoDate | null
  readonly value: number
  readonly note: string | null
}

/** A new period, from a day onwards. The one before it ends the day before. */
export interface ParameterSetting {
  readonly key: TenantParameterKey
  readonly from: IsoDate
  readonly value: number
  readonly note: string | null
}

const path = '/settings/parameters'

/** Every period of every setting, the newest first within each key. */
export function parameterHistory(): Promise<readonly ParameterPeriod[]> {
  return request<readonly ParameterPeriod[]>(path)
}

export function setParameter(setting: ParameterSetting): Promise<ParameterPeriod> {
  return request<ParameterPeriod>(path, { method: 'POST', body: JSON.stringify(setting) })
}
