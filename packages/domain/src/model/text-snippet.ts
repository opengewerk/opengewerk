import type { TenantOwned, TextSnippetId } from './identifier.js'

/**
 * Where a snippet goes: into a position, or into the text above or below the
 * lines of a document.
 *
 * Three lists rather than one, because they are picked from in three places.
 * A description of how a meter cabinet is replaced has no business in the
 * list somebody opens to write "Vielen Dank für Ihre Anfrage".
 */
export const snippetPurposes = ['line', 'intro', 'closing'] as const

export type SnippetPurpose = (typeof snippetPurposes)[number]

/**
 * A piece of text the office writes once and uses again: the description of
 * a service that goes into a quote every week, the sentence a quote opens
 * with. Section 4.2 names them for quotes, and without them the office types
 * the same description of the same work every time.
 *
 * Text and nothing else. A snippet for a position fills its designation and
 * its description; quantity, unit and price stay with the position, because a
 * text with a price in it is an item of a price list, and the article master
 * is a piece of work of its own.
 *
 * Inserting copies the text. A document holds what was inserted, not a link to
 * the snippet, so changing a snippet next year does not rewrite a quote that
 * went out this year.
 */
export interface TextSnippet extends TenantOwned {
  readonly id: TextSnippetId
  readonly purpose: SnippetPurpose
  /** What the snippet is called in the list; for a position, its designation. */
  readonly title: string
  readonly text: string
}
