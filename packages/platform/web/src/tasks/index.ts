// The tasks, as an entry of their own: `@opengewerk/platform-web/tasks`.
//
// What both entries of an application share about a task: a row of a list,
// the list in the order somebody works through it, and the form for a new
// one. What a task hangs on, who may hand one out and how the application
// addresses the person looking are handed in; the rules are the ones its sync
// asks as well (`mayChangeTask`, `mayNameForTask`, `taskTitleProblem`).

export { NewTaskForm } from './new-task-form.js'
export type { NewTaskFormProps, NewTaskPlace } from './new-task-form.js'
export {
  inWorkingOrder,
  overdue,
  responsibleFor,
  TaskItem,
  TaskList,
  TaskTarget,
} from './task-list.js'
export type { TaskItemProps, TaskListProps, TaskPerson, TaskWords } from './task-list.js'
