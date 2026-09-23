import { useState } from 'react'

import { Button } from '../../components/index.js'
import { type ContactParent, ContactList, NewContactForm } from '../../app/contacts.js'
import { useMay } from '../../app/queries.js'
import { useRelated } from '../../sync/provider.js'
import { Section } from '../layout.js'

/**
 * The contacts at a customer or at a site, on its screen in the office
 * (#121): the site manager and the accounting at a property management, a
 * tenant and the caretaker at one of its buildings.
 *
 * Creating is the customer's right to create, changing and removing its right
 * to write, the same pair the sync asks for a contact.
 */
export function ContactsSection({
  parent,
  empty,
}: {
  readonly parent: ContactParent
  readonly empty: string
}) {
  const creates = useMay('customer.create')
  const corrects = useMay('customer.write')
  const [field, id] =
    'customerId' in parent ? ['customerId', parent.customerId] : ['siteId', parent.siteId]
  const contacts = useRelated('contacts', field, id)
  const [adding, setAdding] = useState(false)

  return (
    <Section
      title="Ansprechpartner"
      actions={
        creates ? (
          <Button
            tone="secondary"
            onClick={() => {
              setAdding((open) => !open)
            }}
          >
            {adding ? 'Abbrechen' : 'Ansprechpartner anlegen'}
          </Button>
        ) : null
      }
    >
      {adding ? (
        <div className="mb-4">
          <NewContactForm
            parent={parent}
            onDone={() => {
              setAdding(false)
            }}
          />
        </div>
      ) : null}

      <ContactList contacts={contacts} manage={corrects} empty={empty} />
    </Section>
  )
}
