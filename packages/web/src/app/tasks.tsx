import type { RecordState } from '@opengewerk/domain'
import { today } from '@opengewerk/platform-web/format'
import { accountQuery } from '@opengewerk/platform-web/session'
import {
  RecordForm,
  asTextOrNull,
  maybeText,
  text,
  useRecord,
  useSync,
} from '@opengewerk/platform-web/sync'
import {
  TaskList as FoundationTaskList,
  TaskTarget,
  type TaskWords,
} from '@opengewerk/platform-web/tasks'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { type Assignee, assignees } from '../session/tasks.js'
import { useMay } from './queries.js'

/**
 * Who is looking, and the names of everybody a task can name.
 *
 * The names come from the server while there is a connection and are kept for
 * as long as the page is open. Without them a task still shows, with "du" for
 * one's own and a plain word for anybody else's: the task is the point, the
 * name is a courtesy.
 */
export function usePeople(): { readonly me: string | null; readonly people: readonly Assignee[] } {
  const account = useQuery(accountQuery)
  const people = useQuery({
    queryKey: ['assignees'],
    queryFn: assignees,
    staleTime: 5 * 60_000,
    retry: false,
  })

  // An answer this screen does not understand is no list of people either.
  return {
    me: account.data?.userId ?? null,
    people: Array.isArray(people.data) ? people.data : [],
  }
}

/** How this application addresses the person looking: "du", on site as in the office. */
const taskWords: TaskWords = { you: 'du' }

/**
 * The job a task hangs on, as a link under its facts, for a list that is not
 * already on the job's own screen.
 */
function JobOfTask({ task }: { readonly task: RecordState }) {
  const job = useRecord('jobs', maybeText(task, 'jobId') ?? undefined)

  return job ? (
    <TaskTarget to={`/auftraege/${String(job['id'])}`}>{text(job, 'designation')}</TaskTarget>
  ) : null
}

/**
 * Tasks in working order, or a sentence when there are none: the list of the
 * foundation (#597), with the rows as `task_item()` and `task_row()` of the
 * boards draw them. Whoever holds `task.write` may mark any of them done or
 * open it again; this application has no narrower rule for a task.
 */
export function TaskList({
  tasks,
  me,
  people,
  showJob = false,
  empty,
}: {
  readonly tasks: readonly RecordState[]
  readonly me: string | null
  readonly people: readonly Assignee[]
  /** For a list that is not already on the job's own screen. */
  readonly showJob?: boolean
  readonly empty: string
}) {
  const mayWrite = useMay('task.write')

  return (
    <FoundationTaskList
      tasks={tasks}
      me={me}
      people={people}
      words={taskWords}
      mayChange={() => mayWrite}
      {...(showJob ? { targetOf: (task: RecordState) => <JobOfTask task={task} /> } : {})}
      empty={empty}
    />
  )
}

/** What a new task hangs on, taken from where it was written. */
export interface TaskLinks {
  readonly customerId?: string | null
  readonly siteId?: string | null
  readonly jobId?: string | null
}

/**
 * Writing a task down, wherever somebody happens to be.
 *
 * It hangs on whatever screen it was written on, customer, site or job, and
 * asks for nothing of that again. The person defaults to whoever writes it,
 * which is the common case on site: something to remember for oneself. The
 * list of others comes from the server; without a connection there is only
 * oneself to choose, and the task still gets written.
 */
export function NewTaskForm({
  links,
  wide = false,
  onDone,
}: {
  readonly links: TaskLinks
  /** The four fields in one row, as the board "Aufgaben" draws the card "Neue Aufgabe". */
  readonly wide?: boolean
  readonly onDone: () => void
}) {
  const client = useSync()
  const { me, people } = usePeople()
  const choices = people
    .filter((person) => person.active)
    .map((person) => ({
      value: person.userId,
      label: person.userId === me ? `${person.name} (du)` : person.name,
    }))
  const options =
    me !== null && !choices.some((choice) => choice.value === me)
      ? [{ value: me, label: 'du' }, ...choices]
      : choices
  const [blank, setBlank] = useState(false)

  // The form takes its starting values once, when it appears. Shown before it
  // is known who is writing, it would start without a person and keep that.
  if (me === null) {
    return <p className="text-body text-ink-muted">Einen Moment, die Anmeldung wird gelesen.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <RecordForm
        fields={[
          { name: 'title', label: 'Was zu tun ist', required: true },
          { name: 'dueOn', label: 'Fällig am', kind: 'date', required: true },
          { name: 'assigneeUserId', label: 'Verantwortlich', options, required: true },
          { name: 'notes', label: 'Notiz' },
        ]}
        record={{ dueOn: today(), assigneeUserId: me }}
        submitLabel="Aufgabe anlegen"
        {...(wide
          ? {
              columns: 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)]',
              divided: false,
            }
          : {})}
        onCancel={onDone}
        onSubmit={async (values) => {
          const title = asTextOrNull(values['title'])

          // The field is required, so a browser stops an empty one; one of
          // nothing but spaces it lets through, and it would be a task
          // nobody can tell apart from the next.
          if (title === null) {
            setBlank(true)

            return { outcome: 'queued', id: '' }
          }

          setBlank(false)

          const made = await client.create('tasks', {
            title,
            dueOn: values['dueOn'] ?? today(),
            assigneeUserId: values['assigneeUserId'] ?? me,
            notes: asTextOrNull(values['notes']),
            status: 'open',
            customerId: links.customerId ?? null,
            siteId: links.siteId ?? null,
            jobId: links.jobId ?? null,
          })

          if (made.outcome === 'queued') {
            onDone()
          }

          return made
        }}
      />
      {blank ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          Die Aufgabe braucht einen Text, der sagt, was zu tun ist.
        </p>
      ) : null}
    </div>
  )
}
