import { useMemo, useState } from 'react'

import { Button } from '../../components/index.js'
import { taskStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { NewTaskForm, TaskList, type TaskLinks, usePeople } from '../../app/tasks.js'
import { text } from '../../sync/fields.js'
import { useRecords, useRelated } from '../../sync/provider.js'
import { Page, Section } from '../layout.js'

/**
 * The tasks that hang on one customer, site or job, on that record's screen.
 *
 * Where it hangs is where it is looked for while somebody works on that
 * customer: a task that only stood in a central list would be overlooked
 * exactly there. Written here, a task takes the record with it, and a job
 * brings its customer and site along so the task shows on those screens too.
 */
export function TasksSection({
  field,
  id,
  links,
  empty,
}: {
  /** The field on a task that names this record: `customerId`, `siteId` or `jobId`. */
  readonly field: 'customerId' | 'siteId' | 'jobId'
  readonly id: string
  readonly links: TaskLinks
  readonly empty: string
}) {
  const readsTasks = useMay('task.read')
  const writesTasks = useMay('task.write')
  const tasks = useRelated('tasks', field, id)
  const { me, people } = usePeople()
  const [adding, setAdding] = useState(false)

  if (!readsTasks) {
    return null
  }

  return (
    <Section
      title="Aufgaben"
      actions={
        writesTasks ? (
          <Button
            tone="secondary"
            onClick={() => {
              setAdding((open) => !open)
            }}
          >
            {adding ? 'Abbrechen' : 'Aufgabe anlegen'}
          </Button>
        ) : null
      }
    >
      {adding ? (
        <div className="mb-4">
          <NewTaskForm
            links={links}
            onDone={() => {
              setAdding(false)
            }}
          />
        </div>
      ) : null}
      <TaskList tasks={tasks} me={me} people={people} showJob={field !== 'jobId'} empty={empty} />
    </Section>
  )
}

/**
 * Everything that is left to do, starting with one's own.
 *
 * The second half of what the issue asks: a task that hangs only on a
 * customer is found while working on that customer and missed in the morning,
 * when somebody wants to know what is on for today. Mine first, then what is
 * open with the others, because the office hands tasks on and has to see
 * whether they are done. What is done is left out of both; it stays on the
 * record it hangs on.
 */
export function TaskListScreen() {
  const readsTasks = useMay('task.read')
  const writesTasks = useMay('task.write')
  const tasks = useRecords('tasks')
  const { me, people } = usePeople()
  const [adding, setAdding] = useState(false)

  const open = useMemo(() => tasks.filter((task) => taskStatusOf(task) === 'open'), [tasks])
  const mine = open.filter((task) => text(task, 'assigneeUserId') === me)
  const others = open.filter((task) => text(task, 'assigneeUserId') !== me)

  return (
    <Page
      title="Aufgaben"
      meta="Was zu tun ist, nach Fälligkeit."
      actions={
        writesTasks ? (
          <Button
            tone="primary"
            onClick={() => {
              setAdding((opened) => !opened)
            }}
          >
            {adding ? 'Abbrechen' : 'Aufgabe anlegen'}
          </Button>
        ) : null
      }
    >
      {!readsTasks ? (
        <p className="text-body text-ink-muted">Aufgaben sehen darf dieser Zugang nicht.</p>
      ) : (
        <>
          {adding ? (
            <Section title="Neue Aufgabe">
              <NewTaskForm
                links={{}}
                onDone={() => {
                  setAdding(false)
                }}
              />
            </Section>
          ) : null}
          <Section title="Deine Aufgaben">
            <TaskList
              tasks={mine}
              me={me}
              people={people}
              showJob
              empty="Für dich ist gerade nichts offen."
            />
          </Section>
          <Section title="Offen bei anderen">
            <TaskList
              tasks={others}
              me={me}
              people={people}
              showJob
              empty="Bei den anderen ist gerade nichts offen."
            />
          </Section>
        </>
      )}
    </Page>
  )
}
