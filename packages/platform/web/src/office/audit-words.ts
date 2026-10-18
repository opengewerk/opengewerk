import {
  type AuditNames,
  type AuditTextWords,
  auditTextWords,
  type AuditValueWords,
} from '@opengewerk/platform-domain'
import type { ComponentType } from 'react'

import { useApplication } from '../application.js'
import { amount, date, euros, moment } from '../format.js'

/**
 * The change log in words a person reads (ADR 0010). The words themselves
 * stand in platform-domain (`auditTextWords`), so that the log as a table,
 * which the server writes, says what the screen says
 * (opengewerk-haustechnik#236); here they are bound to the formats of the
 * screen and to the ways from the log to the screens of an application.
 */

export type { AuditNames }

/**
 * What an application says about the values in its log and the ways from it
 * to its screens, beside the vocabulary its server is told as well.
 */
export interface AuditScreenWords extends AuditValueWords {
  /** Where a record is opened, for the records that have a screen of their own. */
  readonly href?: (table: string, id: string) => string | null
  /** The label of the link to a record, "Zum Kunden". */
  readonly linkWords?: (table: string) => string | null
  /** Beside the chip of one record's log: what it takes in, by the record's table. */
  readonly partsWords?: Readonly<Record<string, string>>
  /**
   * Over the log of one record, what the application knows of where the
   * record came from that no change says: an import that made it, say
   * (opengewerk-haustechnik#174). It draws nothing where it knows nothing.
   */
  readonly lead?: ComponentType<{ readonly table: string; readonly id: string }>
}

/** The words of the log, with the ways from it to the screens. */
export interface AuditWords extends AuditTextWords {
  readonly screen: AuditScreenWords
  /** Where a record is opened, or null. */
  readonly recordHref: (table: string, id: string) => string | null
  /** The label of the link to a record. */
  readonly recordLinkWords: (table: string) => string
}

/** The words of the log for an application. */
export function auditWords(screen: AuditScreenWords): AuditWords {
  return {
    ...auditTextWords(screen, { amount, date, euros, moment }),
    screen,
    recordHref: (table, id) => screen.href?.(table, id) ?? null,
    recordLinkWords: (table) => screen.linkWords?.(table) ?? 'Zum Datensatz',
  }
}

/** The words made from one application's value, once per value. */
const made = new WeakMap<AuditScreenWords, AuditWords>()

/**
 * The words of the log for the application over this screen. A screen outside
 * an office that hands them in has nothing to name a record with, and says so
 * instead of showing a column name.
 */
export function useAuditWords(): AuditWords {
  const screen = useApplication().audit

  if (!screen) {
    throw new Error(
      'Diese Ansicht braucht die Wörter des Änderungsprotokolls, die dieser Einstieg nicht mitbringt.',
    )
  }

  const known = made.get(screen)

  if (known) {
    return known
  }

  const words = auditWords(screen)

  made.set(screen, words)

  return words
}
