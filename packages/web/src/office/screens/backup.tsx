import {
  BackupBar as FoundationBackupBar,
  BackupScreen as FoundationBackupScreen,
  type BackupWords,
} from '@opengewerk/platform-web/office'

const words: BackupWords = {
  how: (time) => (
    <>
      Jeden Tag um {time} Uhr sichert die Instanz die Datenbank und den Dateispeicher in ein Archiv,
      und vierzehn Generationen bleiben. War der Rechner zu dieser Zeit aus, holt sie die Sicherung
      nach, sobald er wieder läuft. Die Uhrzeit legt fest, wer die Instanz betreibt.
    </>
  ),
  elsewhere: (
    <>
      Eine Sicherung auf derselben Platte wie die Daten übersteht einen Fehler, aber keinen Ausfall
      der Platte. Wer die Instanz betreibt, legt die Archive deshalb auf eine andere Maschine, über{' '}
      <code>BACKUP_TARGET</code>; die README beschreibt, wie.
    </>
  ),
  unencrypted: (
    <>
      Das Archiv liegt unverschlüsselt, und es enthält Kundendaten und Belege. Mit einem
      öffentlichen Schlüssel in <code>BACKUP_AGE_RECIPIENT</code> wird es verschlüsselt; die README
      beschreibt, wie.
    </>
  ),
}

/**
 * The backups of the instance (#130): when the last one finished, and what an
 * owner can do when it did not. The screen is the foundation's
 * (opengewerk-haustechnik#127).
 */
export function BackupScreen() {
  return <FoundationBackupScreen words={words} />
}

/** The line at the top of the office when the backups are behind, for whoever reads the settings. */
export function BackupBar() {
  return <FoundationBackupBar right="settings.read" />
}
