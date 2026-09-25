import type { RecordState } from '@opengewerk/domain'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Panel } from '../../components/index.js'
import { taskStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { NewTaskForm, TaskList, usePeople } from '../../app/tasks.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecords, useRelated } from '../../sync/provider.js'

/**
 * What is open for whoever holds the device, on the first screen.
 *
 * The list the issue asks for, in the one place on site that somebody looks
 * at every morning. Not a third item in the bottom bar, which is two items on
 * purpose; a list at the top of the start screen is found without one.
 * Nothing shows when there is nothing open, so the jobs keep the space.
 */
export function MyTasks() {
  const readsTasks = useMay('task.read')
  const tasks = useRecords('tasks')
  const { me, people } = usePeople()
  const mine = useMemo(
    () =>
      tasks.filter(
        (task) =>
          taskStatusOf(task) === 'open' && me !== null && text(task, 'assigneeUserId') === me,
      ),
    [tasks, me],
  )

  if (!readsTasks || mine.length === 0) {
    return null
  }

  return (
    <Panel title="Deine Aufgaben">
      <TaskList tasks={mine} me={me} people={people} showJob empty="" />
    </Panel>
  )
}

/**
 * The tasks of one job, and a way to write one down while standing in it.
 *
 * Written here, a task takes the job with it and the job's customer and site,
 * so the office finds it on all three. It is for oneself unless somebody else
 * is chosen: most of what gets noted on site is what the technician has to
 * remember, and the rest is for the office.
 */
export function JobTasks({ job }: { readonly job: RecordState }) {
  const readsTasks = useMay('task.read')
  const writesTasks = useMay('task.write')
  const jobId = String(job['id'])
  const tasks = useRelated('tasks', 'jobId', jobId)
  const { me, people } = usePeople()
  const [adding, setAdding] = useState(false)

  if (!readsTasks) {
    return null
  }

  return (
    <Panel title="Aufgaben">
      <div className="flex flex-col gap-2">
        <TaskList
          tasks={tasks}
          me={me}
          people={people}
          empty="Zu diesem Auftrag ist keine Aufgabe offen."
        />
        {adding ? (
          <NewTaskForm
            links={{
              customerId: String(job['customerId']),
              siteId: maybeText(job, 'siteId'),
              jobId,
            }}
            onDone={() => {
              setAdding(false)
            }}
          />
        ) : writesTasks ? (
          <Button
            wide
            height={48}
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            Aufgabe notieren
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}
