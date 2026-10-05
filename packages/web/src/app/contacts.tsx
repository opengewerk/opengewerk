import { tradeContacts } from '@opengewerk/domain'
import { NewContactForm as NewContact } from '@opengewerk/platform-web/contacts'
import type { ContactWords } from '@opengewerk/platform-web/contacts'

/**
 * What a contact hangs on: one customer or one site (#121), or since #296 one
 * supplier, never two.
 *
 * The type says it before the rule does. A form gets its parent from the
 * screen it stands on, the customer's, the site's or the supplier's, and has
 * no field for another one, so there is nothing a person could fill in twice.
 */
export type ContactParent =
  { readonly customerId: string } | { readonly siteId: string } | { readonly supplierId: string }

/**
 * What this application calls the things of a contact that the foundation
 * leaves to it (opengewerk-haustechnik#85): what somebody is at a customer, a
 * site or a supplier, with its examples, and the word on the button.
 */
export const contactWords: ContactWords = {
  role: {
    label: 'Rolle',
    hint: 'Zum Beispiel Bauleitung, Buchhaltung, Mieter oder Hausmeister.',
  },
  add: 'Anlegen',
}

/**
 * A new contact, through the outbox like a new customer, so that it works in
 * a cellar as well: the form of the foundation, with the rules and the words
 * of this application.
 */
export function NewContactForm({
  parent,
  onDone,
}: {
  readonly parent: ContactParent
  readonly onDone: () => void
}) {
  return <NewContact parent={parent} rules={tradeContacts} words={contactWords} onDone={onDone} />
}
