import type { JobId, JobNoteId, Synced } from './identifier.js'

/** The most a note may say, as much as a text in a form (#78). */
export const longestJobNote = 4000

/**
 * A note from the site about a job (#220): what happened, written by the
 * person who was there, at the time they wrote it.
 *
 * A note is an entry of its own and never the description of the job. The
 * description is what the office put down as the job, and the site does not
 * rewrite it; until #220 the only way to write down what happened on site was
 * to write over it, and the office then found the note where the job had
 * been. The office reads the notes at the job.
 *
 * Written once and never changed, like a time entry: a note that turns out
 * wrong is followed by one that says so. Who wrote it, the database writes
 * from the request, so nobody writes a note under somebody else's name. When
 * it was written comes from the device, because a note written in a cellar at
 * ten reaches the server at four, and ten is what the note is about.
 */
export interface JobNote extends Synced {
  readonly id: JobNoteId
  readonly jobId: JobId
  readonly text: string
  /** When it was written, by the clock of the device it was written on. */
  readonly writtenAt: Date
  /** Who wrote it, from the request; null only for a note no person wrote. */
  readonly createdBy: string | null
}

/** What is wrong with the text of a note, as the sentence the form shows, or null. */
export function jobNoteProblem(text: unknown): string | null {
  if (typeof text !== 'string' || text.trim() === '') {
    return 'Eine Notiz braucht einen Text.'
  }

  if (text.length > longestJobNote) {
    return `Eine Notiz hat höchstens ${String(longestJobNote)} Zeichen.`
  }

  return null
}

/**
 * What is wrong with the time a note was written, or null: a moment the
 * device could have read off its clock. Not compared with the server's own
 * time; a clock that is off by some minutes writes a note that is off by as
 * many, which is what the person holding the device saw.
 */
export function noteTimeProblem(writtenAt: unknown): string | null {
  const moment =
    writtenAt instanceof Date
      ? writtenAt
      : typeof writtenAt === 'string'
        ? new Date(writtenAt)
        : null

  return moment && !Number.isNaN(moment.getTime())
    ? null
    : 'Eine Notiz braucht die Uhrzeit, zu der sie geschrieben wurde.'
}
