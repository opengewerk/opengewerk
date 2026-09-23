import type { RecordState } from '@opengewerk/domain'
import { useState } from 'react'

import { Button, Card } from '../../components/index.js'
import { type ContactParent, ContactList, NewContactForm } from '../../app/contacts.js'
import { useMay } from '../../app/queries.js'
import { maybeText } from '../../sync/fields.js'
import { useRelated } from '../../sync/provider.js'

/**
 * Who to call at the customer and at the site of a job, to tap (#121).
 *
 * Two lists and not one, each with its own button: a contact hangs on the
 * customer or on the site, and a form here takes its parent from the list it
 * opens under. One form offering both would ask a technician on a ladder a
 * question the model already answers.
 *
 * A new one goes through the outbox like a new customer, so the tenant who
 * opened the door can be written down in the cellar. Correcting one is for
 * the office, which has the right and the connection.
 */
export function JobContacts({ job }: { readonly job: RecordState }) {
  const customerId = String(job['customerId'])
  const siteId = maybeText(job, 'siteId')
  const atCustomer = useRelated('contacts', 'customerId', customerId)
  const atSite = useRelated('contacts', 'siteId', siteId ?? undefined)
  const creates = useMay('customer.create')

  return (
    <Card label="Ansprechpartner">
      <div className="flex flex-col gap-5">
        <ContactGroup
          heading="Beim Kunden"
          addLabel="Ansprechpartner beim Kunden anlegen"
          parent={{ customerId }}
          contacts={atCustomer}
          creates={creates}
          empty="Beim Kunden ist niemand eingetragen."
        />
        {siteId ? (
          <ContactGroup
            heading="Am Objekt"
            addLabel="Ansprechpartner am Objekt anlegen"
            parent={{ siteId }}
            contacts={atSite}
            creates={creates}
            empty="Am Objekt ist niemand eingetragen."
          />
        ) : null}
      </div>
    </Card>
  )
}

function ContactGroup({
  heading,
  addLabel,
  parent,
  contacts,
  creates,
  empty,
}: {
  readonly heading: string
  readonly addLabel: string
  readonly parent: ContactParent
  readonly contacts: readonly RecordState[]
  readonly creates: boolean
  readonly empty: string
}) {
  const [adding, setAdding] = useState(false)

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-body font-semibold">{heading}</h3>
      <ContactList contacts={contacts} manage={false} empty={empty} />
      {adding ? (
        <NewContactForm
          parent={parent}
          onDone={() => {
            setAdding(false)
          }}
        />
      ) : creates ? (
        <Button
          tone="secondary"
          wide
          onClick={() => {
            setAdding(true)
          }}
        >
          {addLabel}
        </Button>
      ) : null}
    </section>
  )
}
