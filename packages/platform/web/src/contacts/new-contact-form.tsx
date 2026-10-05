import { contactEntity } from '@opengewerk/platform-domain'
import type { ContactRules } from '@opengewerk/platform-domain'

import type { Draft, EditResult } from '../sync/client.js'
import { useSync } from '../sync/provider.js'
import { RecordForm } from '../sync/record-form.js'
import { asContact, contactFields, contactTextProblem } from './people.js'
import type { ContactWords } from './people.js'

/** What a new contact hangs on, by the field of the application that names it. */
export type NewContactParent = Readonly<Record<string, string>>

export interface NewContactFormProps {
  /**
   * What the new contact hangs on: one field of the application with the id
   * in it. A form gets it from the screen it stands on and has no field for
   * another, so there is nothing a person could fill in twice.
   */
  readonly parent: NewContactParent
  /** The rules of the application's contacts. */
  readonly rules: ContactRules
  readonly words: ContactWords
  /** Called once the contact is kept, and when somebody backs out. */
  readonly onDone: () => void
  /**
   * How the application makes a contact, where that is not through the
   * outbox: one whose contacts only the office keeps makes them at their
   * route, with a connection. Left out, a new contact is queued like any
   * record a device makes, so that it works without a network as well.
   */
  readonly make?: (values: Draft) => Promise<EditResult>
  /**
   * Set while a contact cannot be made at all, to the sentence that says why:
   * the form stands, says so before anybody fills it in, and cannot be sent.
   */
  readonly unavailable?: string
}

/**
 * A new contact.
 *
 * It asks the rules before anything is kept. With the parent taken from the
 * screen, the question where it hangs can only fail when the screen hands in
 * an empty id, and then the sentence here is the whole answer; the sync would
 * refuse the same record for the whole transmission.
 */
export function NewContactForm({
  parent,
  rules,
  words,
  onDone,
  make,
  unavailable,
}: NewContactFormProps) {
  const client = useSync()

  return (
    <RecordForm
      fields={contactFields(words)}
      submitLabel={words.add}
      disabled={unavailable !== undefined}
      disabledReason={unavailable}
      onCancel={onDone}
      check={(values) => {
        const problem = rules.parentProblem(parent)

        return problem ? rules.parentText[problem] : contactTextProblem(rules, values)
      }}
      onSubmit={async (values) => {
        const wanted = { ...parent, ...asContact(values) }
        const made = await (make ? make(wanted) : client.create(contactEntity, wanted))

        if (made.outcome === 'queued') {
          onDone()
        }

        return made
      }}
    />
  )
}
