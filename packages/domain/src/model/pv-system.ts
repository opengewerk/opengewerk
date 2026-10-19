import type { InstallationKind } from './installation.js'

/**
 * What belongs to a PV system besides its inverters, strings and modules
 * (#300): storage, meters and the wallbox are installations of their own, and
 * say which PV system they belong to and at which inverter they hang. The
 * structure below the system comes from the foundation (ADR 0014); which
 * installations may stand beside it is this application's.
 */

/** The kinds of installation that may say they belong to a PV system (#300). */
export const pvCompanionKinds: readonly InstallationKind[] = ['battery', 'meter', 'wallbox']

/** Whether an installation of this kind can belong to a PV system. */
export function belongsToPvSystemKind(kind: unknown): boolean {
  return pvCompanionKinds.includes(kind as InstallationKind)
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Why an installation of this kind cannot name a PV system, or null. The
 * form offers the choice only for these kinds and clears it when the kind
 * changes; the check in the database says the same.
 */
export function pvSystemLinkProblem(kind: unknown, pvSystemId: unknown): string | null {
  return !isSet(pvSystemId) || belongsToPvSystemKind(kind)
    ? null
    : 'Zu einer PV-Anlage gehören nur Speicher, Zähler und Wallbox.'
}

/** Why an installation cannot name this inverter, or null: only together with its PV system. */
export function inverterLinkProblem(pvSystemId: unknown, inverterId: unknown): string | null {
  return !isSet(inverterId) || isSet(pvSystemId)
    ? null
    : 'An einem Wechselrichter hängt nur, was zu seiner PV-Anlage gehört.'
}
