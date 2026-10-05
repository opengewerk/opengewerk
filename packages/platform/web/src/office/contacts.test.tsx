import 'fake-indexeddb/auto'

import { syncRules } from '@opengewerk/platform-domain'
import { probeContactRules, probePolicies } from '@opengewerk/platform-domain/testing'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Shell } from '../components/surface.js'
import { SyncClient } from '../sync/client.js'
import type { Draft, EditResult } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { RequestRefused } from '../sync/transport.js'
import { ContactsPanel } from './contacts.js'
import type { ContactsPanelProps, ContactsPanelWords } from './contacts.js'

/**
 * The card with the people to talk to at a record, in an application that
 * belongs to nobody: somebody to ask about a shelf, or the person a letter
 * goes to. What a contact hangs on, who may keep one and the words that name
 * the application's own things are handed in; the card is the foundation's.
 */

type Row = Record<string, unknown>

/** A server that takes what comes straight at a route as well, and can refuse it. */
class Server extends TestServer {
  readonly patched: { readonly id: string; readonly values: Row }[] = []
  readonly removed: string[] = []
  refusal: RequestRefused | null = null

  override patch(entity: string, id: string, values: Readonly<Row>) {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.patched.push({ id, values: { ...values } })
    this.put(entity, { ...this.row(entity, id), ...values })

    return Promise.resolve(undefined)
  }

  override remove(entity: string, id: string) {
    if (this.refusal) {
      return Promise.reject(this.refusal)
    }

    this.removed.push(id)
    this.put(entity, { ...this.row(entity, id), deletedAt: '2026-10-05T08:00:00.000Z' })

    return Promise.resolve(undefined)
  }

  /** What went out through the outbox: kind and the fields with their new values. */
  queued() {
    return this.operations().map((operation) => ({
      entity: operation.entity,
      kind: operation.kind,
      values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
  }
}

/** An application whose devices add a contact and correct one at its route. */
const madeOnDevices = syncRules({
  ...probePolicies,
  contacts: { create: true, change: 'never' },
})

/** One whose devices change a contact field by field as well. */
const changedOnDevices = syncRules({
  ...probePolicies,
  contacts: { create: true, change: 'merge' },
})

const words: ContactsPanelWords = {
  role: { label: 'Aufgabe', hint: 'Zum Beispiel Lagerleitung oder Empfang.' },
  add: 'Eintragen',
  needsConnection: 'Im Probewerk wird ein Ansprechpartner nur mit Verbindung berichtigt.',
  removal: 'Danach fragt im Probewerk niemand mehr nach dieser Person.',
}

const empty = 'Zu diesem Regal fragt man noch niemanden.'

let server: Server
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

async function mounted(over: Partial<ContactsPanelProps> = {}, rules = madeOnDevices) {
  const client = await SyncClient.start({
    store: await openLocalStore(`contacts-panel${String((counter += 1))}`),
    transport: server,
    writer: server,
    rules,
    deviceId: 'device',
    entities: ['shelves', 'letters', 'contacts'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  render(
    <Shell entry="office">
      <SyncProvider client={client}>
        <ContactsPanel
          parent={{ shelfId: 's-1' }}
          rules={probeContactRules}
          words={words}
          creates
          corrects
          empty={empty}
          {...over}
        />
      </SyncProvider>
    </Shell>,
  )

  return client
}

function card() {
  return within(screen.getByRole('region', { name: 'Ansprechpartner' }))
}

function people() {
  return card()
    .queryAllByRole('listitem')
    .map((item) => item.textContent)
}

/** The device hears from its browser that the network is gone, or back. */
function network(state: 'offline' | 'online') {
  act(() => {
    globalThis.dispatchEvent(new Event(state))
  })
}

beforeEach(() => {
  server = new Server()
  server.put('shelves', { id: 's-1', label: 'Wareneingang' })
  server.put('shelves', { id: 's-2', label: 'Archiv' })
  server.put('letters', { id: 'l-1', subject: 'Lieferschein', status: 'draft' })
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
  server.put(
    'contacts',
    contact('k-3', { letterId: 'l-1', givenName: 'Ole', familyName: 'Jensen', role: 'Empfänger' }),
  )
  server.put('contacts', contact('k-4', { shelfId: 's-2', familyName: 'Nachbar' }))
})

afterEach(() => {
  globalThis.dispatchEvent(new Event('online'))
})

describe('the contacts of a record in the office', () => {
  it('are those of the record the card stands on, by family name, with phone and e-mail to tap', async () => {
    await mounted()

    expect(people()).toEqual([
      'Albers',
      'Petra ZanderLagerleitung040 / 123-45zander@probewerk.example',
    ])
    expect(card().getByRole('link', { name: '040 / 123-45' }).getAttribute('href')).toBe(
      'tel:04012345',
    )
    expect(
      card().getByRole('link', { name: 'zander@probewerk.example' }).getAttribute('href'),
    ).toBe('mailto:zander@probewerk.example')
  })

  it('are found by whichever of its records the application hangs them on', async () => {
    await mounted({ parent: { letterId: 'l-1' } })

    expect(people()).toEqual(['Ole JensenEmpfänger'])
  })

  it('say what the application says while nobody is entered, and make way for the form', async () => {
    await mounted({ parent: { shelfId: 's-3' } })

    expect(card().getByText(empty)).toBeTruthy()
    expect(people()).toEqual([])

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    expect(card().queryByText(empty)).toBeNull()
    expect(card().getByLabelText(/Nachname/)).toBeTruthy()
  })

  it('offer adding to whoever may add and the pencil to whoever may correct, each on its own', async () => {
    await mounted({ creates: true, corrects: false })

    expect(card().getByRole('button', { name: 'Eintragen' })).toBeTruthy()
    expect(card().queryByRole('button', { name: /bearbeiten/ })).toBeNull()
  })

  it('offer the pencil without adding to whoever may only correct', async () => {
    await mounted({ creates: false, corrects: true })

    expect(card().queryByRole('button', { name: 'Eintragen' })).toBeNull()
    expect(card().getByRole('button', { name: 'Petra Zander bearbeiten' })).toBeTruthy()
    expect(card().getByRole('button', { name: 'Albers bearbeiten' })).toBeTruthy()
  })
})

describe('a new contact in the office', () => {
  it('goes through the outbox, on the record of the card and only there, in the words of the application', async () => {
    const client = await mounted()

    // The button in the head of the card opens the form and makes way for
    // the one under it, which is called the same.
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    expect(card().getAllByRole('button', { name: 'Eintragen' })).toHaveLength(1)
    expect(card().getByText('Zum Beispiel Lagerleitung oder Empfang.')).toBeTruthy()

    await userEvent.type(card().getByLabelText(/Vorname/), ' Bea ')
    await userEvent.type(card().getByLabelText(/Nachname/), 'Brandt')
    await userEvent.type(card().getByLabelText(/Aufgabe/), 'Empfang')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    await client.synchronise()

    // Empty fields do not travel on a new record, and neither does a letter:
    // the card of a shelf has no field for one.
    expect(server.queued()).toEqual([
      {
        entity: 'contacts',
        kind: 'create',
        values: { shelfId: 's-1', givenName: 'Bea', familyName: 'Brandt', role: 'Empfang' },
      },
    ])
    expect(people()).toContain('Bea BrandtEmpfang')
    // The form is gone, and the button that opens it is back.
    expect(card().queryByLabelText(/Nachname/)).toBeNull()
    expect(card().getByRole('button', { name: 'Eintragen' })).toBeTruthy()
  })

  it('waits on the device without a network, and the card says so', async () => {
    const client = await mounted()

    server.offline = true
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    await userEvent.type(card().getByLabelText(/Nachname/), 'Brandt')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(client.status().pending).toBe(1)
    })
    expect(people()).toContain('Brandt noch nicht übertragen')
    expect(server.sent).toEqual([])
  })

  it('is held by the rule of the family name and by what the application finds wrong, before anything is kept', async () => {
    const client = await mounted()

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    // Spaces pass the browser's own check of a required field.
    await userEvent.type(card().getByLabelText(/Nachname/), '   ')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    expect((await card().findByRole('alert')).textContent).toBe('Der Nachname fehlt.')

    await userEvent.type(card().getByLabelText(/Nachname/), 'Brandt')
    await userEvent.type(
      card().getByLabelText(/Aufgabe/),
      'Stellvertretende Leitung des Wareneingangs am Standort Nord',
    )
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(card().getByRole('alert').textContent).toBe('Die Funktion hat höchstens 40 Zeichen.')
    })

    await client.synchronise()

    expect(server.sent).toEqual([])
    expect(client.status().pending).toBe(0)
  })

  it('is refused with the sentence of the application by a card that stands on nothing, or on two', async () => {
    const client = await mounted({ parent: { shelfId: '' } })

    expect(people()).toEqual([])

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    await userEvent.type(card().getByLabelText(/Nachname/), 'Niemand')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    expect((await card().findByRole('alert')).textContent).toBe(probeContactRules.parentText.none)
    expect(client.status().pending).toBe(0)
  })

  it('is refused by a card that stands on two records at once', async () => {
    const client = await mounted({ parent: { shelfId: 's-1', letterId: 'l-1' } })

    // Whose contacts would it list: nobody's.
    expect(people()).toEqual([])

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    await userEvent.type(card().getByLabelText(/Nachname/), 'Doppelt')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    expect((await card().findByRole('alert')).textContent).toBe(
      probeContactRules.parentText.several,
    )
    expect(client.status().pending).toBe(0)
  })
})

describe('a new contact where the application makes it at its route', () => {
  let asked: Draft[]
  let answer: EditResult

  const make = (values: Draft) => {
    asked.push(values)

    return Promise.resolve(answer)
  }

  beforeEach(() => {
    asked = []
    answer = { outcome: 'queued', id: 'k-9' }
  })

  it('is handed to the application as the form collected it, and never queued', async () => {
    const client = await mounted({ make })

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    await userEvent.type(card().getByLabelText(/Nachname/), 'Brandt')
    await userEvent.type(card().getByLabelText(/Telefon/), '040 55 66')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(card().queryByLabelText(/Nachname/)).toBeNull()
    })
    expect(asked).toEqual([
      {
        shelfId: 's-1',
        givenName: null,
        familyName: 'Brandt',
        role: null,
        phone: '040 55 66',
        email: null,
      },
    ])
    expect(client.status().pending).toBe(0)
    expect(server.sent).toEqual([])
  })

  it('stays open with the sentence of the server when the application is refused', async () => {
    answer = {
      outcome: 'refused',
      reason: 'online_only',
      fields: [],
      message: 'Dieses Regal ist geschlossen und nimmt keinen Ansprechpartner mehr.',
    }
    await mounted({ make })

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    await userEvent.type(card().getByLabelText(/Nachname/), 'Brandt')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    expect((await card().findByRole('alert')).textContent).toBe(
      'Dieses Regal ist geschlossen und nimmt keinen Ansprechpartner mehr.',
    )
    expect(card().getByLabelText(/Nachname/)).toBeTruthy()
  })

  it('says before anybody fills the form in that it needs a connection, and cannot be sent without one', async () => {
    await mounted({ make })
    network('offline')

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    expect(card().getByRole('status').textContent).toBe(words.needsConnection)
    expect(card().getByRole<HTMLButtonElement>('button', { name: 'Eintragen' }).disabled).toBe(true)

    network('online')

    await waitFor(() => {
      expect(card().queryByRole('status')).toBeNull()
    })
    expect(card().getByRole<HTMLButtonElement>('button', { name: 'Eintragen' }).disabled).toBe(
      false,
    )
  })

  it('needs no connection where a new contact goes through the outbox', async () => {
    await mounted()
    network('offline')

    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    expect(card().queryByRole('status')).toBeNull()
    expect(card().getByRole<HTMLButtonElement>('button', { name: 'Eintragen' }).disabled).toBe(
      false,
    )
  })
})

describe('a contact corrected in the office', () => {
  it('goes to its route with the field that changed and nothing else, where the sync sends changes there', async () => {
    await mounted()

    await userEvent.click(card().getByRole('button', { name: 'Petra Zander bearbeiten' }))

    expect(card().getByLabelText<HTMLInputElement>(/Vorname/).value).toBe('Petra')
    expect(card().getByLabelText<HTMLInputElement>(/Telefon/).value).toBe('040 / 123-45')

    const role = card().getByLabelText(/Aufgabe/)

    await userEvent.clear(role)
    await userEvent.type(role, 'Empfang')
    await userEvent.click(card().getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.patched).toEqual([{ id: 'k-1', values: { role: 'Empfang' } }])
    })
    expect(server.sent).toEqual([])
    await waitFor(() => {
      expect(people()).toContain('Petra ZanderEmpfang040 / 123-45zander@probewerk.example')
    })
  })

  it('goes through the outbox where the sync lets a device change one', async () => {
    const client = await mounted({}, changedOnDevices)

    network('offline')
    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))

    // No word about a connection, and nothing greyed out: this application
    // needs none for it.
    expect(card().queryByRole('status')).toBeNull()

    await userEvent.type(card().getByLabelText(/Aufgabe/), 'Pforte')
    await userEvent.click(card().getByRole('button', { name: 'Speichern' }))
    await client.synchronise()

    expect(server.queued()).toEqual([
      { entity: 'contacts', kind: 'update', values: { role: 'Pforte' } },
    ])
    expect(server.patched).toEqual([])
  })

  it('is held by the rule of the family name before anything goes to the server', async () => {
    await mounted()

    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))

    const name = card().getByLabelText(/Nachname/)

    await userEvent.clear(name)
    await userEvent.type(name, '  ')
    await userEvent.click(card().getByRole('button', { name: 'Speichern' }))

    expect((await card().findByRole('alert')).textContent).toBe('Der Nachname fehlt.')
    expect(server.patched).toEqual([])
  })

  it('says in the words of the application that it needs a connection, before anybody fills the form in', async () => {
    await mounted()
    network('offline')

    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))

    expect(card().getByRole('status').textContent).toBe(words.needsConnection)
    expect(card().getByRole<HTMLButtonElement>('button', { name: 'Speichern' }).disabled).toBe(true)
    expect(card().getByRole<HTMLButtonElement>('button', { name: 'Entfernen' }).disabled).toBe(true)
  })

  it('is left as it was by whoever backs out of the form', async () => {
    await mounted()

    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))
    await userEvent.type(card().getByLabelText(/Aufgabe/), 'Pforte')
    await userEvent.click(card().getByRole('button', { name: 'Abbrechen' }))

    expect(people()).toContain('Albers')
    expect(server.patched).toEqual([])
  })
})

describe('a contact taken away in the office', () => {
  it('is asked about first, by name and with what the application says it means', async () => {
    await mounted()

    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))
    await userEvent.click(card().getByRole('button', { name: 'Entfernen' }))

    const question = screen.getByRole('alertdialog', { name: 'Albers entfernen?' })

    expect(within(question).getByText(words.removal)).toBeTruthy()
    expect(server.removed).toEqual([])

    await userEvent.click(within(question).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(server.removed).toEqual(['k-2'])
    })
    await waitFor(() => {
      expect(people()).toEqual(['Petra ZanderLagerleitung040 / 123-45zander@probewerk.example'])
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('stays when the question is answered with no', async () => {
    await mounted()

    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))
    await userEvent.click(card().getByRole('button', { name: 'Entfernen' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(server.removed).toEqual([])
    // The form it was asked from still stands.
    expect(card().getByLabelText<HTMLInputElement>(/Nachname/).value).toBe('Albers')
  })

  it('stays, with the sentence of the server over the list, when the server refuses', async () => {
    server.refusal = new RequestRefused(409, 'Zu diesem Regal wird diese Person noch gebraucht.')
    await mounted()

    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))
    await userEvent.click(card().getByRole('button', { name: 'Entfernen' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    expect((await card().findByRole('alert')).textContent).toBe(
      'Zu diesem Regal wird diese Person noch gebraucht.',
    )
    expect(card().getByLabelText<HTMLInputElement>(/Nachname/).value).toBe('Albers')

    // The next thing somebody does about a contact takes the sentence away.
    await userEvent.click(card().getByRole('button', { name: 'Abbrechen' }))
    await userEvent.click(card().getByRole('button', { name: 'Petra Zander bearbeiten' }))

    expect(card().queryByRole('alert')).toBeNull()
  })

  it('is asked about by what the list calls somebody without a name', async () => {
    server.put('contacts', contact('k-5', { shelfId: 's-1', familyName: '' }))
    await mounted()

    await userEvent.click(
      card().getByRole('button', { name: 'Ansprechpartner ohne Namen bearbeiten' }),
    )
    await userEvent.click(card().getByRole('button', { name: 'Entfernen' }))

    expect(
      screen.getByRole('alertdialog', { name: 'Ansprechpartner ohne Namen entfernen?' }),
    ).toBeTruthy()
  })
})

describe('the contacts of a record drawn in one line each', () => {
  it('say what somebody is and how to reach them in one line under the name, each only when it is there', async () => {
    server.put(
      'contacts',
      contact('k-5', { shelfId: 's-1', familyName: 'Meyer', phone: '0171 22 33' }),
    )
    server.put(
      'contacts',
      contact('k-6', { shelfId: 's-1', familyName: 'Ottens', email: 'ottens@probewerk.example' }),
    )
    await mounted({ dense: true })

    expect(people()).toEqual([
      'Albers',
      'Meyer0171 22 33',
      'Ottensottens@probewerk.example',
      'Petra ZanderLagerleitung · 040 / 123-45 · zander@probewerk.example',
    ])
    expect(card().getByRole('link', { name: '040 / 123-45' }).getAttribute('href')).toBe(
      'tel:04012345',
    )
    expect(
      card().getByRole('link', { name: 'zander@probewerk.example' }).getAttribute('href'),
    ).toBe('mailto:zander@probewerk.example')
    expect(card().getByRole('link', { name: '0171 22 33' }).getAttribute('href')).toBe(
      'tel:01712233',
    )

    // Somebody of whom only the name is known has no second line at all.
    const [albers] = card().getAllByRole('listitem')

    expect(albers?.querySelectorAll('div div')).toHaveLength(1)
  })

  it('are changed and taken away behind the same pencil', async () => {
    await mounted({ dense: true })

    await userEvent.click(card().getByRole('button', { name: 'Petra Zander bearbeiten' }))

    const role = card().getByLabelText(/Aufgabe/)

    await userEvent.clear(role)
    await userEvent.type(role, 'Empfang')
    await userEvent.click(card().getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.patched).toEqual([{ id: 'k-1', values: { role: 'Empfang' } }])
    })
    await waitFor(() => {
      expect(people()).toContain('Petra ZanderEmpfang · 040 / 123-45 · zander@probewerk.example')
    })

    await userEvent.click(card().getByRole('button', { name: 'Albers bearbeiten' }))
    await userEvent.click(card().getByRole('button', { name: 'Entfernen' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Albers entfernen?' })).getByRole('button', {
        name: 'Entfernen',
      }),
    )

    await waitFor(() => {
      expect(server.removed).toEqual(['k-2'])
    })
  })

  it('have no pencil for whoever may not correct, and say when one waits on the device', async () => {
    const client = await mounted({ dense: true, corrects: false })

    expect(card().queryByRole('button', { name: /bearbeiten/ })).toBeNull()

    server.offline = true
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))
    await userEvent.type(card().getByLabelText(/Nachname/), 'Brandt')
    await userEvent.type(card().getByLabelText(/Aufgabe/), 'Empfang')
    await userEvent.click(card().getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(client.status().pending).toBe(1)
    })
    expect(people()).toContain('Brandt noch nicht übertragenEmpfang')
  })
})
