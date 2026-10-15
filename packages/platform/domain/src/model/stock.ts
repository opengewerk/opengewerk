import type { Id, Synced } from './identifier.js'

/**
 * The stores of a tenant and what lies in them (ADR 0011,
 * opengewerk-haustechnik#325): articles, suppliers, stores, the minimum a
 * store keeps of an article, and the bookings its stock is made of. A
 * building block of the foundation, so that every application keeps one
 * model of them; the first binds it with #325, the next with #298.
 *
 * What only an application knows stays with it: the price of an article and
 * how it is reckoned, an import of a catalogue of goods, what a withdrawal
 * hangs on. The table factory of the server takes such columns from the
 * application.
 *
 * **The stock is the sum of its bookings.** Nothing overwrites it: a receipt
 * adds, a withdrawal takes away, and a count sets the stock to what was found
 * and keeps the reason. A booking is written once and never changed.
 */

export type StockArticleId = Id<'article'>
export type StockSupplierId = Id<'supplier'>
export type StoreId = Id<'store'>
export type StoreArticleId = Id<'store-article'>
export type StockMovementId = Id<'stock-movement'>

/**
 * The units an article is kept in, with the keys the lines of the documents
 * of #298 use, so that both name a metre the same way.
 */
export const stockUnits = [
  'piece',
  'metre',
  'square_metre',
  'kilogram',
  'litre',
  'package',
] as const

export type StockUnit = (typeof stockUnits)[number]

export const stockUnitLabel: Readonly<Record<StockUnit, string>> = {
  piece: 'Stück',
  metre: 'm',
  square_metre: 'm²',
  kilogram: 'kg',
  litre: 'l',
  package: 'Packung',
}

/**
 * The bounds of what the stock carries, the same in a form, a route and the
 * database. A quantity is kept in thousandths of its unit, so that 85,5 m of
 * cable is 85500 and no sum ever rounds.
 */
export const stockLimits = {
  articleNumber: 40,
  designation: 200,
  description: 2000,
  supplierName: 200,
  customerNumber: 40,
  storeName: 120,
  location: 200,
  note: 500,
  /** The most a quantity of one booking may be, in thousandths: a million units. */
  quantityMilli: 1_000_000_000,
} as const

/** An article as the stock knows it: its number, what it is called, its barcode and its unit. */
export interface StockArticle extends Synced {
  readonly id: StockArticleId
  readonly number: string
  readonly designation: string
  readonly description: string | null
  /** The barcode of the manufacturer, EAN-13 or EAN-8, where it has one. */
  readonly ean: string | null
  readonly unit: StockUnit
}

/** Somebody a tenant buys from. */
export interface StockSupplier extends Synced {
  readonly id: StockSupplierId
  readonly name: string
  /** The tenant's number at the supplier. */
  readonly customerNumber: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly street: string | null
  readonly houseNumber: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly country: string
  readonly notes: string | null
}

/** A place stock lies in, such as a room or, later, a vehicle. */
export interface Store extends Synced {
  readonly id: StoreId
  readonly name: string
  /** Where it is, in words. */
  readonly location: string | null
}

/** What a store keeps of an article: the minimum below which it is to be ordered. */
export interface StoreArticle extends Synced {
  readonly id: StoreArticleId
  readonly storeId: StoreId
  readonly articleId: StockArticleId
  /** Thousandths of the unit; none where the store keeps no minimum. */
  readonly minimumMilli: number | null
}

/**
 * How a booking changes the stock: a receipt adds, a withdrawal takes away,
 * and a count sets the stock to what was found.
 */
export const stockMovementKinds = ['receipt', 'count', 'withdrawal'] as const

export type StockMovementKind = (typeof stockMovementKinds)[number]

export const stockMovementKindLabel: Readonly<Record<StockMovementKind, string>> = {
  receipt: 'Eingang',
  count: 'Zählung',
  withdrawal: 'Entnahme',
}

/**
 * A booking. Its quantity is what came in, what was taken, or for a count
 * what was found, always in thousandths of the unit of its article and never
 * below zero. A count names its reason. Written once.
 */
export interface StockMovement extends Synced {
  readonly id: StockMovementId
  readonly storeId: StoreId
  readonly articleId: StockArticleId
  readonly kind: StockMovementKind
  readonly quantityMilli: number
  /** Who a receipt came from, where it is said. */
  readonly supplierId: StockSupplierId | null
  /** Why a count corrects the stock, or what is said with a receipt or a withdrawal. */
  readonly reason: string | null
  readonly bookedBy: string
  readonly bookedAt: Date
}

/** What is wrong with an EAN, as a sentence, or null when nothing is. */
export function eanProblem(value: string): string | null {
  if (!/^(\d{8}|\d{13})$/.test(value)) {
    return 'Eine EAN hat 13 oder 8 Ziffern.'
  }

  const digits = [...value].map(Number)
  const check = digits.pop()
  // From the right, the digits before the check digit weigh 3, 1, 3, and so
  // on, which is the same rule for 13 digits as for 8.
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0)

  return (10 - (sum % 10)) % 10 === check ? null : 'Die Prüfziffer der EAN stimmt nicht.'
}

type Problems = Record<string, string>

/** A text a record must have, trimmed and bounded, where the record names it. */
function required(
  problems: Problems,
  record: Readonly<Record<string, unknown>>,
  field: string,
  most: number,
  missing: string,
): void {
  if (!(field in record)) {
    return
  }

  const value = record[field]
  const trimmed = typeof value === 'string' ? value.trim() : ''

  if (trimmed === '') {
    problems[field] = missing
  } else if (trimmed.length > most) {
    problems[field] = `Höchstens ${String(most)} Zeichen.`
  }
}

/** A text a record may leave empty, bounded where it is there. */
function optional(
  problems: Problems,
  record: Readonly<Record<string, unknown>>,
  field: string,
  most: number,
): void {
  const value = record[field]

  if (value === undefined || value === null) {
    return
  }

  if (typeof value !== 'string') {
    problems[field] = 'Das ist kein Text.'
  } else if (value.trim().length > most) {
    problems[field] = `Höchstens ${String(most)} Zeichen.`
  }
}

/**
 * What is wrong with the fields of an article, by field. Only the fields
 * present are judged, so that a change of one field is not refused for
 * another nobody touched.
 */
export function stockArticleProblems(
  article: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  required(
    problems,
    article,
    'number',
    stockLimits.articleNumber,
    'Ein Artikel braucht eine Nummer.',
  )
  required(
    problems,
    article,
    'designation',
    stockLimits.designation,
    'Ein Artikel braucht eine Bezeichnung.',
  )
  optional(problems, article, 'description', stockLimits.description)

  const ean = article['ean']

  if (typeof ean === 'string' && ean.trim() !== '') {
    const problem = eanProblem(ean.trim())

    if (problem !== null) {
      problems['ean'] = problem
    }
  } else if (ean !== undefined && ean !== null && ean !== '') {
    problems['ean'] = 'Eine EAN hat 13 oder 8 Ziffern.'
  }

  if ('unit' in article && !(stockUnits as readonly unknown[]).includes(article['unit'])) {
    problems['unit'] =
      `Die Einheit ist eine von: ${stockUnits.map((unit) => stockUnitLabel[unit]).join(', ')}.`
  }

  return problems
}

/** What is wrong with the fields of a supplier, by field, only those present. */
export function stockSupplierProblems(
  supplier: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  required(
    problems,
    supplier,
    'name',
    stockLimits.supplierName,
    'Ein Lieferant braucht einen Namen.',
  )
  optional(problems, supplier, 'customerNumber', stockLimits.customerNumber)

  for (const field of ['email', 'phone', 'street', 'houseNumber', 'postalCode', 'city']) {
    optional(problems, supplier, field, stockLimits.supplierName)
  }

  optional(problems, supplier, 'notes', stockLimits.description)

  const email = supplier['email']

  if (typeof email === 'string' && email.trim() !== '' && !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
    problems['email'] = 'Das ist keine E-Mail-Adresse.'
  }

  const country = supplier['country']

  if (country !== undefined && (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country))) {
    problems['country'] = 'Das Land sind zwei Großbuchstaben, etwa DE.'
  }

  return problems
}

/** What is wrong with the fields of a store, by field, only those present. */
export function storeProblems(store: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, store, 'name', stockLimits.storeName, 'Ein Lager braucht einen Namen.')
  optional(problems, store, 'location', stockLimits.location)

  return problems
}

/** Whether a value is a quantity in thousandths: a whole number from 0 to the bound. */
function isQuantity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= stockLimits.quantityMilli
  )
}

/** What is wrong with the minimum a store keeps of an article. */
export function storeArticleProblems(line: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const minimum = line['minimumMilli']

  return minimum === undefined || minimum === null || isQuantity(minimum)
    ? {}
    : { minimumMilli: 'Der Mindestbestand ist eine Menge ab null.' }
}

/**
 * What is wrong with a booking as it arrives: its kind, a quantity above zero
 * for a receipt and a withdrawal and from zero for a count, the reason a
 * count names, and the bounds of the texts.
 */
export function stockMovementProblems(
  movement: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}
  const kind = movement['kind']

  if ('kind' in movement && !(stockMovementKinds as readonly unknown[]).includes(kind)) {
    problems['kind'] = 'Gebucht wird ein Eingang, eine Zählung oder eine Entnahme.'
  }

  const quantity = movement['quantityMilli']

  if ('quantityMilli' in movement) {
    if (!isQuantity(quantity)) {
      problems['quantityMilli'] = 'Die Menge ist eine Zahl ab null.'
    } else if (kind !== 'count' && quantity === 0) {
      problems['quantityMilli'] = 'Gebucht wird eine Menge über null.'
    }
  }

  optional(problems, movement, 'reason', stockLimits.note)

  const reason = movement['reason']

  if (kind === 'count' && (typeof reason !== 'string' || reason.trim() === '')) {
    problems['reason'] = 'Eine Zählung nennt ihren Grund.'
  }

  if (kind !== undefined && kind !== 'receipt' && movement['supplierId'] != null) {
    problems['supplierId'] = 'Einen Lieferanten nennt nur ein Eingang.'
  }

  return problems
}

/**
 * The stock the bookings of one article in one store make, in thousandths,
 * in the order the server took them in: a count sets it to what was found, a
 * receipt adds and a withdrawal takes away. A withdrawal of more than lies
 * there makes it negative and says so: it happened, and the next count
 * corrects it.
 */
export function stockLevel(
  movements: readonly Pick<StockMovement, 'kind' | 'quantityMilli' | 'createdAt'>[],
): number {
  return [...movements]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .reduce(
      (level, movement) =>
        movement.kind === 'count'
          ? movement.quantityMilli
          : movement.kind === 'receipt'
            ? level + movement.quantityMilli
            : level - movement.quantityMilli,
      0,
    )
}

/** Whether a stock is below the minimum its store keeps; never where it keeps none. */
export function belowMinimum(levelMilli: number, minimumMilli: number | null): boolean {
  return minimumMilli !== null && levelMilli < minimumMilli
}
