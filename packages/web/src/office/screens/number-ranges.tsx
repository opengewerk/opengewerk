import type { NumberRangeKey } from '@opengewerk/domain'
import {
  NumberRangesScreen as FoundationNumberRangesScreen,
  type NumberRangeWords,
} from '@opengewerk/platform-web/office'

/** What each sequence numbers, in the words of the office, and what the next one is. */
const about: Readonly<
  Record<NumberRangeKey, { readonly title: string; readonly covers: string; readonly next: string }>
> = {
  job: {
    title: 'Aufträge',
    covers:
      'Jeder neue Auftrag bekommt beim Anlegen die nächste Nummer, einer ohne Netz, sobald er ' +
      'übertragen ist.',
    next: 'Auftrag',
  },
  quote: {
    title: 'Angebote',
    covers: 'Angebote und Kostenvoranschläge zählen gemeinsam.',
    next: 'Beleg',
  },
  order_confirmation: {
    title: 'Auftragsbestätigungen',
    covers: '',
    next: 'Beleg',
  },
  delivery_note: { title: 'Lieferscheine', covers: '', next: 'Beleg' },
  report: { title: 'Regieberichte', covers: '', next: 'Beleg' },
  invoice: {
    title: 'Rechnungen',
    covers:
      'Alle Rechnungen, Gutschriften und Stornos zählen gemeinsam und lückenlos, wie § 14 ' +
      'UStG es verlangt.',
    next: 'Beleg',
  },
}

const words: NumberRangeWords<NumberRangeKey> = {
  sub: 'Wie Aufträge und Belege dieses Betriebs nummeriert werden.',
  explanation: (
    <>
      Im Muster steht {'{year}'} für das Jahr, in dem der Beleg ausgestellt oder der Auftrag
      angelegt wird, und {'{number}'} für die laufende Nummer; {'{number:4}'} füllt sie mit Nullen
      auf vier Stellen auf. Ein neues Muster gilt ab der nächsten Nummer, vergebene bleiben, wie sie
      sind.
    </>
  ),
  ranges: about,
  nextHeading: 'Der nächste heißt',
  saved: (key, next) => `Gespeichert. Der nächste ${about[key].next} heißt ${next}.`,
  note: 'Die nächste Nummer geht nur nach oben, etwa um die Zählung eines bisherigen Programms fortzusetzen.',
}

/**
 * How the documents of this business are numbered, the board "Nummernkreise".
 * The screen is the foundation's (opengewerk-haustechnik#127); only the owner
 * changes the sequences, like the letterhead, and the office sees the same
 * table with nothing to press.
 */
export function NumberRangesScreen() {
  return <FoundationNumberRangesScreen rights={{ write: 'settings.write' }} words={words} />
}
