import { tooManyLines } from '@opengewerk/domain'
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
  // The trigger `document_lines_within_count` (0091).
  OG007: tooManyLines,
  // The triggers on defects and their steps (0119, #311).
  OG008: 'Der Mangel ist abgenommen und ändert sich nicht mehr.',
  OG009: 'Dieser Schritt folgt nicht auf den Stand des Mangels.',
  OG010:
    'Entfernen lässt sich nur ein Mangel, der noch gemeldet ist und nicht aus einer Abnahme kommt.',
  OG011: 'Ein Foto eines Mangels liegt bei den Dateien seines Auftrags oder seiner Anlage.',
  OG012: 'Wer einen Mangel gemeldet hat, wann und aus welcher Abnahme, ändert sich nicht.',
  OG013: 'Wo ein Mangel steht, ändert nur ein neuer Schritt.',
  // The trigger on the requests for an early start (0120, #292).
  OG014:
    'Ein Verlangen auf vorzeitigen Beginn gibt es nur bei einem Serviceeinsatz für einen Verbraucher.',
})
