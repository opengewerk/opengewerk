import type { Id, Synced } from './identifier.js'

/** The key of a contact. */
export type ContactId = Id<'contact'>

/**
 * The entity a device, a route and a screen talk about a contact as: the name
 * of its table, the same in every application.
 */
export const contactEntity = 'contacts'

/**
 * The texts that say who a contact is and how to reach them, in the order a
 * form asks for them.
 */
export const contactTextFields = ['givenName', 'familyName', 'role', 'phone', 'email'] as const

export type ContactTextField = (typeof contactTextFields)[number]

/**
 * A person to talk to, as every application keeps one
 * (opengewerk-haustechnik#85): a name, what they are there, and how to reach
 * them.
 *
 * What a contact hangs on is the application's. One keeps the people of a
 * customer, a site and a supplier, another those of a property; each adds the
 * keys of its own records to this and says which they are (`contactRules`).
 * A contact travels to devices, like what it hangs on: who opens the door is
 * what somebody standing in front of it needs to know.
 */
export interface ContactPerson extends Synced {
  readonly id: ContactId
  readonly givenName: string | null
  readonly familyName: string
  /** Free text such as `Bauleiter` or `Hausmeister`, not a fixed list. */
  readonly role: string | null
  readonly email: string | null
  readonly phone: string | null
}

/** The texts of a contact as a form, a route or a device hands them over. */
export type ContactTexts = Readonly<Partial<Record<ContactTextField, unknown>>>

/** The two ways a contact can miss the one place the model gives it. */
export type ContactParentProblem = 'none' | 'several'

/** What the foundation says to a contact without a family name, everywhere it is asked. */
export const contactFamilyNameMissing = 'Der Nachname fehlt.'

/** What an application says about its contacts. */
export interface ContactSetup<Parent extends string> {
  /**
   * The fields that name what a contact hangs on, each the key of a record of
   * the application. A contact names exactly one of them.
   */
  readonly parents: readonly [Parent, ...Parent[]]
  /**
   * What the application says to a contact on none of them, and to one on
   * several: whole sentences, because they name its records.
   */
  readonly parentText: Readonly<Record<ContactParentProblem, string>>
  /**
   * What else the application finds wrong with the texts of a contact, by
   * field and as a sentence each: the lengths it allows, above all. Asked with
   * the fields that are there, like the rule of the family name.
   */
  readonly problems?: (texts: ContactTexts) => Readonly<Record<string, string>>
}

/** The parent a contact names. */
export interface ContactParent<Parent extends string> {
  readonly field: Parent
  readonly id: string
}

/**
 * The rules of the contacts of one application: one object for its forms, its
 * routes and its sync, so that all three read the same rule the same way and
 * a device works out the answer the server will give.
 */
export interface ContactRules<Parent extends string = string> {
  /** The fields that name what a contact hangs on. */
  readonly parents: readonly Parent[]
  /** The sentence for a contact on none of its parents, and for one on several. */
  readonly parentText: Readonly<Record<ContactParentProblem, string>>
  /**
   * Whether a contact hangs on exactly one of its parents, judged from the
   * fields as they stand; null when it does. An empty string counts as empty,
   * the way a form hands over a field nobody filled in.
   */
  parentProblem(contact: Readonly<Partial<Record<Parent, unknown>>>): ContactParentProblem | null
  /** The one parent a contact names, or null when it names none or several. */
  parentOf(contact: Readonly<Partial<Record<Parent, unknown>>>): ContactParent<Parent> | null
  /**
   * What is wrong with the texts of a contact, by field and as a sentence
   * each; empty when nothing is. The family name first, which no contact does
   * without.
   *
   * Judged over the fields that are there: a change that leaves the family
   * name alone says nothing about it. Whoever makes a contact hands in every
   * field, with null where none was given.
   */
  personProblems(texts: ContactTexts): Readonly<Record<string, string>>
}

function named(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/**
 * The rules of the contacts of an application (ADR 0010), made once from what
 * only the application knows: which of its records a contact hangs on and
 * what it says when one hangs on none of them or on several.
 */
export function contactRules<const Parent extends string>(
  setup: ContactSetup<Parent>,
): ContactRules<Parent> {
  const parents: readonly Parent[] = [...setup.parents]

  if (new Set(parents).size !== parents.length) {
    throw new Error(`A contact names each of its parents once: ${parents.join(', ')}`)
  }

  const namedIn = (contact: Readonly<Partial<Record<Parent, unknown>>>) =>
    parents.filter((field) => named(contact[field]))

  return {
    parents,
    parentText: setup.parentText,
    parentProblem(contact) {
      const found = namedIn(contact).length

      if (found > 1) {
        return 'several'
      }

      return found === 1 ? null : 'none'
    },
    parentOf(contact) {
      const found = namedIn(contact)
      const [field] = found

      return found.length === 1 && field !== undefined
        ? { field, id: String(contact[field]) }
        : null
    },
    personProblems(texts) {
      const own: Record<string, string> = {}

      if ('familyName' in texts) {
        const name = texts.familyName

        if (typeof name !== 'string' || name.trim() === '') {
          own['familyName'] = contactFamilyNameMissing
        }
      }

      // The family name first, and the sentence of the foundation where both
      // have one for a field: a name that is not there is not also too long.
      const further = Object.entries(setup.problems?.(texts) ?? {}).filter(
        ([field]) => !(field in own),
      )

      return { ...own, ...Object.fromEntries(further) }
    },
  }
}
