import type { ContactRules, RecordState } from '@opengewerk/platform-domain'

import { maybeText, text } from '../sync/fields.js'
import { asTextOrNull } from '../sync/record-form.js'
import type { FormField } from '../sync/record-form.js'

/**
 * What an application says about its contacts wherever one is entered: what
 * it calls the thing somebody is there, and the word on the button that adds
 * one.
 *
 * The rest of a contact is said here. A given name, a family name, a phone
 * number and an e-mail address are called the same in every application.
 */
export interface ContactWords {
  /**
   * The field for what somebody is at the place a contact hangs on, and an
   * example under it: one application calls it a role and thinks of a site
   * manager, another a function and thinks of a caretaker.
   */
  readonly role: { readonly label: string; readonly hint?: string }
  /** The button that adds a contact, and the one that sends the form behind it. */
  readonly add: string
}

/** The fields of the form for a contact, in the words of the application. */
export function contactFields(words: ContactWords): readonly FormField[] {
  return [
    { name: 'givenName', label: 'Vorname' },
    { name: 'familyName', label: 'Nachname', required: true },
    { name: 'role', label: words.role.label, hint: words.role.hint },
    { name: 'phone', label: 'Telefon', kind: 'tel' },
    { name: 'email', label: 'E-Mail', kind: 'email' },
  ]
}

/** The values a form collected, in the types the record wants. */
export function asContact(values: Readonly<Record<string, string>>) {
  return {
    givenName: asTextOrNull(values['givenName']),
    familyName: values['familyName']?.trim() ?? '',
    role: asTextOrNull(values['role']),
    phone: asTextOrNull(values['phone']),
    email: asTextOrNull(values['email']),
  }
}

/**
 * What the rules of a contact say to the texts a form collected, or null when
 * they say nothing: the family name no contact does without, above all. The
 * routes and the sync ask the same rule, so a form that asks it first never
 * queues what the server refuses for the whole transmission. A name of
 * nothing but spaces passes the browser's own check of a required field and
 * is caught here.
 */
export function contactTextProblem(
  rules: ContactRules,
  values: Readonly<Record<string, string>>,
): string | null {
  const [problem] = Object.values(rules.personProblems(asContact(values)))

  return problem ?? null
}

/** Given and family name as one, or null when a record has neither. */
export function personName(record: RecordState | null): string | null {
  const parts = [maybeText(record, 'givenName'), maybeText(record, 'familyName')].filter(
    (part): part is string => part !== null,
  )

  return parts.length > 0 ? parts.join(' ') : null
}

/** What a list calls a contact, somebody without any name included. */
export function contactName(contact: RecordState): string {
  return personName(contact) ?? 'Ansprechpartner ohne Namen'
}

/**
 * A number as a phone dials it. What people type has spaces, slashes and
 * dashes in it, and a `tel:` address has no room for most of them.
 */
export function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '')
}

/** By family name, then given name, the way somebody looks for a person. */
export function byName(contacts: readonly RecordState[]): RecordState[] {
  return [...contacts].sort(
    (left, right) =>
      text(left, 'familyName').localeCompare(text(right, 'familyName'), 'de') ||
      text(left, 'givenName').localeCompare(text(right, 'givenName'), 'de') ||
      String(left['id']).localeCompare(String(right['id'])),
  )
}
