# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [Semantischen Versionierung](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- Der Discord-Server ist in der README verlinkt. Er ist für kurze Fragen gedacht und
  nicht als Ersatz für die Discussions: ein Chatverlauf ist nicht durchsuchbar

- Ein Update ist zwei Aufrufe: erst `docker compose run --rm --build migrate`, dann
  `docker compose up -d`. Die Reihenfolge ist keine Vorliebe. `up` allein erzeugt jeden
  Container mit geändertem Abbild neu, bevor es irgendeinen startet, der laufende
  Anwendungscontainer ist also schon weg, wenn die Migration anfängt. Schlägt sie dann
  fehl, steht die Instanz still statt weiterzulaufen. Nachgemessen am 19.09.2026
- Alle ausstehenden Migrationen laufen in einer einzigen Transaktion. Scheitert die
  dritte von drei, steht die Datenbank auf dem Stand davor und nicht irgendwo dazwischen.
  Der Preis ist, dass eine Migration nichts enthalten darf, was außerhalb einer
  Transaktion laufen muss; ein Test hält das fest
- Der Migrationslauf prüft die Hashes der bereits eingespielten Migrationen gegen die
  Dateien im Abbild und lehnt ab, wenn eine geändert wurde. Ohne diese Prüfung passiert
  schlicht nichts: drizzle vergleicht nur Zeitstempel, überspringt die geänderte Datei
  und meldet Erfolg. Gegengeprüft, die Tabelle blieb ungebaut und der Lauf sagte kein Wort
- Nach dem Lauf wird nachgesehen, ob wirklich alles eingespielt wurde. Eine Migration mit
  einem Zeitstempel vor dem der zuletzt eingespielten wird sonst stillschweigend
  übergangen, und das ist genau das, was zwei in der falschen Reihenfolge gemergte
  Branches hinterlassen
- Ein Abbild, das älter ist als die Datenbank, wird abgelehnt statt ausgeführt. Es kennt
  die Spalten nicht, die der neuere Stand angelegt hat
- Acht Tests für den Update-Pfad, darunter der Sprung von einem älteren Stand mit Daten
  über zwei Migrationen hinweg: Bestand, Spaltenvorgaben und Audit-Kette müssen danach
  unverändert sein, und die Kette muss von ihrem alten Kopf aus weiterlaufen
- Ein CI-Job fährt dasselbe mit Containern: ältere Fassung starten, Daten anlegen,
  aktualisieren, vergleichen, danach eine fehlerhafte Migration einsetzen und prüfen, dass
  der Aufruf abbricht, die Instanz weiterläuft und die Datenbank unberührt bleibt

- Sicherung und Rückspielen als Skripte, nicht als Anleitung. Ein Lauf schreibt
  Datenbank, Dateispeicher und die Köpfe der Audit-Ketten in ein Archiv, ein zweiter
  spielt es zurück und prüft danach nach, ob alles zurückgekommen ist
- Die Reihenfolge im Sicherungslauf ist Datenbank zuerst, Dateien danach. Andersherum
  hätte alles, was zwischen beiden Schritten hochgeladen wird, eine Zeile im Dump und
  keine Datei im Archiv, also einen Beleg, der auf nichts zeigt
- Drei Prüfungen nach dem Rückspielen: das Manifest gegen eine beschädigte Sicherung,
  bevor die Datenbank angefasst wird; die Dateinamen gegen den Hash ihres Inhalts, was
  ein inhaltsadressierter Speicher allein beantworten kann; die Audit-Ketten gegen die
  Sicherung
- `verify.sh` hält das Audit-Log einer laufenden Instanz gegen die Köpfe aus einer
  Sicherung, ohne etwas zurückzuspielen. Das ist die eine Prüfung, die die Kette in der
  Datenbank nicht an sich selbst vornehmen kann: wer den Trigger abschalten kann,
  rechnet die Kette nach einer Fälschung neu, und sie geht wieder auf. Gegengeprüft, die
  Prüfung in der Datenbank meldet danach "gebrochen bei: nirgends" und die gegen die
  Sicherung nennt den Mandanten
- Verschlüsselung der Archive über age mit einem öffentlichen Schlüssel. Die Maschine,
  die sichert, kann damit ihre eigenen älteren Sicherungen nicht lesen
- Aufbewahrung über `BACKUP_KEEP`, Ziel über `BACKUP_TARGET`, beides in der `.env`
- Der Dateispeicher aus ADR 0007 als eigenes Volume, und die Anwendung startet nicht,
  wenn sie nicht hineinschreiben kann. Ein falscher Mount sieht sonst genauso aus wie
  eine laufende Instanz, bis das erste Foto verloren geht
- Ein CI-Job, der den ganzen Weg fährt: Daten anlegen, sichern, beide Datenvolumes
  löschen, in die leere Instanz zurückspielen, Bestand und Audit-Ketten vergleichen und
  zuletzt prüfen, dass eine beschädigte Sicherung abgelehnt wird

- Betrieb über Docker Compose: ein Aufruf auf einer leeren Maschine liefert eine
  erreichbare Instanz mit migrierter Datenbank. Drei Dienste, dazu ein Migrationslauf,
  der sich vor jedem Start als Eigentümer der Tabellen anmeldet und danach beendet
- Ein Einstiegspunkt, der den Server startet, mit einer Identitätsquelle, die niemanden
  erkennt. Jede Route hinter dem Guard antwortet damit mit 401, und eine Instanz lässt
  sich betreiben, migrieren und messen, bevor es eine Anmeldung gibt. Der Notbehelf, der
  beim Bau der Rechte verworfen wurde, hätte jeden hereingelassen; dieser lässt keinen
  herein
- Ein Health-Endpunkt, der die Datenbank einbezieht: 200, solange sie antwortet, sonst
  503. Ein Server, dessen Datenbank weg ist, nimmt weiter Verbindungen an und scheitert
  an jeder Anfrage, und das als gesund zu melden machte aus einem lauten Ausfall einen
  leisen
- Eine Prüfung der Verbindungsadresse beim Start, die zwei Fehler abfängt, bevor sie
  teuer werden: eine Anwendung, die sich als Eigentümer der Tabellen oder als Superuser
  anmeldet, bekäme eine Mandantentrennung, die aussieht wie eine und keine ist. Und ein
  Passwort mit `/` oder `@` darin teilt die Adresse an der falschen Stelle, was als
  Namensauflösung für einen Rechner scheitert, den niemand gemeint hat
- Die Anbindung an den Renderer nach ADR 0007, gekapselt als `renderPdf(html)`. Fehlt der
  Dienst oder antwortet er nicht, kommt eine Meldung mit dem Befehl, der ihn startet,
  statt eines Absturzes. Antwortet er mit einer Ablehnung, ist das ein anderer Fehler,
  weil dann das Dokument falsch ist und nicht die Installation
- Ein Build über alle Pakete, damit es etwas zum Ausliefern gibt, und ein Abbild in zwei
  Stufen: gebaut mit allen Werkzeugen, ausgeliefert ohne sie, ohne Zugangsdaten, unter
  einem Benutzer ohne Rechte und mit einer eigenen Gesundheitsprüfung
- Ein CI-Job, der den Stapel so startet, wie eine Installation es tut, und prüft, dass
  die Instanz antwortet, dass sie ohne Anmeldung jede Datenroute ablehnt und dass keine
  einzige Tabelle ohne Row-Level Security dasteht

- Regel-Engine: gesetzliche Parameter als Datensätze in Regelpaketen mit
  Gültigkeitszeitraum und Fundstelle, nicht im Quelltext. Umsatzsteuersätze,
  Kleinunternehmergrenzen, Verzugsregeln und der Basiszinssatz
- Jede Abfrage braucht einen Tag, und es gibt keinen Weg, ohne einen zu fragen. Das
  trägt die historische Anwendung: ein Beleg von 2027 wird auch 2030 nach den Regeln
  von 2027 beurteilt
- Gerechnet wird in Basispunkten und Cent, also in ganzen Zahlen, und gerundet an genau
  einer Stelle, kaufmännisch und von der Null weg
- Wo keine Regel hinterlegt ist, gibt es keine Antwort statt einer erfundenen. Die
  Pakete sagen in sich selbst, bis wann sie reichen
- Mandantenbezogene Parameter davon getrennt, in der Datenbank und ebenfalls mit
  Gültigkeitszeitraum. Sie werden nicht geändert, sondern ab einem Tag abgelöst, und
  kein Schlüssel darin kann eine gesetzliche Größe verschieben
- Eine Strukturprüfung, die die Sync-Spalten gegen die Abgleichregeln in `domain` hält:
  eine Tabelle, die in einem von beiden fehlt, macht sie rot
- Offline-Datenschicht: Vorgänge mit Feld, altem und neuem Wert, die ein Gerät sammelt und
  der Reihe nach schickt. Der Server vergleicht, was das Gerät gesehen hat, mit dem, was
  dasteht, und lässt durch, was niemand sonst angefasst hat
- Konflikte landen in einer Liste mit drei Bildern nebeneinander, statt still aufgelöst zu
  werden. Ein Vorgang wirkt ganz oder gar nicht
- Konfliktregeln je Entität in `domain`: Stammdaten dürfen offline angelegt, aber nicht
  geändert werden, ein Beleg nur solange er Entwurf ist, festgeschrieben wird nur online
- Dieselbe Übertragung zweimal erzeugt keinen zweiten Datensatz. Jeder Vorgang hat eine
  Kennung vom Gerät, und der Server quittiert jede, die er gesehen hat
- Soft-Delete auf allen abgeglichenen Tabellen. Eine entfernte Zeile wäre eine, von der
  ein Gerät, das offline war, nie wieder etwas hört
- Sync-Spalten auf jeder abgeglichenen Tabelle, gepflegt von einem Trigger: Version, wer
  zuletzt geschrieben hat, von welchem Gerät, und die Änderungsnummer, die den Stand für
  den nächsten Abgleich trägt
- Ein Stolperdraht auf die Spalten des Audit-Logs. Gemessen: eine einzige neue Spalte lässt
  die ganze Hashkette ab Eintrag 1 als manipuliert gelten, weil über die ganze Zeile
  gehasht wird
- Hashkette über dem Audit-Log: jeder Eintrag trägt den Hash seines Vorgängers, eine
  nachträgliche Änderung ist damit nicht nur verboten, sondern sichtbar. Eine Prüfung
  läuft die Kette eines Mandanten ab und nennt die erste Stelle, an der es nicht mehr
  aufgeht
- Gehasht wird die ganze Zeile ohne ihren eigenen Hash, eine später hinzugefügte Spalte
  ist damit automatisch abgedeckt. Die Zeitzone steht dabei fest auf UTC, sonst hashte
  derselbe Eintrag in Berlin anders als in Sydney und eine heile Kette sähe unterwegs
  kaputt aus
- Die Testdatenbank läuft unter einem Eigentümer ohne Superuser-Rechte. Vorher galt
  Row-Level Security für den Eigentümer der Tabellen nie, der Teil des Entwurfs, der nur
  für ihn gilt, war damit ungetestet
- Audit-Log auf Feldebene: eine Zeile je geändertem Feld mit altem Wert, neuem Wert,
  Zeitpunkt, Benutzer und Anlass. Geschrieben von einem Trigger an jeder Tabelle, damit
  auch eine Änderung im Log steht, die nicht über die Anwendung kommt. Der Benutzer bleibt
  dann leer, und die Datenbankrolle daneben sagt, woher die Änderung kam
- Das Log wird nur ergänzt. Ändern, Löschen und Leeren sind durch einen eigenen Trigger
  versperrt, auch für den Eigentümer der Tabelle, und die Anwendungsrolle hat darauf nur
  Leserecht
- Ein Test, der für jede Tabelle am Katalog prüft, dass der Trigger hängt. Eine Tabelle aus
  einer späteren Migration ohne Trigger macht ihn rot
- Nummernkreise je Mandant und Belegart, vergeben beim Festschreiben. Der Zähler steht in
  einer Tabellenzeile statt in einer Sequenz, damit ein Abbruch die Nummer wieder mitnimmt
  und keine Lücke bleibt. Alle Rechnungsarten teilen einen Kreis, Storno eingeschlossen
- Ein Trigger, der festgeschriebene Belege unveränderlich macht. Erlaubt bleibt nur der
  Wechsel auf storniert, und auch der nur, wenn sich sonst nichts ändert. Löschen gibt es
  nicht
- Vorschau der nächsten Belegnummer über dieselbe Funktion in `domain`, die auch die
  endgültige Nummer baut
- Rollen und Rechte: Inhaber, Büro und Monteur mit Rechten entlang der Aktion. Getrennt
  sind vor allem `document.write` und `document.issue`, weil ein Monteur den Regiebericht
  schreibt und das Büro ihn festschreibt
- Erste HTTP-Schicht auf NestJS mit den schreibenden Routen für Kunde, Objekt, Anlage,
  Auftrag und Beleg. Die Rechteprüfung läuft über einen global registrierten Guard, eine
  Route ohne Rechteangabe wird abgelehnt statt durchgewunken
- Ein Test, der alle registrierten Routen aufzählt und jede ohne Rechteangabe meldet. Die
  Controller kommen aus dem Modul selbst, ein neuer ist damit automatisch dabei
- Mandantentrennung: Row-Level Security auf allen 14 Tabellen, erzwungen auch gegenüber
  dem Tabelleneigentümer, dazu eine eigene Anwendungsrolle ohne Superuser-Rechte. Der
  Mandant wird an genau einer Stelle gesetzt, in `Database.forTenant()`, und gilt nur
  innerhalb der Transaktion
- Ein Test, der für jede Tabelle prüft, dass Row-Level Security aktiviert und erzwungen
  ist, eine Policy existiert und die Anwendungsrolle Rechte hat. Damit fällt eine Tabelle
  auf, die in einer späteren Migration eines davon vergisst
- Datenmodell-Kern: Mandant, Kunde, Ansprechpartner, Objekt, Anlage, Auftrag und Beleg,
  dazu die Elektro-Struktur unter der Anlage (Verteiler, Feld, Stromkreis, Betriebsmittel)
  und die PV-Struktur (Wechselrichter, String, Module). Schlüssel sind UUIDv7, erzeugt von
  PostgreSQL 18 oder vom Client, damit auf der Baustelle ohne Netz Datensätze entstehen
  können
- Erste Migration als SQL-Datei, dazu eine Rücknahme von Hand unter `migrations/down/`.
  Ein Test fährt beide Richtungen gegen eine echte PostgreSQL 18 und prüft, dass danach
  keine Tabelle und kein Typ übrig bleibt
- Die Typen des Datenmodells liegen in `domain`, die Ablage in `server`, und der Compiler
  hält beide Seiten deckungsgleich: eine Spalte, die nur auf einer Seite auftaucht, lässt
  die Typprüfung scheitern
- Monorepo-Gerüst nach ADR 0009: pnpm Workspaces mit Turborepo, die Pakete `domain`,
  `server` und `web`, ein gemeinsames `tsconfig.base.json`, ESLint mit Flat Config,
  Prettier und Vitest mit fast-check. `domain` ist ohne Node- und DOM-Typen
  konfiguriert, ein Zugriff auf `fs` oder das `document` ist dort ein Typfehler
- Vier CI-Schritte für den Code: installieren, Typprüfung, Lint, Test. Die Prüfungen
  auf Kodierung und Schreibweise laufen unverändert weiter
- Test, der die Dekorator-Metadaten absichert, an denen NestJS seine Abhängigkeiten
  erkennt. TypeScript 7 ist die native Neuimplementierung des Compilers, und ein
  Versionssprung, der die Metadaten verliert, soll die CI rot machen statt den
  Container beim Start
- ADR 0009 zu Werkzeugen und Repo-Struktur: pnpm Workspaces mit Turborepo, Node 24,
  TypeScript 7, Vitest mit fast-check für die Property-based Tests aus 4.8, ESLint mit
  Flat Config und Prettier, PostgreSQL 18. Schließt die drei offenen Enden aus ADR 0002
  (Paketmanager, Node-Version, endgültige Paketliste ohne `mobile-pwa`), ohne dessen
  Text umzuschreiben
- Initiales Repository-Gerüst
- Feature-Gliederung v2.3 mit Regel-Engine, Anlagenstruktur, Finance-Absicherung
  und einer auf ein MVP geschnittenen Roadmap
- ADR 0002 bis 0008 als Entscheidungsvorlagen für den Tech-Stack
- CI-Job "Schreibweise", der Gedankenstriche im gesamten Repository meldet

### Geändert

- Die Roadmap steht nur noch in Abschnitt 10 der Feature-Gliederung. Die Abschrift in
  der README war die Fassung aus v2.2: der Umschnitt auf den MVP-Fahrplan in v2.3 kam
  dort nie an, die Zeilen für Phase 0, 1, 2 und 4 waren zeichengleich mit dem
  Archivstand, Phase 1b fehlte ganz. Für Phase 0 nannte sie eine Fristen- und eine
  Formular-Engine, die dort nicht hingehören, und ließ die Regel-Engine weg, die
  dazugehört. An ihrer Stelle steht jetzt ein Verweis, weil eine Kopie driftet

- Der Mountpunkt des Dateispeichers gehört im Abbild dem Benutzer `node`. Docker
  übernimmt Eigentümer und Rechte eines vorhandenen Verzeichnisses in ein neues Volume,
  und ein Volume, das aus dem Nichts entsteht, gehört `root`. Die Anwendung läuft nicht
  als `root`, konnte also nicht hineinschreiben

- Die beiden Compose-Dateien und das Dockerfile folgen der Regel "Code ist immer
  Englisch": Kommentare englisch, deutsch bleibt, was ein Mensch im Betrieb als Meldung
  liest. `compose.test.yaml` sagte außerdem noch, die Datei für den Betrieb komme mit
  einem eigenen Issue, und das stimmt seit diesem Stand nicht mehr
- `@opengewerk/domain` wird gebaut statt aus dem Quelltext geladen. Ein Container kann
  kein TypeScript ausführen, solange NestJS an den Dekorator-Metadaten hängt, und die
  bringt das eingebaute Ausführen von TypeScript in Node nicht mit

- Feature-Gliederung auf v2.5: Leitentscheidung 7 sagt jetzt, dass Fragen über
  Zusammenhänge zuerst als Abfrage über Datenmodell, Regel- und Fristen-Engine gebaut
  werden und KI nur den Rest übernimmt, ohne je direkt zu schreiben. Dazu die
  Klarstellung in Abschnitt 6, dass die REST-API für Drittanbieter ein eigener Vertrag
  wird und nicht der gedehnte Kanzlei-Vertrag
- Feature-Gliederung auf v2.4: neue Leitentscheidung 9 zur Positionierung. OpenGewerk
  ist nicht die kostenlose Alternative, sondern die Software ohne künstlich beschränkte
  Funktionen. Dazu drei Festlegungen, die das tragen müssen: Einnahmen aus
  Dienstleistungen neben der Software, keine proprietären Erweiterungen auch durch das
  Projekt selbst, kein Contributor License Agreement
- Die Workflow-Dateien folgen der Regel "Code ist immer Englisch": Job-Kennungen,
  Variablen und Kommentare in den eingebetteten Skripten sind englisch. Deutsch bleibt,
  was ein Mensch liest, also die Job- und Schrittnamen in der Actions-Oberfläche und die
  Meldungen, die eine Prüfung ausgibt
- CodeQL ermittelt die zu prüfenden Sprachen aus dem Dateibestand, statt sie in einer
  Liste zu führen. Dort stand bisher nur `actions`, mit einer Notiz, sie beim ersten
  Code zu ergänzen. Wer den ersten TypeScript-Code einspielt, denkt aber nicht an diese
  Datei und hätte danach ein Scanning, das nichts scannt
- ADR 0002 bis 0008 entschieden und auf `angenommen` gesetzt. Der Tech-Stack steht:
  TypeScript mit NestJS, PostgreSQL mit Row-Level Security und Drizzle, React mit Vite
  als eine PWA, eigene Outbox für den Offline-Sync, eingebaute Auth über better-auth,
  inhaltsadressierter Dateispeicher mit PDF-Erzeugung in einem eigenen Container,
  Gewerke als Datenpakete

### Behoben

- Eine Änderung an einem gelöschten Datensatz wird im Abgleich zum Konflikt und nicht
  mehr angewendet. Weil nichts wirklich entfernt wird, findet der Abgleich die Zeile
  weiterhin, quittierte die Änderung mit "angewendet" und schrieb sie auf einen
  Datensatz, den keine Liste mehr zeigt. Ein wiederholtes Löschen zählt dabei als
  übersprungen: eine doppelt gesendete Warteschlange ist keine Meinungsverschiedenheit
- Ein Löschen über den Abgleich kollidiert mit einer Änderung, die inzwischen jemand
  anders gemacht hat. Es trägt keine Feld-Patches, der Feldvergleich lief also ins Leere
  und jedes Löschen ging durch. Maßgeblich ist jetzt die Basisversion
- `deletedAt` steht in der Liste der Spalten, die nur der Server schreibt. Als
  gewöhnliches Feld gesetzt wäre es ein Löschen an der Löschregel vorbei, auf null
  zurückgesetzt eine Wiederherstellung, die niemand veranlasst hat
- Belege können über den Abgleich nicht mehr festgeschrieben werden. `status`, `number`
  und `issuedAt` sind dem Server vorbehalten, die Prüfung sitzt in der
  Merge-Entscheidung und ein zweites Mal vor dem Schreiben. Über `POST /sync` genügte
  `document.write`, und der Trigger hält nur `UPDATE` und `DELETE` auf, beim Anlegen ist
  er nicht beteiligt
- Gedankenstriche in der Feature-Gliederung und in den ADRs durch Doppelpunkt,
  Komma, Semikolon oder Punkt ersetzt, Zahlenbereiche durch einfache Bindestriche
- Übrig gebliebene Kopie der alten Roadmap-Tabelle aus der Feature-Gliederung
  entfernt, sie stand ohne Überschrift und mit unvollständiger Kopfzeile unter
  der neuen Tabelle
