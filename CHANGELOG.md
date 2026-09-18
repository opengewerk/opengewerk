# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [Semantischen Versionierung](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

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
