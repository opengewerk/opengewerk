// The people to talk to at a record, as an entry of its own:
// `@opengewerk/platform-web/contacts`.
//
// What both entries of an application share about a contact: the form for a
// new one, what a contact is called, and the fields, the values and the order
// a list of them goes by. What a contact hangs on, who may keep one and the
// few words that name the records of an application are handed in; its rules
// are the ones its routes and its sync ask as well (`contactRules`).
//
// The card of the office is under `/office` (`ContactsPanel`), the list to
// tap on site under `/site` (`ContactList`), so that each entry loads only
// what it draws.

export { NewContactForm } from './new-contact-form.js'
export type { NewContactFormProps, NewContactParent } from './new-contact-form.js'
export {
  asContact,
  byName,
  contactFields,
  contactName,
  contactTextProblem,
  dialable,
  personName,
} from './people.js'
export type { ContactWords } from './people.js'
