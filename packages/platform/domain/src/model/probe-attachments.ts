import { attachmentRules } from './attachment.js'

/**
 * The files of an application that belongs to nobody, for the tests of the
 * foundation: a file hangs on a shelf, on a letter, or on both, the way a
 * scan filed under a shelf is also the scan of the letter it shows.
 *
 * A test that ran green with the records of a real application would not show
 * that the mechanism knows none of them.
 */
export const probeAttachmentRules = attachmentRules({
  homes: ['shelfId', 'letterId'],
  text: {
    noHome: 'Eine Datei hängt an einem Regal oder an einem Brief, diese an keinem davon.',
    mediaType: 'Der Typ der Datei ist nicht so angegeben, wie die Ablage ihn festhält.',
  },
})
