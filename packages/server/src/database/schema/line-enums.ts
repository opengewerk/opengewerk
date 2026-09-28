import { lineKinds, lineUnits, vatRates } from '@opengewerk/domain'
import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * The enumerations of a document line, in a module of their own: an article
 * is counted in a unit as well (#296), and a line points at its article, so
 * the two tables would otherwise import each other.
 */
export const lineKind = pgEnum('line_kind', lineKinds)
export const lineUnit = pgEnum('line_unit', lineUnits)
export const vatRate = pgEnum('vat_rate', vatRates)
