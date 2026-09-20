/* eslint-disable @typescript-eslint/no-unused-vars */
import type { CellData, RowData, TableFeatures } from '@tanstack/react-table'

/**
 * One flag on a column, for the one thing a column has to say about itself
 * that its data cannot: whether it holds a number.
 *
 * A number is right aligned and set in tabular figures, both at once, or a
 * column of amounts does not line up. Working it out from the value would get
 * it wrong for a house number and for an order number, which are text that
 * happens to look numeric.
 *
 * A file of its own, for two reasons. The three type parameters have to be
 * written out exactly as the package declares them, names and variance
 * annotations included, or TypeScript refuses the merge; none of them is used
 * here and none can be renamed to say so, so the rule about unused names is
 * off for this file and for nothing else. And a `declare module` is part of
 * the program wherever it sits, so nothing has to import this, and no tidy up
 * can remove an import that looked pointless.
 */
declare module '@tanstack/react-table' {
  interface ColumnMeta<
    in out TFeatures extends TableFeatures,
    in out TData extends RowData,
    TValue extends CellData = CellData,
  > {
    readonly numeric?: boolean
  }
}
