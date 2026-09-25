import type { RecordState } from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { useState } from 'react'

import { Button, useEntry } from '../components/index.js'
import { type Assignee, assignees } from '../session/tasks.js'
import { refusalFor } from '../sync/client.js'
import { maybeText, text } from '../sync/fields.js'
import { useRecord, useSync } from '../sync/provider.js'
import { date, today } from './format.js'
import { taskStatusOf } from './labels.js'
import { accountQuery, useMay } from './queries.js'
import { RecordForm, asTextOrNull } from './record-form.js'

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

/** Who a task is for, as the person looking at it reads it. */
export function responsibleFor(
  task: RecordState,
  me: string | null,
  people: readonly Assignee[],
): string {
  const userId = text(task, 'assigneeUserId')

  if (userId === me) {
    return 'du'
  }

  return people.find((person) => person.userId === userId)?.name ?? 'jemand anderes'
}

/** Open and past its day. Said in words wherever it is shown, never by colour alone. */
export function isOverdue(task: RecordState, on: string = today()): boolean {
  return taskStatusOf(task) === 'open' && text(task, 'dueOn') < on
}

/**
 * The order somebody works through a list in: what is open first, the one due
 * soonest at the top; what is done after it, the most recent first. The id
 * breaks a tie, so that two tasks due on the same day do not swap places
 * between two renders.
 */
export function inWorkingOrder(tasks: readonly RecordState[]): RecordState[] {
  return [...tasks].sort((left, right) => {
    const leftOpen = taskStatusOf(left) === 'open'
    const rightOpen = taskStatusOf(right) === 'open'

    if (leftOpen !== rightOpen) {
      return leftOpen ? -1 : 1
    }

    const byDay = text(left, 'dueOn').localeCompare(text(right, 'dueOn'))

    return (leftOpen ? byDay : -byDay) || String(left['id']).localeCompare(String(right['id']))
  })
}

/**
 * One task: what, by when, for whom, and the one thing to do about it.
 *
 * Marking it done goes through the outbox like every other change on a
 * device, so it works in a basement and shows as not sent yet until there is
 * a connection. A task that is done can be opened again; a tick set by
 * mistake is not worth a phone call to the office.
 */
export function TaskItem({
  task,
  me,
  people,
  showJob = false,
}: {
  readonly task: RecordState
  readonly me: string | null
  readonly people: readonly Assignee[]
  /** For a list that is not already on the job's own screen. */
  readonly showJob?: boolean
}) {
  const client = useSync()
  const entry = useEntry()
  const mayWrite = useMay('task.write')
  const id = String(task['id'])
  const status = taskStatusOf(task)
  const job = useRecord('jobs', showJob ? (maybeText(task, 'jobId') ?? undefined) : undefined)
  const [trouble, setTrouble] = useState<string | null>(null)

  const facts = [
    `Fällig am ${date(task['dueOn'])}`,
    isOverdue(task) ? 'überfällig' : null,
    `verantwortlich: ${responsibleFor(task, me, people)}`,
    status === 'done' ? 'erledigt' : null,
    client.isPending('tasks', id) ? 'noch nicht übertragen' : null,
  ].filter((fact): fact is string => fact !== null)

  const toggle = () => {
    setTrouble(null)

    void client
      .update('tasks', id, { status: status === 'open' ? 'done' : 'open' })
      .then((saved) => {
        if (saved.outcome === 'refused') {
          setTrouble(refusalFor(saved))
        }
      })
  }

  if (entry === 'office') {
    // A row of the card, as `task_item()` of the canvas draws it (#219): what,
    // then by when and for whom, red when it is overdue, the job it hangs
    // on, and the one button at the right.
    return (
      <li className="flex items-start gap-2.5 border-b border-row py-[9px]">
        <div className="min-w-0 grow">
          <div
            className={clsx(
              'text-[14px] font-medium [overflow-wrap:anywhere]',
              status === 'done' && 'text-ink-faint line-through',
            )}
          >
            {text(task, 'title')}
          </div>
          <div
            className={clsx(
              'mt-0.5 text-[13px]',
              isOverdue(task) ? 'text-conflict' : 'text-ink-faint',
            )}
          >
            {facts.join(', ')}
          </div>
          {maybeText(task, 'notes') ? (
            <p className="mt-1 whitespace-pre-line text-[13px] text-ink">{text(task, 'notes')}</p>
          ) : null}
          {job ? (
            <Link
              to={`/auftraege/${String(job['id'])}`}
              className="text-[13px] text-copper-text underline underline-offset-2"
            >
              {text(job, 'designation')}
            </Link>
          ) : null}
          {trouble ? (
            <p role="alert" className="mt-1 text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
        </div>
        {mayWrite ? (
          <Button size="small" onClick={toggle}>
            {status === 'open' ? 'Erledigt' : 'Wieder öffnen'}
          </Button>
        ) : null}
      </li>
    )
  }

  // A row of the card on site, `task_row()` of the boards: what, by when and
  // for whom, red when it is overdue, the job it hangs on, and "Erledigt" at
  // the right.
  return (
    <li className="flex items-start gap-2.5 border-b border-row py-2.5">
      <div className="min-w-0 grow">
        <div
          className={clsx(
            'text-[17px] font-semibold [overflow-wrap:anywhere]',
            status === 'done' && 'font-normal text-ink-faint line-through',
          )}
        >
          {text(task, 'title')}
        </div>
        <div
          className={clsx(
            'mt-0.5 text-[15px] leading-[1.35]',
            isOverdue(task) ? 'text-conflict' : 'text-ink-muted',
          )}
        >
          {facts.join(', ')}
        </div>
        {maybeText(task, 'notes') ? (
          <p className="mt-1 text-[16px] whitespace-pre-line text-ink">{text(task, 'notes')}</p>
        ) : null}
        {job ? (
          <div className="mt-1 text-[17px]">
            <Link
              to={`/auftraege/${String(job['id'])}`}
              className="relative font-semibold text-copper-text underline underline-offset-2 before:absolute before:inset-x-0 before:-inset-y-2.5"
            >
              {text(job, 'designation')}
            </Link>
          </div>
        ) : null}
        {trouble ? (
          <p role="alert" className="mt-1 text-[16px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
      {mayWrite ? (
        <Button height={44} onClick={toggle}>
          {status === 'open' ? 'Erledigt' : 'Wieder öffnen'}
        </Button>
      ) : null}
    </li>
  )
}

/** Tasks in working order, or a sentence when there are none. */
export function TaskList({
  tasks,
  me,
  people,
  showJob,
  empty,
}: {
  readonly tasks: readonly RecordState[]
  readonly me: string | null
  readonly people: readonly Assignee[]
  readonly showJob?: boolean
  readonly empty: string
}) {
  const entry = useEntry()

  if (tasks.length === 0) {
    return (
      <p
        className={
          entry === 'office'
            ? 'text-[13px] leading-[1.4] text-ink-muted'
            : 'text-[16px] leading-[1.45] text-ink-muted'
        }
      >
        {empty}
      </p>
    )
  }

  return (
    <ul>
      {inWorkingOrder(tasks).map((task) => (
        <TaskItem key={String(task['id'])} task={task} me={me} people={people} showJob={showJob} />
      ))}
    </ul>
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
