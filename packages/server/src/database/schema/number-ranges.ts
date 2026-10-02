import { numberRangeKeys } from '@opengewerk/domain'
import { numberRangesSchema } from '@opengewerk/platform-server'

/**
 * The counters of the numbers that run without holes: one row per business
 * and sequence, a job, a quote, an invoice.
 *
 * The table is the foundation's (`numberRangesSchema`, ADR 0010), which is
 * where its columns and the reason for a counter in a row are described. What
 * this application says is which sequences there are, and that list lives in
 * `domain`, where the interface reads it as well.
 */
export const { numberRangeKey, numberRanges } = numberRangesSchema(numberRangeKeys)
