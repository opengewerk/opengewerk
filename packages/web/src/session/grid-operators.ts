import type { GridOperator, InstallationKind } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The grid operators of the business and its entry in their installer
 * directories (#306), as the server keeps them.
 *
 * Read and written straight at the route, like the text snippets: the office
 * keeps them at a desk, and no device carries them into a cellar. An
 * installation carries only the key of its grid operator.
 */
export interface GridOperatorEntry extends GridOperator {
  /** How many installations name it. */
  readonly installations: number
}

/** An installation that names a grid operator, as the page of the operator lists it. */
export interface GridOperatorInstallation {
  readonly id: string
  readonly kind: InstallationKind
  readonly designation: string
  readonly site: string
  readonly customer: string
  readonly reference: string | null
}

export type GridOperatorValues = Partial<Omit<GridOperator, 'id'>>

/** The grid operator of one installation as its card shows it, by the right to the installation. */
export interface InstallationGridOperator {
  readonly operator: {
    readonly id: string
    readonly name: string
    readonly portalUrl: string | null
  } | null
  readonly reference: string | null
}

const path = '/grid-operators'

export function gridOperators(): Promise<readonly GridOperatorEntry[]> {
  return request<readonly GridOperatorEntry[]>(path)
}

export function gridOperator(
  id: string,
): Promise<GridOperatorEntry & { readonly named: readonly GridOperatorInstallation[] }> {
  return request(`${path}/${encodeURIComponent(id)}`)
}

export function createGridOperator(values: GridOperatorValues): Promise<GridOperatorEntry> {
  return request<GridOperatorEntry>(path, { method: 'POST', body: JSON.stringify(values) })
}

export function updateGridOperator(
  id: string,
  values: GridOperatorValues,
): Promise<GridOperatorEntry> {
  return request<GridOperatorEntry>(`${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  })
}

export function removeGridOperator(id: string): Promise<unknown> {
  return request(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

function installationPath(installationId: string, end: string): string {
  return `/installations/${encodeURIComponent(installationId)}/${end}`
}

export function installationGridOperator(
  installationId: string,
): Promise<InstallationGridOperator> {
  return request<InstallationGridOperator>(installationPath(installationId, 'grid-operator'))
}

/** "Anmeldung beim Netzbetreiber", printed by the server. */
export function gridApplicationAddress(installationId: string): string {
  return installationPath(installationId, 'grid-application')
}

/** "Fertigmeldung an den Netzbetreiber", with the commissioning protocols behind it. */
export function gridCompletionAddress(installationId: string): string {
  return installationPath(installationId, 'grid-completion')
}

/** "Ausfüllhilfe für das Marktstammdatenregister". */
export function marketRegisterAddress(installationId: string): string {
  return installationPath(installationId, 'market-register')
}
