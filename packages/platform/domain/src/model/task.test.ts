import { describe, expect, it } from 'vitest'

import {
  compareTasksForWork,
  isTaskOverdue,
  mayChangeTask,
  mayNameForTask,
  taskTitleMissing,
  taskTitleProblem,
} from './task.js'

describe('the text of a task', () => {
  it('says what is to be done, in more than spaces', () => {
    expect(taskTitleProblem('Schlüssel hinterlegen', 200)).toBeNull()
    expect(taskTitleProblem('', 200)).toBe(taskTitleMissing)
    expect(taskTitleProblem('   ', 200)).toBe(taskTitleMissing)
    expect(taskTitleProblem(null, 200)).toBe(taskTitleMissing)
    expect(taskTitleProblem(7, 200)).toBe(taskTitleMissing)
  })

  it('is no longer than the application keeps, counted without the spaces around it', () => {
    expect(taskTitleProblem(`  ${'a'.repeat(10)}  `, 10)).toBeNull()
    expect(taskTitleProblem('a'.repeat(11), 10)).toBe(
      'Der Text einer Aufgabe hat höchstens 10 Zeichen.',
    )
  })
})

describe('a task past its day', () => {
  it('is overdue while it is open, and not on the day itself', () => {
    expect(isTaskOverdue({ id: 'a', status: 'open', dueOn: '2026-10-10' }, '2026-10-11')).toBe(true)
    expect(isTaskOverdue({ id: 'a', status: 'open', dueOn: '2026-10-11' }, '2026-10-11')).toBe(
      false,
    )
    expect(isTaskOverdue({ id: 'a', status: 'done', dueOn: '2026-10-10' }, '2026-10-11')).toBe(
      false,
    )
  })
})

describe('the order of a list of tasks', () => {
  it('puts the open first, soonest at the top, then the done, the latest first', () => {
    const tasks = [
      { id: 'd1', status: 'done', dueOn: '2026-10-01' },
      { id: 'o2', status: 'open', dueOn: '2026-10-20' },
      { id: 'd2', status: 'done', dueOn: '2026-10-05' },
      { id: 'o1', status: 'open', dueOn: '2026-10-12' },
      { id: 'o0', status: 'open', dueOn: '2026-10-12' },
    ]

    expect([...tasks].sort(compareTasksForWork).map((task) => task.id)).toEqual([
      'o0',
      'o1',
      'o2',
      'd2',
      'd1',
    ])
  })
})

describe('who a task may name and who may change it', () => {
  it('lets anybody name themselves, and somebody else only who hands tasks out', () => {
    expect(mayNameForTask('ana', 'ana', false)).toBe(true)
    expect(mayNameForTask('ana', 'ben', false)).toBe(false)
    expect(mayNameForTask('ana', 'ben', true)).toBe(true)
  })

  it('lets the one it is for change it, and whoever hands tasks out', () => {
    expect(mayChangeTask('ana', { assigneeUserId: 'ana' }, false)).toBe(true)
    expect(mayChangeTask('ana', { assigneeUserId: 'ben' }, false)).toBe(false)
    expect(mayChangeTask('ana', { assigneeUserId: 'ben' }, true)).toBe(true)
  })
})
