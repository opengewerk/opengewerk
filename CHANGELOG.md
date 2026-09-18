# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [Semantischen Versionierung](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

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

- Gedankenstriche in der Feature-Gliederung und in den ADRs durch Doppelpunkt,
  Komma, Semikolon oder Punkt ersetzt, Zahlenbereiche durch einfache Bindestriche
- Übrig gebliebene Kopie der alten Roadmap-Tabelle aus der Feature-Gliederung
  entfernt, sie stand ohne Überschrift und mit unvollständiger Kopfzeile unter
  der neuen Tabelle
