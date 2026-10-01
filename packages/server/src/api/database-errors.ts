import { databaseErrors } from '@opengewerk/platform-server'

/**
 * The translation of a refusal of the database into an answer is the
 * foundation's (ADR 0010). This application adds the classes its own triggers
 * raise, where the call was well formed and the state of the data is what
 * refuses it: an issued document is past the point where it could still be
 * changed.
 *
 * The message travels back with them, which is safe here and useful: these are
 * our own sentences, written for the person about to learn that a document is
 * corrected rather than edited.
 */
export const { answerFor, DatabaseExceptionFilter } = databaseErrors({
  OG001: 'Der Beleg ist festgeschrieben.',
})
