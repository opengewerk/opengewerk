import type { RecordState } from '@opengewerk/domain'
import clsx from 'clsx'
import { useMemo } from 'react'

import { useEntry } from '../components/index.js'
import { text } from '../sync/fields.js'
import { useRelated, useSync } from '../sync/provider.js'
import { NotSent } from '../site/kit.js'
import { date, today } from './format.js'
import { usePeople } from './tasks.js'
import { clockOf } from './time.js'
import { useWho } from './who.js'

/**
 * The notes from the site about a job (#220), the newest first, for both
 * entries: written on site, read there and in the office at the job.
 */
export function useJobNotes(jobId: string): readonly RecordState[] {
  const notes = useRelated('job_notes', 'jobId', jobId)

  return useMemo(
    () =>
      [...notes].sort(
        (left, right) =>
          text(right, 'writtenAt').localeCompare(text(left, 'writtenAt')) ||
          String(right['id']).localeCompare(String(left['id'])),
      ),
    [notes],
  )
}

/**
 * When a note was written, as the boards say it: "heute 10:42" for today,
 * "18.09.2026, 08:15" for any other day, both in German time.
 */
export function noteMoment(writtenAt: string, now: Date = new Date()): string {
  const day = today(new Date(writtenAt))

  return day === today(now) ? `heute ${clockOf(writtenAt)}` : `${date(day)}, ${clockOf(writtenAt)}`
}

/**
 * The notes of a job as a list, `note_entry()` of the board "Auftrag, ganze
 * Seite" on site and the card "Notizen von der Baustelle" in the office: what
 * was written, and under it who wrote it when.
 *
 * Who wrote it is a name from the list of the business. A note written on
 * this device and not sent yet has no author on it yet, since the server
 * writes it; it is the person looking, who wrote it a moment ago.
 */
export function JobNoteList({
  notes,
  label = 'Notizen',
}: {
  readonly notes: readonly RecordState[]
  readonly label?: string
}) {
  const client = useSync()
  const site = useEntry() === 'site'
  const { me, people } = usePeople()
  const who = useWho()

  function author(note: RecordState): string {
    const userId = note['createdBy']

    if (typeof userId !== 'string' || userId === me) {
      return who.name || 'Sie'
    }

    return people.find((person) => person.userId === userId)?.name ?? 'Jemand aus dem Betrieb'
  }

  return (
    <ul aria-label={label} className="flex flex-col">
      {notes.map((note) => {
        const id = String(note['id'])

        return (
          <li key={id} className={clsx('border-b border-row', site ? 'py-[9px]' : 'py-2')}>
            <p
              className={clsx(
                'leading-[1.45] whitespace-pre-line [overflow-wrap:anywhere]',
                site ? 'text-[17px]' : 'text-[14px]',
              )}
            >
              {text(note, 'text')}
            </p>
            <p
              className={clsx(
                'numeric',
                site ? 'mt-[3px] text-[15px] text-ink-muted' : 'mt-0.5 text-[13px] text-ink-faint',
              )}
            >
              {`${author(note)}, ${noteMoment(text(note, 'writtenAt'))}`}
              {client.isPending('job_notes', id) ? (
                <>
                  {', '}
                  <NotSent />
                </>
              ) : null}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
