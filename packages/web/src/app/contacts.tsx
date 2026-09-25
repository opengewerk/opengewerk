import { contactParentProblem, contactParentText, type RecordState } from '@opengewerk/domain'
import { Mail, Smartphone } from 'lucide-react'
import { useState } from 'react'

import { Button, IconButton } from '../components/index.js'
import { refusalFor } from '../sync/client.js'
import { maybeText, text } from '../sync/fields.js'
import { useSync, useSyncStatus } from '../sync/provider.js'
import { personName } from './naming.js'
import { RecordForm, asTextOrNull } from './record-form.js'
import type { FormField } from './record-form.js'

/**
 * What a contact hangs on: one customer or one site, never both (#121).
 *
 * The type says it before the rule does. A form gets its parent from the
 * screen it stands on, the customer's or the site's, and has no field for the
 * other one, so there is nothing a person could fill in twice.
 */
export type ContactParent = { readonly customerId: string } | { readonly siteId: string }

export const contactFields: readonly FormField[] = [
  { name: 'givenName', label: 'Vorname' },
  { name: 'familyName', label: 'Nachname', required: true },
  {
    name: 'role',
    label: 'Rolle',
    hint: 'Zum Beispiel Bauleitung, Buchhaltung, Mieter oder Hausmeister.',
  },
  { name: 'phone', label: 'Telefon', kind: 'tel' },
  { name: 'email', label: 'E-Mail', kind: 'email' },
]

/** The values a form collected, in the types the record wants. */
export function asContact(values: Record<string, string>) {
  return {
    givenName: asTextOrNull(values['givenName']),
    familyName: values['familyName']?.trim() ?? '',
    role: asTextOrNull(values['role']),
    phone: asTextOrNull(values['phone']),
    email: asTextOrNull(values['email']),
  }
}

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

/**
 * A new contact, through the outbox like a new customer, so that it works in
 * a cellar as well.
 *
 * It asks `contactParentProblem` before anything is queued. With the parent
 * taken from the screen that can only fail when the screen hands in an empty
 * id, and then the sentence here is the whole answer; the sync would refuse
 * the same record for the whole transmission (ADR 0005).
 */
export function NewContactForm({
  parent,
  onDone,
}: {
  readonly parent: ContactParent
  readonly onDone: () => void
}) {
  const client = useSync()

  return (
    <RecordForm
      fields={contactFields}
      submitLabel="Anlegen"
      onCancel={onDone}
      check={() => {
        const problem = contactParentProblem(parent)

        return problem ? contactParentText[problem] : null
      }}
      onSubmit={async (values) => {
        const made = await client.create('contacts', { ...parent, ...asContact(values) })

        if (made.outcome === 'queued') {
          onDone()
        }

        return made
      }}
    />
  )
}

/** A number or an address to tap, drawn in the line and hit a little larger. */
const contactLink =
  'relative inline-flex items-center gap-1.5 font-semibold text-copper-text underline underline-offset-2 [overflow-wrap:anywhere] before:absolute before:inset-x-0 before:-inset-y-2.5'

/**
 * The contacts of one customer or site, with phone and e-mail to tap.
 *
 * `manage` offers changing and removing. Both go straight to the server, since
 * master data is corrected with a connection (ADR 0005), and a form that
 * cannot be sent says so before anybody fills it in.
 */
export function ContactList({
  contacts,
  manage,
  empty,
}: {
  readonly contacts: readonly RecordState[]
  readonly manage: boolean
  readonly empty: string
}) {
  const client = useSync()
  const status = useSyncStatus()
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const offline = client.needsConnection('contacts') && !status.online

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('contacts', id)

    setTrouble(result.outcome === 'refused' ? refusalFor(result) : null)
  }

  if (contacts.length === 0) {
    return <p className="py-2 text-[16px] leading-[1.45] text-ink-muted">{empty}</p>
  }

  return (
    <div className="flex flex-col">
      {trouble ? (
        <p role="alert" className="text-[16px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <ul className="flex flex-col">
        {byName(contacts).map((contact) => {
          const id = String(contact['id'])
          const name = contactName(contact)
          const role = maybeText(contact, 'role')
          const phone = maybeText(contact, 'phone')
          const email = maybeText(contact, 'email')

          if (editing === id) {
            return (
              <li key={id}>
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
                  onSubmit={async (values) => {
                    const saved = await client.update('contacts', id, asContact(values))

                    if (saved.outcome === 'queued') {
                      setEditing(null)
                    }

                    return saved
                  }}
                />
              </li>
            )
          }

          // A person as the card "Ansprechpartner" on site draws one: the
          // name, the role under it, and the number and address to tap side
          // by side, over a line.
          return (
            <li
              key={id}
              className="flex flex-wrap items-start justify-between gap-2 border-b border-row py-2"
            >
              <div className="min-w-0">
                <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                  {name}
                  {client.isPending('contacts', id) ? (
                    <span className="text-[14px] font-semibold text-waiting">
                      {', noch nicht übertragen'}
                    </span>
                  ) : null}
                </span>
                {role ? <span className="block text-[15px] text-ink-muted">{role}</span> : null}
                {phone || email ? (
                  <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[16px]">
                    {phone ? (
                      <a href={`tel:${dialable(phone)}`} className={contactLink}>
                        <Smartphone size={17} strokeWidth={2.2} aria-hidden="true" />
                        {phone}
                      </a>
                    ) : null}
                    {email ? (
                      <a href={`mailto:${email}`} className={contactLink}>
                        <Mail size={17} strokeWidth={2.2} aria-hidden="true" />
                        {email}
                      </a>
                    ) : null}
                  </span>
                ) : null}
              </div>

              {manage ? (
                removing === id ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Button tone="danger" onClick={() => void remove(id)}>
                      Entfernen
                    </Button>
                    <Button
                      tone="quiet"
                      onClick={() => {
                        setRemoving(null)
                      }}
                    >
                      Behalten
                    </Button>
                  </span>
                ) : (
                  <span className="inline-flex flex-wrap gap-1">
                    <IconButton
                      label={`${name} bearbeiten`}
                      title="Bearbeiten"
                      onClick={() => {
                        setTrouble(null)
                        setEditing(id)
                      }}
                    >
                      ✎
                    </IconButton>
                    <IconButton
                      label={`${name} entfernen`}
                      title="Entfernen"
                      tone="danger"
                      onClick={() => {
                        setTrouble(null)
                        setRemoving(id)
                      }}
                    >
                      ✕
                    </IconButton>
                  </span>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
