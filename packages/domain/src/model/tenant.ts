import type { TenantId } from './identifier.js'

/**
 * One company on an instance. Several of them can share a server: number
 * ranges, chart of accounts and branding are set per tenant (ADR 0006).
 */
export interface Tenant {
  readonly id: TenantId
  readonly name: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * The longest name a business may have. It stands in the top bar and in the
 * list a person with several businesses chooses from, so it is the short name
 * the business goes by; the full one for its documents is the letterhead's.
 */
export const businessNameMaxLength = 120

/**
 * What is wrong with a name for a business, as a sentence for the screen, or
 * null when nothing is.
 *
 * The first run and the settings ask the same question with the same words,
 * so that no name comes in through one door that the other would refuse
 * (#276). Surrounding spaces do not count, both routes store the name trimmed.
 */
export function businessNameProblem(name: string): string | null {
  const trimmed = name.trim()

  if (trimmed === '') {
    return 'Der Name des Betriebs fehlt.'
  }

  if (trimmed.length > businessNameMaxLength) {
    return (
      `Der Name des Betriebs ist länger als ${String(businessNameMaxLength)} Zeichen. ` +
      'Der vollständige Name für die Belege gehört unter „Name auf den Belegen“.'
    )
  }

  return null
}
