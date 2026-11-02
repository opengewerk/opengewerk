import type { FundingProgram } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The funding programmes of the business as templates (#307), as the server
 * keeps them.
 *
 * Read and written straight at the route, like the grid operators: the office
 * keeps them at a desk, and no device carries them into a cellar. No
 * installation names one; the papers of a programme are printed when asked.
 */
export type FundingProgramEntry = FundingProgram

export type FundingProgramValues = Partial<Omit<FundingProgram, 'id'>>

const path = '/funding-programs'

export function fundingPrograms(): Promise<readonly FundingProgramEntry[]> {
  return request<readonly FundingProgramEntry[]>(path)
}

export function fundingProgram(id: string): Promise<FundingProgramEntry> {
  return request<FundingProgramEntry>(`${path}/${encodeURIComponent(id)}`)
}

export function createFundingProgram(values: FundingProgramValues): Promise<FundingProgramEntry> {
  return request<FundingProgramEntry>(path, { method: 'POST', body: JSON.stringify(values) })
}

export function updateFundingProgram(
  id: string,
  values: FundingProgramValues,
): Promise<FundingProgramEntry> {
  return request<FundingProgramEntry>(`${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  })
}

export function removeFundingProgram(id: string): Promise<unknown> {
  return request(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** "Förderunterlagen" of a programme for an installation, printed by the server. */
export function fundingPapersAddress(installationId: string, programId: string): string {
  return `/installations/${encodeURIComponent(installationId)}/funding/${encodeURIComponent(programId)}`
}
