import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'

import { Button, Confirm, Panel } from '../../components/index.js'
import {
  byName,
  contactFields,
  type ContactParent,
  asContact,
  contactName,
  dialable,
  NewContactForm,
} from '../../app/contacts.js'
import { useMay } from '../../app/queries.js'
import { RecordForm } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText } from '../../sync/fields.js'
import { useRelated, useSync, useSyncStatus } from '../../sync/provider.js'

/**
 * The contacts at a customer or at a site, on its screen in the office
 * (#121), as `contacts_card()` of the canvas draws them (#219): the name, the
 * role under it, phone and e-mail to tap, and a pencil to change a contact.
 * Removing one is in the form behind the pencil, with a question first.
 *
 * Creating is the customer's right to create, changing and removing its right
 * to write, the same pair the sync asks for a contact. Changing and removing
 * go straight to the server, since master data is corrected with a connection
 * (ADR 0005), and a form that cannot be sent says so before anybody fills it.
 */
export function ContactsSection({
  parent,
  empty,
}: {
  readonly parent: ContactParent
  readonly empty: string
}) {
  const client = useSync()
  const status = useSyncStatus()
  const creates = useMay('customer.create')
  const corrects = useMay('customer.write')
  const [field, id] =
    'customerId' in parent ? ['customerId', parent.customerId] : ['siteId', parent.siteId]
  const contacts = useRelated('contacts', field, id)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ readonly id: string; readonly name: string } | null>(
    null,
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const offline = client.needsConnection('contacts') && !status.online

  async function remove(contactId: string) {
    setRemoving(null)

    const result = await client.remove('contacts', contactId)

    if (result.outcome === 'refused') {
      setTrouble(refusalText[result.reason])
    } else {
      setEditing(null)
      setTrouble(null)
    }
  }

  return (
    <Panel
      title="Ansprechpartner"
      action={
        creates && !adding ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            Anlegen
          </Button>
        ) : null
      }
    >
      {adding ? (
        <div className="mb-3">
          <NewContactForm
            parent={parent}
            onDone={() => {
              setAdding(false)
            }}
          />
        </div>
      ) : null}

      {trouble ? (
        <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {contacts.length === 0 ? (
        adding ? null : (
          <p className="text-[13px] text-ink-muted">{empty}</p>
        )
      ) : (
        <ul>
          {byName(contacts).map((contact) => {
            const contactId = String(contact['id'])
            const name = contactName(contact)
            const role = maybeText(contact, 'role')
            const phone = maybeText(contact, 'phone')
            const email = maybeText(contact, 'email')

            if (editing === contactId) {
              return (
                <li key={contactId} className="border-b border-row py-2">
                  <RecordForm
                    fields={contactFields}
                    record={contact}
                    submitLabel="Speichern"
                    disabled={offline}
                    disabledReason={
                      offline
                        ? 'Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.'
                        : undefined
                    }
                    onCancel={() => {
                      setEditing(null)
                    }}
                    extraAction={
                      <Button
                        tone="danger"
                        disabled={offline}
                        onClick={() => {
                          setRemoving({ id: contactId, name })
                        }}
                      >
                        Entfernen
                      </Button>
                    }
                    onSubmit={async (values) => {
                      const saved = await client.update('contacts', contactId, asContact(values))

                      if (saved.outcome === 'queued') {
                        setEditing(null)
                      }

                      return saved
                    }}
                  />
                </li>
              )
            }

            return (
              <li key={contactId} className="flex items-start gap-2 border-b border-row py-2">
                <div className="min-w-0 grow">
                  <div className="text-[14px] font-semibold">
                    {name}
                    {client.isPending('contacts', contactId) ? (
                      <span className="text-[13px] font-normal text-ink-faint">
                        {' '}
                        noch nicht übertragen
                      </span>
                    ) : null}
                  </div>
                  {role ? <div className="text-[13px] text-ink-faint">{role}</div> : null}
                  {phone || email ? (
                    <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[13px]">
                      {phone ? (
                        <a
                          href={`tel:${dialable(phone)}`}
                          className="text-copper-text underline underline-offset-2"
                        >
                          {phone}
                        </a>
                      ) : null}
                      {email ? (
                        <a
                          href={`mailto:${email}`}
                          className="text-copper-text underline underline-offset-2 [overflow-wrap:anywhere]"
                        >
                          {email}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {corrects ? (
                  <button
                    type="button"
                    aria-label={`${name} bearbeiten`}
                    title="Bearbeiten"
                    onClick={() => {
                      setTrouble(null)
                      setEditing(contactId)
                    }}
                    className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted max-lg:size-tap"
                  >
                    <Pencil size={14} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <Confirm
        open={removing !== null}
        title={`${removing?.name ?? 'Ansprechpartner'} entfernen?`}
        confirm="Entfernen"
        onConfirm={() => {
          if (removing) {
            void remove(removing.id)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        Danach steht der Ansprechpartner hier nicht mehr, auch nicht auf den Geräten der Baustelle.
      </Confirm>
    </Panel>
  )
}
