import type { IsoDate, Synced } from './identifier.js'

/**
 * The entity a device, a route and a screen talk about a task as: the name of
 * its table, the same in every application.
 */
export const taskEntity = 'tasks'

/**
 * Open or done, and nothing in between. A task that is "in progress" says
 * nothing a person does not already know, and a third state is one more thing
 * a list has to be filtered by before it shows what is left to do.
 */
export const taskStatuses = ['open', 'done'] as const

export type TaskStatus = (typeof taskStatuses)[number]

/**
 * Something one person has to do by a day, as every application keeps it
 * (opengewerk-haustechnik#124): a text, the day, the person who answers for
 * it and whether it is done.
 *
 * What a task hangs on is the application's. One hangs it on a customer, a
 * site or a job, another on a place, an asset or an activity; each adds the
 * keys of its own records to this. A task travels to devices: it is written
 * and done where the work is, and both without a network.
 */
export interface TaskBase extends Synced {
  readonly id: string
  readonly title: string
  /** The day it has to be done by. */
  readonly dueOn: IsoDate
  /** Who answers for it: a person who works for the tenant and is not shut out. */
  readonly assigneeUserId: string
  readonly status: TaskStatus
  /**
   * Who wrote it, or null when no person did: the deadline engine writes the
   * same row as everybody else and needs no second way in. The server's to
   * write, never a device's.
   */
  readonly createdBy: string | null
}

/** What the foundation says to a task without a text, wherever it is asked. */
export const taskTitleMissing = 'Die Aufgabe braucht einen Text, der sagt, was zu tun ist.'

/**
 * What is wrong with the text of a task, or null: it says what is to be done,
 * in more than spaces, and in no more characters than the application keeps.
 * The form, the sync and the database ask the same, so that a text one of them
 * takes is taken by all three.
 */
export function taskTitleProblem(title: unknown, longest: number): string | null {
  if (typeof title !== 'string' || title.trim() === '') {
    return taskTitleMissing
  }

  return title.trim().length > longest
    ? `Der Text einer Aufgabe hat höchstens ${String(longest)} Zeichen.`
    : null
}

/** What the order of a list and the word "überfällig" look at. */
export interface TaskStanding {
  readonly id: string
  readonly status: string
  readonly dueOn: IsoDate
}

/** Open and past its day. Said in words wherever it is shown, never by colour alone. */
export function isTaskOverdue(task: TaskStanding, on: IsoDate): boolean {
  return task.status === 'open' && task.dueOn < on
}

/**
 * The order somebody works through a list in: what is open first, the one due
 * soonest at the top; what is done after it, the most recent first. The key
 * breaks a tie, so that two tasks due on the same day do not swap places
 * between two renders.
 */
export function compareTasksForWork(left: TaskStanding, right: TaskStanding): number {
  const leftOpen = left.status === 'open'
  const rightOpen = right.status === 'open'

  if (leftOpen !== rightOpen) {
    return leftOpen ? -1 : 1
  }

  const byDay = left.dueOn.localeCompare(right.dueOn)

  return (leftOpen ? byDay : -byDay) || left.id.localeCompare(right.id)
}

/**
 * Whether a person may name the one a task is for: themselves always, and
 * anybody else only with the right to hand tasks out. Whom that right reaches,
 * which people and which records, the application says.
 */
export function mayNameForTask(sender: string, assigneeUserId: string, handsOut: boolean): boolean {
  return assigneeUserId === sender || handsOut
}

/**
 * Whether a person may change a task: mark it done, open it again, or say
 * something else of it. The one it is for may, and whoever hands tasks out;
 * nobody else, also not who wrote it, once it went to somebody else.
 */
export function mayChangeTask(
  sender: string,
  task: Pick<TaskBase, 'assigneeUserId'>,
  handsOut: boolean,
): boolean {
  return task.assigneeUserId === sender || handsOut
}
