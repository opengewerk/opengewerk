import type { RecordState } from '@opengewerk/domain'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button, Panel, SelectField } from '../../components/index.js'
import { type ContactParent, ContactList, NewContactForm } from '../../app/contacts.js'
import { useMay } from '../../app/queries.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated } from '../../sync/provider.js'
import { SiteLabel } from '../kit.js'

/**
 * Who to call at the customer and at the site of a job, to tap (#121), as
 * the card "Ansprechpartner" of the board "Auftrag, ganze Seite" draws it:
 * the people at the customer, then those at the site, and one button.
 *
 * One button and not one per list, as the board has it. The form it opens
 * asks where the new contact belongs when the job has a site, and says both
 * names, so nobody on a ladder has to know which is which in the model.
 *
 * A new one goes through the outbox like a new customer, so the tenant who
 * opened the door can be written down in the cellar. Correcting one is for
 * the office, which has the right and the connection.
 */
export function JobContacts({ job }: { readonly job: RecordState }) {
  const customerId = String(job['customerId'])
  const siteId = maybeText(job, 'siteId')
  const customer = useRecord('customers', customerId)
  const site = useRecord('sites', siteId ?? undefined)
  const atCustomer = useRelated('contacts', 'customerId', customerId)
  const atSite = useRelated('contacts', 'siteId', siteId ?? undefined)
  const creates = useMay('customer.create')
  const [adding, setAdding] = useState(false)
  // A contact met on site belongs to the site more often than not.
  const [belongs, setBelongs] = useState<'customer' | 'site'>(siteId ? 'site' : 'customer')

  const parent: ContactParent = belongs === 'site' && siteId ? { siteId } : { customerId }

  return (
    <Panel title="Ansprechpartner">
      <div className="flex flex-col gap-1">
        <ContactGroup
          heading="Beim Kunden"
          contacts={atCustomer}
          empty="Beim Kunden ist niemand eingetragen."
        />
        {siteId ? (
          <ContactGroup
            heading="Am Objekt"
            contacts={atSite}
            empty="Am Objekt ist niemand eingetragen."
            spaced
          />
        ) : null}
        {adding ? (
          <div className="mt-2 flex flex-col gap-3">
            {siteId ? (
              <SelectField
                label="Gehört zu"
                value={belongs}
                options={[
                  {
                    value: 'customer',
                    label: `Kunde: ${customer ? text(customer, 'name') : 'Kunde des Auftrags'}`,
                  },
                  {
                    value: 'site',
                    label: `Objekt: ${site ? text(site, 'designation') : 'Objekt des Auftrags'}`,
                  },
                ]}
                onChange={(value) => {
                  setBelongs(value === 'site' ? 'site' : 'customer')
                }}
              />
            ) : null}
            <NewContactForm
              key={belongs}
              parent={parent}
              onDone={() => {
                setAdding(false)
              }}
            />
          </div>
        ) : creates ? (
          <div className="mt-2">
            <Button
              wide
              height={48}
              icon={Plus}
              onClick={() => {
                setAdding(true)
              }}
            >
              Ansprechpartner anlegen
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

function ContactGroup({
  heading,
  contacts,
  empty,
  spaced = false,
}: {
  readonly heading: string
  readonly contacts: readonly RecordState[]
  readonly empty: string
  /** The second group keeps a little distance from the first. */
  readonly spaced?: boolean
}) {
  return (
    <section aria-label={heading} className={spaced ? 'mt-1.5' : undefined}>
      <SiteLabel>{heading}</SiteLabel>
      <ContactList contacts={contacts} manage={false} empty={empty} />
    </section>
  )
}
