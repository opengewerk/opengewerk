import { contactEntity } from '@opengewerk/platform-domain'
import type { ContactRules, RecordState } from '@opengewerk/platform-domain'
import { Pencil, Plus } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/button.js'
import { Confirm } from '../components/confirm.js'
import { Panel } from '../components/panel.js'
import { NewContactForm } from '../contacts/new-contact-form.js'
import type { NewContactParent } from '../contacts/new-contact-form.js'
import {
  asContact,
  byName,
  contactFields,
  contactName,
  contactTextProblem,
  dialable,
} from '../contacts/people.js'
import type { ContactWords } from '../contacts/people.js'
import { refusalFor } from '../sync/client.js'
import type { Draft, EditResult } from '../sync/client.js'
import { maybeText } from '../sync/fields.js'
import { useRelated, useSync, useSyncStatus } from '../sync/provider.js'
import { RecordForm } from '../sync/record-form.js'

/** What an application says about its contacts on the card of the office. */
export interface ContactsPanelWords extends ContactWords {
  /**
   * Why a contact cannot be kept right now, for a form that needs a
   * connection and has none; said before anybody fills it in.
   */
  readonly needsConnection: string
  /** What taking a contact away means, under the question that asks first. */
  readonly removal: string
}

export interface ContactsPanelProps {
  /**
   * What the contacts of this card hang on: one field of the application
   * with the id of the record whose screen the card stands on.
   */
  readonly parent: NewContactParent
  /** The rules of the application's contacts. */
  readonly rules: ContactRules
  readonly words: ContactsPanelWords
  /** Whether whoever looks may add a contact here. */
  readonly creates: boolean
  /** Whether they may correct one and take one away. */
  readonly corrects: boolean
  /** What the card says while nobody is entered. */
  readonly empty: string
  /**
   * How the application makes a contact where that is not through the
   * outbox; see `NewContactForm`. Adding then needs a connection, and the
   * form says so before anybody fills it in.
   */
  readonly make?: (values: Draft) => Promise<EditResult>
  /**
   * What somebody is and how to reach them in one line under the name, where
   * a board draws the card in a narrow column. Left out, each stands on its
   * own, as the card was drawn first.
   */
  readonly dense?: boolean
}

/** What follows the name of a contact that has not reached the server yet. */
function Waiting() {
  return <span className="text-[13px] font-normal text-ink-faint"> noch nicht übertragen</span>
}

/**
 * The people to talk to at a record, on its screen in the office: the name,
 * what somebody is there, phone and e-mail to tap, and a pencil to change a
 * contact. Removing one is in the form behind the pencil, with a question
 * first.
 *
 * What a contact hangs on, who may add one and who may correct one are the
 * application's, handed in; so are the few words that name its records.
 * Changing and removing go wherever the rules of the sync send them, and a
 * form that cannot be sent says so before anybody fills it in.
 */
export function ContactsPanel({
  parent,
  rules,
  words,
  creates,
  corrects,
  empty,
  make,
  dense = false,
}: ContactsPanelProps) {
  const client = useSync()
  const status = useSyncStatus()
  const at = rules.parentOf(parent)
  const contacts = useRelated(contactEntity, at?.field ?? '', at?.id)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ readonly id: string; readonly name: string } | null>(
    null,
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const offline = client.needsConnection(contactEntity) && !status.online
  const fields = contactFields(words)

  async function remove(contactId: string) {
    setRemoving(null)

    const result = await client.remove(contactEntity, contactId)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))
    } else {
      setEditing(null)
      setTrouble(null)
    }
  }

  /** The form behind the pencil, the same in both drawings. */
  function changing(contact: RecordState, contactId: string, name: string) {
    return (
      <RecordForm
        fields={fields}
        record={contact}
        submitLabel="Speichern"
        check={(values) => contactTextProblem(rules, values)}
        disabled={offline}
        disabledReason={offline ? words.needsConnection : undefined}
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
          const saved = await client.update(contactEntity, contactId, asContact(values))

          if (saved.outcome === 'queued') {
            setEditing(null)
          }

          return saved
        }}
      />
    )
  }

  function pencil(contactId: string, name: string) {
    return corrects ? (
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
    ) : null
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
            {words.add}
          </Button>
        ) : null
      }
    >
      {adding ? (
        <div className="mb-3">
          <NewContactForm
            parent={parent}
            rules={rules}
            words={words}
            make={make}
            unavailable={make && !status.online ? words.needsConnection : undefined}
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
          <p className="text-[13px] leading-[1.4] text-ink-muted">{empty}</p>
        )
      ) : dense ? (
        <ul className="flex flex-col gap-2.5">
          {byName(contacts).map((contact) => {
            const contactId = String(contact['id'])
            const name = contactName(contact)

            if (editing === contactId) {
              return <li key={contactId}>{changing(contact, contactId, name)}</li>
            }

            const role = maybeText(contact, 'role')
            const phone = maybeText(contact, 'phone')
            const email = maybeText(contact, 'email')
            const link = 'text-inherit underline underline-offset-2'
            // What somebody is, then how to reach them, each only when it is
            // there: one line, as the board has it.
            const facts: ReactNode[] = [
              role,
              phone ? (
                <a href={`tel:${dialable(phone)}`} className={link}>
                  {phone}
                </a>
              ) : null,
              email ? (
                <a href={`mailto:${email}`} className={link}>
                  {email}
                </a>
              ) : null,
            ].filter((fact) => fact !== null)

            return (
              <li key={contactId} className="flex items-start gap-2">
                <div className="min-w-0 grow text-[13px] leading-[1.45]">
                  <div className="font-semibold">
                    {name}
                    {client.isPending(contactEntity, contactId) ? <Waiting /> : null}
                  </div>
                  {facts.length > 0 ? (
                    <div className="text-ink-faint [overflow-wrap:anywhere]">
                      {facts.map((fact, index) => (
                        <Fragment key={index}>
                          {index > 0 ? ' · ' : null}
                          {fact}
                        </Fragment>
                      ))}
                    </div>
                  ) : null}
                </div>
                {pencil(contactId, name)}
              </li>
            )
          })}
        </ul>
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
                  {changing(contact, contactId, name)}
                </li>
              )
            }

            return (
              <li key={contactId} className="flex items-start gap-2 border-b border-row py-2">
                <div className="min-w-0 grow">
                  <div className="text-[14px] font-semibold">
                    {name}
                    {client.isPending(contactEntity, contactId) ? <Waiting /> : null}
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
                {pencil(contactId, name)}
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
        {words.removal}
      </Confirm>
    </Panel>
  )
}
