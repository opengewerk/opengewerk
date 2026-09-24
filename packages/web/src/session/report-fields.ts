import type { FormDefinition, ReportField } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

/**
 * The fields a business gives its reports (#78), at the route that keeps them.
 *
 * Written straight at the route, like every setting: a change is the next
 * version, and the server decides which number it gets. Devices read the
 * versions through the sync, since a report is filled in without a network.
 */

const path = '/settings/report-fields'

/** The newest version, or none while the business has not written any. */
export async function currentReportFields(): Promise<FormDefinition | null> {
  return (await request<{ readonly definition: FormDefinition | null }>(path)).definition
}

/** Saves the fields as the next version; the same fields again stay the version they are. */
export async function saveReportFields(fields: readonly ReportField[]): Promise<FormDefinition> {
  return (
    await request<{ readonly definition: FormDefinition }>(path, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    })
  ).definition
}
