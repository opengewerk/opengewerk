import { isStockUnit, type Permission, storeOfBusinessProblems } from '@opengewerk/domain'
import type { StockRights, StockRoutes, StockTables } from '@opengewerk/platform-server'

import {
  articles,
  stockMovements,
  storeArticles,
  stores,
  suppliers,
} from '../database/schema/index.js'

/**
 * The stores of the business on the routes of the foundation (#298, ADR
 * 0011). Reading goes with the right to read the articles, as every device
 * holds the stock of the vehicles anyway; booking is the owner's and the
 * office's (`stock.write`, decided on 31.10.2026).
 */
export const stockRights: StockRights<Permission> = {
  read: 'article.read',
  write: 'stock.write',
}

export const stockRoutes: StockRoutes = {
  // The routes read and write only what every stock has; the columns of this
  // application beside are named below.
  tables: { articles, suppliers, stores, storeArticles, stockMovements } as unknown as StockTables,
  storeFields: ['vehicle', 'plate'],
  storeProblems: storeOfBusinessProblems,
  stockable: isStockUnit,
}
