import { contactRules } from './contact.js'

/**
 * The contacts of an application that belongs to nobody, for the tests of the
 * foundation: somebody to ask about a shelf, or the person a letter goes to,
 * never both.
 *
 * A test that ran green with the parents of a real application would not show
 * that the mechanism knows none of them.
 */
export const probeContactRules = contactRules({
  parents: ['shelfId', 'letterId'],
  parentText: {
    none: 'Ein Ansprechpartner gehört zu einem Regal oder zu einem Brief, dieser zu keinem davon.',
    several: 'Ein Ansprechpartner gehört zu einem Regal oder zu einem Brief, nicht zu beiden.',
  },
  // The probe application keeps what somebody is there short, the kind of rule
  // an application adds to the one every contact has.
  problems: (texts): Readonly<Record<string, string>> =>
    typeof texts.role === 'string' && texts.role.length > 40
      ? { role: 'Die Funktion hat höchstens 40 Zeichen.' }
      : {},
})
