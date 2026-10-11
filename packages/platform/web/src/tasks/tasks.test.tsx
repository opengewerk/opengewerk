import 'fake-indexeddb/auto'

import { syncRules, taskEntity, taskTitleMissing } from '@opengewerk/platform-domain'
import type { RecordState } from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { Shell } from '../components/surface.js'
import { InRouter } from '../in-router.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider, useRecords } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { NewTaskForm } from './new-task-form.js'
import type { NewTaskFormProps } from './new-task-form.js'
import { TaskList, TaskTarget } from './task-list.js'
import type { TaskListProps, TaskPerson } from './task-list.js'

/**
 * The tasks of an application that belongs to nobody: something to do at a
 * shelf, for oneself or for a colleague. What a task hangs on, who may hand
 * one out and how the person looking is addressed are handed in; the row, the
 * list and the form are the foundation's.
 */

type Row = Record<string, unknown>

/** A server that says what went out through the outbox. */
class Server extends TestServer {
  queued() {
    return this.operations().map((operation) => ({
      entity: operation.entity,
      kind: operation.kind,
      values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
  }
}

const rules = syncRules({ ...probePolicies, tasks: { create: true, change: 'merge' } })
const words = { you: 'Sie' }
const people: readonly TaskPerson[] = [
  { userId: 'ana', name: 'Ana Albers' },
  { userId: 'ben', name: 'Ben Berg' },
]

let server: Server
let counter = 0

function task(id: string, over: Row): Row {
  return {
    id,
    title: 'Etwas',
    dueOn: '2099-01-01',
    assigneeUserId: 'ana',
    status: 'open',
    shelfId: null,
    createdBy: 'ana',
    ...over,
  }
}

async function started(entry: 'office' | 'site', body: ReactNode) {
  const client = await SyncClient.start({
    store: await openLocalStore(`tasks${String((counter += 1))}`),
    transport: server,
    writer: server,
    rules,
    deviceId: 'device',
    entities: ['shelves', taskEntity],
    onSignedOut: () => {},
  })

  await client.synchronise()

  render(
    <Shell entry={entry}>
      <SyncProvider client={client}>
        <InRouter>{body}</InRouter>
      </SyncProvider>
    </Shell>,
  )

  return client
}

/** The tasks the device holds, in the list of the foundation. */
function Tasks(over: Partial<TaskListProps>) {
  const tasks = useRecords(taskEntity)

  return (
    <TaskList
      tasks={tasks}
      me="ana"
      people={people}
      words={words}
      mayChange={() => true}
      empty="Hier ist nichts zu tun."
      {...over}
    />
  )
}

function rows() {
  return screen.queryAllByRole('listitem').map((item) => item.textContent)
}

beforeEach(() => {
  server = new Server()
  server.put('shelves', { id: 's-1', label: 'Wareneingang' })
  server.put('shelves', { id: 's-2', label: 'Archiv' })
})

describe('a list of tasks', () => {
  it('puts the open first, soonest at the top, says late in words and who answers for each', async () => {
    server.put(taskEntity, task('t-1', { title: 'Später', dueOn: '2099-03-01' }))
    server.put(taskEntity, task('t-2', { title: 'Längst fällig', dueOn: '2020-01-01' }))
    server.put(
      taskEntity,
      task('t-3', { title: 'Erledigt schon', status: 'done', assigneeUserId: 'ben' }),
    )
    server.put(
      taskEntity,
      task('t-4', { title: 'Bald', dueOn: '2099-01-02', assigneeUserId: 'cem' }),
    )
    await started('office', <Tasks />)

    await waitFor(() => {
      expect(rows()).toEqual([
        'Längst fälligFällig am 01.01.2020, überfällig, verantwortlich: SieErledigt',
        'BaldFällig am 02.01.2099, verantwortlich: jemand anderesErledigt',
        'SpäterFällig am 01.03.2099, verantwortlich: SieErledigt',
        'Erledigt schonFällig am 01.01.2099, verantwortlich: Ben Berg, erledigtWieder öffnen',
      ])
    })
  })

  it('says so when there is none', async () => {
    await started('site', <Tasks />)

    expect(await screen.findByText('Hier ist nichts zu tun.')).toBeTruthy()
  })

  it('marks a task done through the outbox and opens it again', async () => {
    server.put(taskEntity, task('t-1', { title: 'Regal räumen' }))
    const client = await started('site', <Tasks />)

    await userEvent.click(await screen.findByRole('button', { name: 'Erledigt' }))
    await client.synchronise()

    expect(server.queued()).toEqual([
      { entity: taskEntity, kind: 'update', values: { status: 'done' } },
    ])
    await userEvent.click(await screen.findByRole('button', { name: 'Wieder öffnen' }))
    await client.synchronise()

    expect(server.queued().at(-1)).toEqual({
      entity: taskEntity,
      kind: 'update',
      values: { status: 'open' },
    })
  })

  it('says of a task ticked without a network that it has not gone to the server yet', async () => {
    server.put(taskEntity, task('t-1', { title: 'Regal räumen' }))
    const client = await started('site', <Tasks />)

    server.offline = true
    await userEvent.click(await screen.findByRole('button', { name: 'Erledigt' }))
    await client.synchronise()

    await waitFor(() => {
      expect(rows()).toEqual([
        'Regal räumenFällig am 01.01.2099, verantwortlich: Sie, erledigt, noch nicht übertragenWieder öffnen',
      ])
    })
  })

  it('offers nothing to change on a task the person may not change', async () => {
    server.put(taskEntity, task('t-1', { title: 'Für Ana' }))
    server.put(taskEntity, task('t-2', { title: 'Für Ben', assigneeUserId: 'ben' }))
    await started(
      'office',
      <Tasks mayChange={(each: RecordState) => each['assigneeUserId'] === 'ana'} />,
    )

    await waitFor(() => {
      expect(rows()).toHaveLength(2)
    })
    const [mine, other] = screen.getAllByRole('listitem')

    expect(within(mine as HTMLElement).queryByRole('button')).not.toBeNull()
    expect(within(other as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('links the record a task hangs on as the application says', async () => {
    server.put(taskEntity, task('t-1', { title: 'Regal räumen', shelfId: 's-1' }))
    await started(
      'office',
      <Tasks
        targetOf={(each: RecordState) =>
          each['shelfId'] ? <TaskTarget to="/regale/s-1">Wareneingang</TaskTarget> : null
        }
      />,
    )

    expect((await screen.findByRole('link', { name: 'Wareneingang' })).getAttribute('href')).toBe(
      '/regale/s-1',
    )
  })
})

/** The form, with a field for the shelf where the screen does not say one. */
function form(over: Partial<NewTaskFormProps> = {}) {
  return (
    <NewTaskForm
      me="ana"
      myName="Ana Albers"
      others={() => []}
      words={words}
      longest={20}
      onDone={() => {}}
      {...over}
    />
  )
}

const shelfField: NewTaskFormProps['place'] = {
  field: {
    name: 'shelf',
    label: 'Woran',
    required: true,
    options: [
      { value: '', label: 'Bitte wählen' },
      { value: 's-1', label: 'Wareneingang' },
      { value: 's-2', label: 'Archiv' },
    ],
  },
  linksOf: (value) => ({ shelfId: value === '' ? null : value }),
}

describe('a new task', () => {
  it('goes to whoever writes it unless somebody else is chosen, with what the screen hangs it on', async () => {
    const client = await started('site', form({ links: { shelfId: 's-2' } }))

    await userEvent.type(await screen.findByLabelText(/Was zu tun ist/), '  Etiketten kleben ')
    expect((screen.getByLabelText(/Verantwortlich/) as HTMLSelectElement).value).toBe('ana')
    expect(
      Array.from((screen.getByLabelText(/Verantwortlich/) as HTMLSelectElement).options).map(
        (option) => option.text,
      ),
    ).toEqual(['Ana Albers (Sie)'])
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe anlegen' }))
    await client.synchronise()

    const [made] = server.queued()

    expect(made?.kind).toBe('create')
    expect(made?.values).toMatchObject({
      title: 'Etiketten kleben',
      assigneeUserId: 'ana',
      status: 'open',
      shelfId: 's-2',
    })
    expect(made?.values['dueOn']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('offers the others the application lets it reach from the chosen record, and writes the one chosen', async () => {
    const client = await started(
      'office',
      form({
        place: shelfField,
        others: (values) => (values['shelf'] === 's-1' ? people : []),
      }),
    )
    const responsible = () => screen.getByLabelText(/Verantwortlich/) as HTMLSelectElement
    const choices = () => Array.from(responsible().options).map((option) => option.text)

    await userEvent.type(await screen.findByLabelText(/Was zu tun ist/), 'Regal prüfen')
    expect(choices()).toEqual(['Ana Albers (Sie)'])
    await userEvent.selectOptions(screen.getByLabelText(/Woran/), 's-1')
    expect(choices()).toEqual(['Ana Albers (Sie)', 'Ben Berg'])
    await userEvent.selectOptions(responsible(), 'ben')
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe anlegen' }))
    await client.synchronise()

    expect(server.queued()[0]?.values).toMatchObject({
      title: 'Regal prüfen',
      assigneeUserId: 'ben',
      shelfId: 's-1',
    })
  })

  it('keeps nothing without a text, or with one too long', async () => {
    const client = await started('office', form({ place: shelfField }))
    const send = () => userEvent.click(screen.getByRole('button', { name: 'Aufgabe anlegen' }))

    await userEvent.type(await screen.findByLabelText(/Was zu tun ist/), '   ')
    await userEvent.selectOptions(screen.getByLabelText(/Woran/), 's-2')
    await send()
    expect(screen.getByRole('alert').textContent).toBe(taskTitleMissing)

    await userEvent.type(screen.getByLabelText(/Was zu tun ist/), 'x'.repeat(21))
    await send()
    expect(screen.getByRole('alert').textContent).toBe(
      'Der Text einer Aufgabe hat höchstens 20 Zeichen.',
    )

    await client.synchronise()
    expect(server.queued()).toEqual([])
  })

  it('says under its buttons what the application wants said', async () => {
    await started('site', form({ note: 'Auf dem Gerät gesichert.' }))

    expect(await screen.findByText('Auf dem Gerät gesichert.')).toBeTruthy()
  })

  it('waits until it is known who is writing', async () => {
    await started('office', form({ me: null }))

    expect(await screen.findByText('Einen Moment, die Anmeldung wird gelesen.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Aufgabe anlegen' })).toBeNull()
  })
})
