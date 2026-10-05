import 'fake-indexeddb/auto'

import { syncRules } from '@opengewerk/platform-domain'
import { probeContactRules, probePolicies } from '@opengewerk/platform-domain/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { Shell } from '../components/surface.js'
import { NewContactForm } from '../contacts/new-contact-form.js'
import type { ContactWords } from '../contacts/people.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider, useRelated } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { ContactList } from './contacts.js'

/**
 * The people to talk to at a record, on site: a list to read and to call
 * from, and the form for somebody met at the door, in an application that
 * belongs to nobody.
 */

type Row = Record<string, unknown>

const rules = syncRules({ ...probePolicies, contacts: { create: true, change: 'never' } })

const words: ContactWords = { role: { label: 'Aufgabe' }, add: 'Eintragen' }

const empty = 'Zu diesem Regal fragt man noch niemanden.'

let server: TestServer
let counter = 0

function contact(id: string, over: Row): Row {
  return {
    id,
    shelfId: null,
    letterId: null,
    givenName: null,
    familyName: 'Ohne',
    role: null,
    email: null,
    phone: null,
    ...over,
  }
}

/** The contacts of one shelf as a screen on site shows them, with a way to add one. */
function AtShelf({ shelfId }: { readonly shelfId: string }) {
  const contacts = useRelated('contacts', 'shelfId', shelfId)
  const [adding, setAdding] = useState(false)

  return (
    <section aria-label="Am Regal">
      <ContactList contacts={contacts} empty={empty} />
      {adding ? (
        <NewContactForm
          parent={{ shelfId }}
          rules={probeContactRules}
          words={words}
          onDone={() => {
            setAdding(false)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
          }}
        >
          Jemanden eintragen
        </button>
      )}
    </section>
  )
}

async function mounted(shelfId = 's-1') {
  const client = await SyncClient.start({
    store: await openLocalStore(`site-contacts${String((counter += 1))}`),
    transport: server,
    writer: server,
    rules,
    deviceId: 'device',
    entities: ['shelves', 'contacts'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  render(
    <Shell entry="site">
      <SyncProvider client={client}>
        <AtShelf shelfId={shelfId} />
      </SyncProvider>
    </Shell>,
  )

  return client
}

function list() {
  return within(screen.getByRole('region', { name: 'Am Regal' }))
}

function people() {
  return list()
    .queryAllByRole('listitem')
    .map((item) => item.textContent)
}

beforeEach(() => {
  server = new TestServer()
  server.put('shelves', { id: 's-1', label: 'Wareneingang' })
  server.put('shelves', { id: 's-2', label: 'Archiv' })
  server.put(
    'contacts',
    contact('k-1', {
      shelfId: 's-1',
      givenName: 'Petra',
      familyName: 'Zander',
      role: 'Lagerleitung',
      phone: '040 / 123-45',
      email: 'zander@probewerk.example',
    }),
  )
  server.put('contacts', contact('k-2', { shelfId: 's-1', familyName: 'Albers' }))
  server.put('contacts', contact('k-3', { shelfId: 's-1', familyName: '' }))
})

describe('the contacts of a record on site', () => {
  it('say what the screen says while nobody is entered', async () => {
    await mounted('s-2')

    expect(list().getByText(empty)).toBeTruthy()
    expect(people()).toEqual([])
  })

  it('are listed by family name, with what somebody is there and the number and the address to tap', async () => {
    await mounted()

    expect(people()).toEqual([
      // Somebody without a name stands first, an empty name sorts before any.
      'Ansprechpartner ohne Namen',
      'Albers',
      'Petra ZanderLagerleitung040 / 123-45zander@probewerk.example',
    ])
    expect(list().queryByText(empty)).toBeNull()
    expect(list().getByRole('link', { name: '040 / 123-45' }).getAttribute('href')).toBe(
      'tel:04012345',
    )
    expect(
      list().getByRole('link', { name: 'zander@probewerk.example' }).getAttribute('href'),
    ).toBe('mailto:zander@probewerk.example')
  })

  it('are to read and to call, with nothing to change or take away', async () => {
    await mounted()

    expect(list().queryByRole('button', { name: /bearbeiten|entfernen|Entfernen/ })).toBeNull()
  })
})

describe('somebody met on site', () => {
  it('is added without a network, waits on the device, and the list says so', async () => {
    const client = await mounted()

    server.offline = true
    await userEvent.click(list().getByRole('button', { name: 'Jemanden eintragen' }))
    await userEvent.type(list().getByLabelText(/Nachname/), 'Meyer')
    await userEvent.type(list().getByLabelText(/Aufgabe/), 'Pforte')
    await userEvent.click(list().getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(client.status().pending).toBe(1)
    })
    expect(people()).toContain('Meyer, noch nicht übertragenPforte')
    // The form is done with, and the way to it is back.
    expect(list().queryByLabelText(/Nachname/)).toBeNull()
    expect(list().getByRole('button', { name: 'Jemanden eintragen' })).toBeTruthy()

    const waiting = client.list('contacts').find((row) => row['familyName'] === 'Meyer')

    expect(waiting).toMatchObject({ shelfId: 's-1', role: 'Pforte' })
    expect(waiting?.['letterId']).toBeUndefined()
  })

  it('is not added without a family name, and the form stays', async () => {
    const client = await mounted()

    await userEvent.click(list().getByRole('button', { name: 'Jemanden eintragen' }))
    await userEvent.type(list().getByLabelText(/Nachname/), '  ')
    await userEvent.click(list().getByRole('button', { name: 'Eintragen' }))

    expect((await list().findByRole('alert')).textContent).toBe('Der Nachname fehlt.')
    expect(list().getByLabelText(/Nachname/)).toBeTruthy()
    expect(client.status().pending).toBe(0)
    expect(server.sent).toEqual([])
  })

  it('is not added by whoever backs out of the form', async () => {
    const client = await mounted()

    await userEvent.click(list().getByRole('button', { name: 'Jemanden eintragen' }))
    await userEvent.type(list().getByLabelText(/Nachname/), 'Meyer')
    await userEvent.click(list().getByRole('button', { name: 'Abbrechen' }))

    expect(list().queryByLabelText(/Nachname/)).toBeNull()
    expect(client.status().pending).toBe(0)
    expect(people()).not.toContain('Meyer')
  })
})
