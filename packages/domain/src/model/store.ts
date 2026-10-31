import { stockUnits } from '@opengewerk/platform-domain'

/**
 * The stores of the business (#298, Feature-Gliederung 4.5): its stores and
 * its service vehicles, kept with the stock of the foundation (ADR 0011). What
 * this application adds to a store: whether it is a vehicle, and its number
 * plate.
 */
export const storeLimits = {
  /** A German number plate with its separators, "HD-OG 412", and room to spare. */
  plate: 12,
} as const

/**
 * What is wrong with what this application adds to a store, as the store
 * would stand afterwards: whether it is a vehicle, and a number plate only a
 * vehicle has. The foundation checks the name and where it is.
 */
export function storeOfBusinessProblems(
  store: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const vehicle = store['vehicle']
  const plate = store['plate']

  if (vehicle !== undefined && typeof vehicle !== 'boolean') {
    problems['vehicle'] = 'Ein Lagerort ist ein Fahrzeug oder nicht.'
  }

  if (plate !== undefined && plate !== null) {
    if (typeof plate !== 'string' || plate.trim().length > storeLimits.plate) {
      problems['plate'] = `Ein Kennzeichen hat höchstens ${String(storeLimits.plate)} Zeichen.`
    } else if (vehicle !== true) {
      problems['plate'] = 'Ein Kennzeichen hat nur ein Fahrzeug.'
    }
  }

  return problems
}

/**
 * Whether an article in this unit may lie in a store: a piece, a metre, a
 * square metre, a kilogram, a litre or a package. Hours, days, cubic metres
 * of work and a lump sum are sold, never kept (Feature-Gliederung 4.5).
 */
export function isStockUnit(unit: string): boolean {
  return (stockUnits as readonly string[]).includes(unit)
}
