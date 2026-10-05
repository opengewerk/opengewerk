import { contactEntity } from '@opengewerk/platform-domain'
import type { RecordState } from '@opengewerk/platform-domain'
import { Mail, Smartphone } from 'lucide-react'

import { byName, contactName, dialable } from '../contacts/people.js'
import { maybeText } from '../sync/fields.js'
import { useSync } from '../sync/provider.js'

/** A number or an address to tap, drawn in the line and hit a little larger. */
const contactLink =
  'relative inline-flex items-center gap-1.5 font-semibold text-copper-text underline underline-offset-2 [overflow-wrap:anywhere] before:absolute before:inset-x-0 before:-inset-y-2.5'

/**
 * The contacts of one record on site, with phone and e-mail to tap: the name,
 * what somebody is there under it, and the number and the address side by
 * side, over a line.
 *
 * To read and to call, not to correct. Whoever stands in front of a door
 * needs the number; correcting a contact is for the office, which has the
 * right and the connection. A new one is added with `NewContactForm`, by the
 * screen that knows where it belongs.
 */
export function ContactList({
  contacts,
  empty,
}: {
  readonly contacts: readonly RecordState[]
  /** What stands there while nobody is entered. */
  readonly empty: string
}) {
  const client = useSync()

  if (contacts.length === 0) {
    return <p className="py-2 text-[16px] leading-[1.45] text-ink-muted">{empty}</p>
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {byName(contacts).map((contact) => {
          const id = String(contact['id'])
          const role = maybeText(contact, 'role')
          const phone = maybeText(contact, 'phone')
          const email = maybeText(contact, 'email')

          return (
            <li
              key={id}
              className="flex flex-wrap items-start justify-between gap-2 border-b border-row py-2"
            >
              <div className="min-w-0">
                <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                  {contactName(contact)}
                  {client.isPending(contactEntity, id) ? (
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
