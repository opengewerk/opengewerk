import { compareTasksForWork, isTaskOverdue, taskEntity } from '@opengewerk/platform-domain'
import type { RecordState } from '@opengewerk/platform-domain'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/button.js'
import { useEntry } from '../components/surface.js'
import { date, today } from '../format.js'
import { refusalFor } from '../sync/client.js'
import { maybeText, text } from '../sync/fields.js'
import { useSync } from '../sync/provider.js'

/** One person a task can name, as the application knows them: a key and a name. */
export interface TaskPerson {
  readonly userId: string
  readonly name: string
}

/**
 * The words of the application for a task. Only how it addresses the person
 * looking differs between applications: one says "du", another "Sie".
 */
export interface TaskWords {
  /** The person looking, as the one a task is for. */
  readonly you: string
}

/** Who a task is for, as the person looking at it reads it. */
export function responsibleFor(
  task: RecordState,
  me: string | null,
  people: readonly TaskPerson[],
  words: TaskWords,
): string {
  const userId = text(task, 'assigneeUserId')

  if (userId === me) {
    return words.you
  }

  return people.find((person) => person.userId === userId)?.name ?? 'jemand anderes'
}

/** What the order and the word "überfällig" look at, read from a record. */
function standingOf(task: RecordState) {
  return { id: String(task['id']), status: text(task, 'status'), dueOn: text(task, 'dueOn') }
}

/** Whether a task is open and past its day, today unless another day is asked. */
export function overdue(task: RecordState, on: string = today()): boolean {
  return isTaskOverdue(standingOf(task), on)
}

/** Tasks in the order somebody works through them (`compareTasksForWork`). */
export function inWorkingOrder(tasks: readonly RecordState[]): RecordState[] {
  return [...tasks].sort((left, right) => compareTasksForWork(standingOf(left), standingOf(right)))
}

/**
 * The record a task hangs on, as a link under its facts: small in the
 * office, large enough for a thumb on site.
 */
export function TaskTarget({
  to,
  children,
}: {
  readonly to: string
  readonly children: ReactNode
}) {
  const entry = useEntry()

  if (entry === 'office') {
    return (
      <Link to={to} className="text-[13px] text-copper-text underline underline-offset-2">
        {children}
      </Link>
    )
  }

  return (
    <div className="mt-1 text-[17px]">
      <Link
        to={to}
        className="relative font-semibold text-copper-text underline underline-offset-2 before:absolute before:inset-x-0 before:-inset-y-2.5"
      >
        {children}
      </Link>
    </div>
  )
}

export interface TaskItemProps {
  readonly task: RecordState
  readonly me: string | null
  readonly people: readonly TaskPerson[]
  readonly words: TaskWords
  /**
   * Whether the person looking may mark it done or open it again: the
   * application asks its rights (`mayChangeTask`). Without, the task is shown
   * and nothing is offered.
   */
  readonly mayChange: boolean
  /** The record it hangs on, as the application links it (`TaskTarget`). */
  readonly target?: ReactNode
}

/**
 * One task: what, by when, for whom, and the one thing to do about it.
 *
 * Marking it done goes through the outbox like every other change on a
 * device, so it works in a basement and shows as not sent yet until there is
 * a connection. A task that is done can be opened again; a tick set by
 * mistake is not worth a phone call.
 */
export function TaskItem({ task, me, people, words, mayChange, target }: TaskItemProps) {
  const client = useSync()
  const entry = useEntry()
  const id = String(task['id'])
  const done = text(task, 'status') === 'done'
  const late = overdue(task)
  const [trouble, setTrouble] = useState<string | null>(null)

  const facts = [
    `Fällig am ${date(task['dueOn'])}`,
    late ? 'überfällig' : null,
    `verantwortlich: ${responsibleFor(task, me, people, words)}`,
    done ? 'erledigt' : null,
  ].filter((fact): fact is string => fact !== null)
  // Ticked or written on the device and not sent yet: said in the colour of
  // what waits, as everywhere a record has not reached the server.
  const pending = client.isPending(taskEntity, id)

  const toggle = () => {
    setTrouble(null)

    void client.update(taskEntity, id, { status: done ? 'open' : 'done' }).then((saved) => {
      if (saved.outcome === 'refused') {
        setTrouble(refusalFor(saved))
      }
    })
  }

  const office = entry === 'office'

  // A row of a card: what, then by when and for whom, red when it is
  // overdue, what it hangs on, and the one button at the right.
  return (
    <li
      className={clsx(
        'flex items-start gap-2.5 border-b border-row',
        office ? 'py-[9px]' : 'py-2.5',
      )}
    >
      <div className="min-w-0 grow">
        <div
          className={clsx(
            '[overflow-wrap:anywhere]',
            office ? 'text-[14px] font-medium' : 'text-[17px] font-semibold',
            done && 'text-ink-faint line-through',
            done && !office && 'font-normal',
          )}
        >
          {text(task, 'title')}
        </div>
        <div
          className={clsx(
            office ? 'mt-0.5 text-[13px]' : 'mt-0.5 text-[15px] leading-[1.35]',
            late ? 'text-conflict' : office ? 'text-ink-faint' : 'text-ink-muted',
          )}
        >
          {facts.join(', ')}
          {pending ? (
            <>
              {', '}
              <span className="font-semibold text-waiting">noch nicht übertragen</span>
            </>
          ) : null}
        </div>
        {maybeText(task, 'notes') ? (
          <p
            className={clsx(
              'mt-1 whitespace-pre-line text-ink',
              office ? 'text-[13px]' : 'text-[16px]',
            )}
          >
            {text(task, 'notes')}
          </p>
        ) : null}
        {target ?? null}
        {trouble ? (
          <p
            role="alert"
            className={clsx(
              'mt-1 font-semibold text-conflict',
              office ? 'text-[13px]' : 'text-[16px]',
            )}
          >
            {trouble}
          </p>
        ) : null}
      </div>
      {mayChange ? (
        <Button
          {...(office ? { size: 'small' as const } : { height: 44 as const })}
          onClick={toggle}
        >
          {done ? 'Wieder öffnen' : 'Erledigt'}
        </Button>
      ) : null}
    </li>
  )
}

export interface TaskListProps {
  readonly tasks: readonly RecordState[]
  readonly me: string | null
  readonly people: readonly TaskPerson[]
  readonly words: TaskWords
  /** Whether the person looking may change this one (`mayChangeTask`). */
  readonly mayChange: (task: RecordState) => boolean
  /** The record a task hangs on, as the application links it, where the list shows it. */
  readonly targetOf?: (task: RecordState) => ReactNode
  /** The sentence when there is none. */
  readonly empty: string
}

/** Tasks in working order, or a sentence when there are none. */
export function TaskList({ tasks, me, people, words, mayChange, targetOf, empty }: TaskListProps) {
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
        <TaskItem
          key={String(task['id'])}
          task={task}
          me={me}
          people={people}
          words={words}
          mayChange={mayChange(task)}
          target={targetOf?.(task)}
        />
      ))}
    </ul>
  )
}
