import { taskEntity, taskTitleProblem } from '@opengewerk/platform-domain'

import { today } from '../format.js'
import type { Draft, EditResult } from '../sync/client.js'
import { useSync } from '../sync/provider.js'
import { asTextOrNull, RecordForm } from '../sync/record-form.js'
import type { FormField } from '../sync/record-form.js'
import type { TaskPerson, TaskWords } from './task-list.js'

/** A choice of a select, as a form offers it. */
interface Choice {
  readonly value: string
  readonly label: string
}

/**
 * A field of the application that says what a new task hangs on, where the
 * screen does not say it already: the list of all tasks asks, the card at a
 * record does not.
 */
export interface NewTaskPlace {
  readonly field: FormField
  /** What the chosen value writes into the task: the keys of the records it names. */
  readonly linksOf: (value: string) => Draft
}

export interface NewTaskFormProps {
  /** What the task hangs on as the screen says it: the keys of the application's records. */
  readonly links?: Draft
  /** What it hangs on as the person chooses it, where the screen does not say. */
  readonly place?: NewTaskPlace
  /** Who is writing it. Until that is known the form waits. */
  readonly me: string | null
  /** The name of who is writing it, where it is known. */
  readonly myName?: string | null
  /**
   * The other people it may go to, for what is filled in so far: none for
   * somebody who may not hand tasks out, and for whoever may, those the
   * application lets it reach from the chosen record.
   */
  readonly others: (values: Readonly<Record<string, string>>) => readonly TaskPerson[]
  readonly words: TaskWords
  /** The most characters the application keeps of its text. */
  readonly longest: number
  /** The fields in one row, as the list of the office draws the card "Neue Aufgabe". */
  readonly wide?: boolean
  /** Called once the task is kept, and when somebody backs out. */
  readonly onDone: () => void
}

/**
 * Writing a task down, wherever somebody happens to be.
 *
 * It hangs on whatever screen it was written on, or on what the person
 * chooses, and asks for nothing of that again. The person defaults to whoever
 * writes it, which is the common case on site: something to remember for
 * oneself. Others are offered as the application says; without a connection
 * there is usually only oneself to choose, and the task still gets written,
 * through the outbox like any record a device makes.
 */
export function NewTaskForm({
  links = {},
  place,
  me,
  myName,
  others,
  words,
  longest,
  wide = false,
  onDone,
}: NewTaskFormProps) {
  const client = useSync()

  // The form takes its starting values once, when it appears. Shown before it
  // is known who is writing, it would start without a person and keep that.
  if (me === null) {
    return <p className="text-body text-ink-muted">Einen Moment, die Anmeldung wird gelesen.</p>
  }

  const self: Choice = {
    value: me,
    label: myName ? `${myName} (${words.you})` : words.you,
  }
  const choicesFor = (values: Readonly<Record<string, string>>): readonly Choice[] => [
    self,
    ...others(values)
      .filter((person) => person.userId !== me)
      .map((person) => ({ value: person.userId, label: person.name }))
      .sort((left, right) => left.label.localeCompare(right.label, 'de')),
  ]
  const fields: FormField[] = [
    { name: 'title', label: 'Was zu tun ist', required: true },
    { name: 'dueOn', label: 'Fällig am', kind: 'date', required: true },
    {
      name: 'assigneeUserId',
      label: 'Verantwortlich',
      required: true,
      optionsFor: choicesFor,
    },
    ...(place ? [place.field] : []),
  ]

  return (
    <RecordForm
      fields={fields}
      record={{ dueOn: today(), assigneeUserId: me }}
      submitLabel="Aufgabe anlegen"
      {...(wide
        ? {
            columns: place
              ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.8fr)]'
              : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)]',
            divided: false,
          }
        : {})}
      onCancel={onDone}
      check={(values) => taskTitleProblem(values['title'], longest)}
      onSubmit={async (values): Promise<EditResult> => {
        const made = await client.create(taskEntity, {
          title: asTextOrNull(values['title']),
          dueOn: values['dueOn'] ?? today(),
          assigneeUserId: values['assigneeUserId'] ?? me,
          status: 'open',
          ...links,
          ...(place ? place.linksOf(values[place.field.name] ?? '') : {}),
        })

        if (made.outcome === 'queued') {
          onDone()
        }

        return made
      }}
    />
  )
}
