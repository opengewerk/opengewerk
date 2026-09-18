<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo-dark.svg">
    <img alt="OpenGewerk" src="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo.svg" width="420">
  </picture>
</p>

<p align="center"><strong>Self-hosted CRM &amp; ERP für Handwerksbetriebe</strong></p>

## Was ist OpenGewerk?

OpenGewerk führt CRM und ERP in einem einzigen Datenmodell zusammen: Kunde, Objekt, Anlage, Auftrag, Beleg, Buchung. Es gibt keine Duplikate und keine Schnittstellen zwischen Modulen, weil es keine getrennten Module gibt. Kernmodul ist Elektro und PV, alle weiteren Gewerke entstehen als Plugins auf derselben Formular- und Fristen-Engine. Die Baustellen-App arbeitet offline-first, denn im Keller, am Zählerschrank und auf dem Dachboden liegt kein Netz. GoBD ist Bauprinzip statt Nachrüstung: Belege werden festgeschrieben und nie gelöscht, sondern storniert. Die Buchhaltung wächst gestaffelt von Belegen über das Journal bis zu EÜR, USt-Voranmeldung, Anlagenbuchhaltung und Bilanz, und KI-Funktionen bleiben optional über selbst gehostete Modelle.

## Warum OpenGewerk?

Die wichtigsten Punkte aus dem Vergleich mit openHandwerk, plancraft, HERO, TAIFUN/STREIT, sevdesk/Lexware und Odoo/SAP FSM/Dynamics:

| Schwäche in Vergleichssystemen | Unser Ansatz |
| --- | --- |
| plancraft: keine vollständige Buchhaltung (EÜR/USt-VA fehlen, nur DATEV-Export) | Volles Finance-Modul mit eigenem Journal, EÜR/USt-VA/Bilanz, gestaffelt ausgebaut |
| GAEB und Stammdaten nur in höheren Tarifen (openHandwerk, plancraft) | Alle Schnittstellen und Funktionen ohne Feature-Gates |
| Laufende Nutzer-/Monatskosten (z. B. 25-75 €/Nutzer/Monat) | Self-hosted, einmaliger Aufwand |
| Daten beim Drittanbieter | Volle Datenkontrolle, Mandantenfähigkeit |
| Generischer Gewerke-Fokus, keine Elektro/PV-Tiefe | Elektro/PV als Kernmodul mit Messgeräte-Import, Anlagenakte, PV-Doku |
| Steuerberater nur per Export oder Einzel-Login angebunden | Read-only-Rolle als Fallback; Kanzlei-Connector mit Scopes, Rückfragen und Vorschlags-Freigabe, Kanzlei-Hub bündelt alle Mandanten |

Die vollständige Tabelle steht in [`docs/konzept/Feature-Gliederung.md`](docs/konzept/Feature-Gliederung.md), Abschnitt 11.

## Funktionsumfang (geplant)

| Bereich | Inhalt |
| --- | --- |
| Architektur-Bausteine | Datenmodell-Kern, Fristen-Engine, Formular-/Protokoll-Engine, Dokumentenkette, Nummernkreise mit Festschreibung, Offline-Sync |
| CRM | Kunden mit steuerlichen Attributen, Objekt- und Anlagenakte mit QR-Etikett, Vertriebspipeline, Kommunikationshistorie, Wartungsverträge, Kundenportal |
| Belegwesen | Kostenvoranschlag, Angebot, Auftragsbestätigung, Lieferschein, Regiebericht, kumulierte Abschlagsrechnung, Schlussrechnung, Storno und Gutschrift, E-Rechnung ein- und ausgehend |
| Termin und Zeit | Plantafel mit Drag & Drop, Serientermine, Rufbereitschaftsplan, mobile Zeiterfassung mit ArbZG- und MiLoG-Prüfung |
| Material und Fuhrpark | Artikelstamm, Lager und Fahrzeuglager, DATANORM- und IDS-Connect-Anbindung, Fahrzeuge, Werkzeuge, Kalibrier- und Prüffristen |
| Finance | Journal in doppelter Buchführung, offene Posten und Mahnwesen, Bankanbindung, EÜR und USt-Voranmeldung, Anlagenbuchhaltung, Bilanz und GuV, DATEV-Export, Z1 bis Z3 für die Betriebsprüfung |
| Elektro und PV | Prüfprotokolle (E-Check, VDE 0100-600, VDE 0105-100, DGUV V3, VDE-AR-N 4105), Messgeräte-Import, Stromkreisverzeichnis, PV-Dokumentation, Anlagen-Monitoring als Servicetrigger |
| Kanzlei-Anbindung | Einstellungsseite Steuerberater mit Einladungscode und Scopes, Zugriffslog, API nach `opengewerk-api-spec`, Webhooks, Rückfragen-Postfach, Vorschlags-Freigabe |

## Status

OpenGewerk steht am Anfang von **Phase 0**. Es gibt das ausgearbeitete Konzept, die Architekturentscheidungen und seit dem 18.09.2026 das Monorepo-Gerüst mit Typprüfung, Lint und Tests. Fachlogik gibt es noch keine: die Pakete sind bis auf ihre Konfiguration leer, der Inhalt kommt mit den Issues der Phase 0.

Das vollständige Konzept liegt unter [`docs/konzept/`](docs/konzept/). Wer mitreden will, fängt am besten dort an. Architekturentscheidungen werden unter [`docs/adr/`](docs/adr/) festgehalten.

## Entwicklung

Vorausgesetzt werden Node 24 und ein aktiviertes Corepack (`corepack enable`). Corepack holt pnpm in genau der Version, die im Wurzelpaket steht, niemand muss es selbst installieren.

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
```

Die drei Prüfungen laufen über Turborepo und damit über alle Pakete. Dieselben vier Schritte laufen in der CI. Warum die Werkzeuge so gewählt sind, steht in [ADR 0009](docs/adr/0009-werkzeuge-und-repo-struktur.md).

| Paket | Inhalt |
| --- | --- |
| [`packages/domain`](packages/domain) | Schemas, Berechnungen, Regeln, Fristen. Kein I/O, keine Frameworks |
| [`packages/server`](packages/server) | NestJS, Drizzle, Auth, Sync-Endpunkte |
| [`packages/web`](packages/web) | React und Vite, eine Codebasis, Einstiege `/` für das Büro und `/m` für die Baustelle |

`domain` rechnet im Browser und auf dem Server identisch und kennt deshalb weder Node- noch DOM-Typen. Ein `import ... from 'node:fs'` ist dort ein Typfehler, kein Diskussionspunkt in der Codereview.

### Datenbank

Die Tests des Datenmodells laufen gegen eine echte PostgreSQL 18, nicht gegen eine Nachbildung. Geprüft werden Fremdschlüssel, Check-Constraints und `uuidv7()`, also genau das, was eine Nachbildung anders macht als der Ernstfall.

```bash
docker compose -f docker/compose.test.yaml up -d
pnpm run test
```

Die Datenbank heißt `opengewerk_test`, und die Tests weigern sich zu laufen, wenn der Name nicht auf `_test` endet: sie leeren das Schema, bevor sie anfangen.

Das Schema steht in `packages/server/src/database/schema/`, die Migrationen daneben in `migrations/`. Nach einer Änderung am Schema:

```bash
pnpm --filter @opengewerk/server run db:generate
```

Zu jeder Migration gehört eine Rücknahme unter `migrations/down/` mit demselben Dateinamen. drizzle-kit erzeugt die nicht, ADR 0003 verlangt sie trotzdem: eine Migration, die sich nicht zurücknehmen lässt, ist beim ersten Fehlschlag im Betrieb ein Restore aus dem Backup statt eines Rückbaus. Ein Test prüft, dass nach der Rücknahme wirklich nichts übrig bleibt.

Einmal gemergte Migrationen werden nicht mehr geändert. Sie sind auf fremden Datenbanken bereits gelaufen; eine Korrektur ist eine neue Datei.

### Mandantentrennung

Mehrere Firmen teilen sich eine Instanz. Jede Tabelle trägt `tenant_id`, und PostgreSQL setzt die Trennung selbst durch: Row-Level Security mit einer Policy je Tabelle, die gegen `app.tenant_id` prüft. Gesetzt wird dieser Wert an genau einer Stelle, in `Database.forTenant()`, und zwar als `SET LOCAL` innerhalb der Transaktion. Danach ist er wieder weg, auch wenn die Verbindung in den Pool zurückgeht.

Drei Dinge daran sind leicht zu übersehen:

- **Ein Superuser umgeht jede Policy.** Die Anwendung verbindet sich deshalb als `opengewerk_app`, einer Rolle ohne Superuser-Rechte und ohne Eigentum an den Tabellen.
- **Ein Tabelleneigentümer umgeht sie ebenfalls**, solange die Tabelle nicht `FORCE ROW LEVEL SECURITY` sagt. drizzle-kit erzeugt das nicht, es steht von Hand in der Migration.
- **Ohne gesetzten Mandanten ist das Ergebnis leer, nicht vollständig.** Die Policy vergleicht dann gegen `null`, und das trifft keine Zeile. In diese Richtung muss ein Fehler laufen.

Ein Test prüft für jede Tabelle, dass RLS aktiviert und erzwungen ist, dass eine Policy existiert und dass die Anwendungsrolle Rechte hat. Eine Tabelle, die in einer späteren Migration dazukommt und eines davon vergisst, fällt damit sofort auf, statt still für alle sichtbar zu sein.

### Rollen und Rechte

Drei Rollen zum Start: Inhaber, Büro, Monteur. Die Rechte sind entlang der Aktion geschnitten, nicht entlang der Oberfläche, und heißen `subject.verb`. Der wichtigste Schnitt liegt zwischen `document.write` und `document.issue`: ein Monteur schreibt den Regiebericht auf der Baustelle, festschreiben darf ihn das Büro. Ab der Festschreibung ist der Beleg fix und wird nur noch storniert, nie geändert.

Geprüft wird serverseitig an jeder Route, über einen global registrierten Guard. Global und nicht je Controller, weil das den Unterschied macht: eine Route, die kein Recht deklariert, wird abgelehnt statt durchgewunken. Ein Test zählt alle registrierten Routen auf und meldet jede ohne Rechteangabe; die Liste der Controller kommt aus dem Modul selbst, ein neuer Controller ist also automatisch dabei.

**Rechte und Mandantentrennung sind zwei Fragen.** Die Rechte sagen, *was* jemand tun darf, Row-Level Security sagt, *wessen* Daten er dabei sieht. Das Büro des einen Mandanten hat jedes Recht auf die Kunden des anderen und sieht trotzdem keinen einzigen.

Einen Einstiegspunkt, der den Server startet, gibt es noch nicht. Das ist Absicht: die Anwendung verlangt eine Identitätsquelle, und die einzige, die sich heute schreiben ließe, würde jeden hereinlassen. Der Server startet erst, wenn die Anmeldung da ist.

### Nummernkreise und Festschreibung

Die Nummer bekommt ein Beleg beim Festschreiben, nicht beim Anlegen. Vorher ist er ein Entwurf ohne Nummer, danach ist er fest.

**Der Zähler steht in einer Tabellenzeile, nicht in einer PostgreSQL-Sequenz.** Das ist die wichtigste Entscheidung hier. Eine Sequenz vergibt ihren Wert außerhalb der Transaktion und behält ihn auch dann, wenn die Transaktion zurückrollt; genau richtig für einen technischen Schlüssel und genau falsch für eine Rechnungsnummer. Der Zähler in der Zeile wird per `update ... returning` hochgezählt, was die Zeile bis zum Ende der Transaktion sperrt: gleichzeitige Anfragen werden nacheinander bedient, und ein Abbruch nimmt die Nummer wieder mit.

Alle Rechnungsarten teilen einen Kreis, Storno und Gutschrift eingeschlossen. §14 UStG verlangt eine fortlaufende Nummer je Rechnung, und ein eigener Kreis fürs Storno risse ein Loch in den, auf den es ankommt.

**Unveränderlichkeit sitzt in der Datenbank.** Ein Trigger auf `documents` lässt an einem festgeschriebenen Beleg genau einen Schritt zu, den Wechsel auf storniert, und auch den nur, wenn sich sonst kein Feld ändert. Verglichen wird über `to_jsonb`, nicht über eine Spaltenliste, damit eine später hinzugefügte Spalte automatisch mitgeschützt ist. Löschen gibt es nicht. Eine Regel, die nur der Server kennt, gilt nicht mehr, sobald jemand mit `psql` danebensteht.

Die Vorschau der nächsten Nummer nutzt dieselbe Funktion in `domain` wie die endgültige Vergabe. Sie ist eine Vorschau und keine Zusage: wer zuerst festschreibt, bekommt die Nummer.

### Audit-Log

Jede Änderung an jeder Tabelle steht im Log, eine Zeile je Feld, das sich wirklich geändert hat: alter Wert, neuer Wert, Zeitpunkt, Benutzer und Anlass. Die Felder einer Änderung teilen sich eine Kennung, damit die Frage "und was hat sich im selben Moment noch bewegt" beantwortbar bleibt.

**Geschrieben wird von einem Datenbank-Trigger, nicht von der Anwendung.** Das ist die Entscheidung, an der hier alles hängt. Eine Zeile im Server fängt genau dort nichts, wo der Server umgangen wird, und eine Änderung über `psql` oder aus einer Migration ist der Fall, für den ein Log überhaupt existiert. Der Trigger hängt an jeder Tabelle, angebracht über eine Schleife über den Katalog statt über eine Liste; ein Test stellt dieselbe Frage später noch einmal an den Katalog, damit eine Tabelle aus einer künftigen Migration nicht still durchrutscht.

Kommt die Änderung über die Anwendung, stehen Benutzer und Anlass dabei. Kommt sie nicht von dort, steht der Benutzer leer, und das ist kein Loch, sondern der Befund: daneben steht die Datenbankrolle, und die sagt, dass jemand direkt an der Datenbank war. Den Anlass setzt heute die HTTP-Schicht auf das Recht, das die Route verlangt hat, also etwa `document.issue`. Ein Anlass, den ein Mensch eintippt ("Storno wegen Zahlendreher"), ist die bessere Antwort auf dieselbe Frage und gehört zu der Oberfläche, die danach fragt.

**Ergänzt wird das Log, mehr nicht.** Ändern, Löschen und Leeren sind durch einen eigenen Trigger versperrt, auch für den Eigentümer der Tabelle, und die Anwendungsrolle hat auf der Tabelle nur Leserecht. Das verhindert eine Änderung. Es verhindert sie aber nur, solange der Trigger da ist, und wer Rechte auf der Datenbank hat, schaltet ihn ab.

**Deshalb die Hashkette.** Jeder Eintrag wird zusammen mit dem Hash seines Vorgängers gehasht. Eine Änderung im Nachhinein ist damit nicht mehr unsichtbar: entweder passt der Eintrag nicht mehr zu seinem eigenen Fingerabdruck, oder der folgende zeigt ins Leere. Eine Prüfung läuft die Kette eines Mandanten ab und nennt die erste Stelle, an der es nicht mehr aufgeht. Gehasht wird die ganze Zeile ohne ihren eigenen Hash, eine später hinzugefügte Spalte ist also automatisch mit abgedeckt, und dieselbe Funktion berechnet den Fingerabdruck beim Schreiben und beim Prüfen; zwei Definitionen würden auseinanderlaufen.

Die Kette läuft je Mandant. Das ist keine Feinheit, sondern folgt aus der Mandantentrennung: ein Mandant sieht nur seine eigenen Einträge, und eine Kette, die er nicht lesen kann, kann er auch nicht nachrechnen. Die Reihenfolge entsteht an einer Zähler-Zeile je Mandant, nach demselben Muster wie bei den Nummernkreisen. Der Preis ist, dass zwei gleichzeitige Schreibvorgänge desselben Betriebs aufeinander warten; bei einem Handwerksbetrieb ist das nichts.

**Und was auch die Kette nicht leistet.** Wer den Trigger abschalten kann, kann auch jeden Eintrag ab der geänderten Stelle neu schreiben, und dann geht die Kette wieder auf. Sie macht eine kleine Korrektur unmöglich zu verstecken und eine große teuer. Ein echter Beweis wird sie erst gegen einen Hash, der woanders liegt, etwa in einem Backup: der schreibt alles fest, was vor ihm geschrieben wurde. Das gehört zum Backup-Issue, nicht hierher.

## Roadmap

| Phase | Inhalt | Ergebnis |
| --- | --- | --- |
| 0: Fundament | Datenmodell-Kern, Mandanten, Rechte, Fristen-Engine, Formular-Engine, Nummernkreise/Festschreibung, Offline-Sync, Betrieb (Docker, Backup, Update) | Lauffähiges Gerüst ohne Fachlogik |
| 1: Operativer Kern | Kunden/Objekte/Anlagen, Angebot → AB → Regiebericht → Rechnung (inkl. Storno, Abschläge kumuliert), Zeiterfassung, Plantafel, Serviceaufträge, E-Rechnung aus- und eingehend | Betrieb kann damit arbeiten |
| 2: Elektro/PV-Kernmodul | Prüfprotokolle, Messgeräte-Import, PV-Dokumentation, Wartungsverträge, Anlagenakte mit QR | Alleinstellungsmerkmal |
| 3: Finance | Journal, OP/Mahnwesen, Bank, EÜR/USt-VA, DATEV, Steuerberater-Rolle, Kanzlei-Connector (`opengewerk-api-spec` v1, Einladung/Scopes, Read-Endpunkte, Zugriffslog) | Buchhaltung ersetzt sevdesk/Lexware; Kanzlei-Hub kann anbinden |
| 3b: Kanzlei-Zusammenarbeit | Webhooks, Rückfragen-Postfach, Vorschlags-Freigabe, Kontenrahmen-Profile | Monatsabschluss läuft ohne E-Mail/Telefon |
| 4: Projekt-Tiefe | Bautagebuch, Kalkulation/Nachkalkulation, Nachträge, Subunternehmer, Material/Lager/Einkauf, Fuhrpark | Baustellenbetriebe |
| 5: Kundenportal | Angebote, Rechnungen, Zahlung, Termine, Störungsmeldung, Hilfeseite | Selbstbedienung |
| 6: Bilanz & Erweiterung | Anlagenbuchhaltung, Bilanz/GuV, Report-Builder, Anlagen-Monitoring, Plugin-Gewerke, lokale KI | Vollausbau |

## Projektfamilie

- [`opengewerk`](https://github.com/opengewerk/opengewerk): diese Handwerkersoftware, das CRM und ERP für den Betrieb.
- [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei): der Kanzlei-Hub, mit dem ein Steuerberater alle seine OpenGewerk-Mandanten aus einer Anwendung heraus bearbeitet, ohne dass die Daten den Betrieb verlassen.
- [`opengewerk-api-spec`](https://github.com/opengewerk/opengewerk-api-spec): der gemeinsame API-Vertrag zwischen beiden, versioniert nach SemVer, damit Hub und Handwerkersoftware unabhängig releasen können.

## Mitmachen

Das Projekt steht noch am Anfang, gerade jetzt zählt jede fachliche Rückmeldung aus dem Betriebsalltag mehr als Code.

- Fragen, Ideen und alles ohne konkreten Vorschlag gehören in die [Discussions](https://github.com/opengewerk/opengewerk/discussions).
- Konkrete Fehler und Wünsche laufen über die [Issue-Vorlagen](https://github.com/opengewerk/opengewerk/issues/new/choose).
- Die Beitragsregeln stehen in [CONTRIBUTING.md](https://github.com/opengewerk/.github/blob/main/CONTRIBUTING.md), der Verhaltenskodex in [CODE_OF_CONDUCT.md](https://github.com/opengewerk/.github/blob/main/CODE_OF_CONDUCT.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer OpenGewerk als Dienst für andere betreibt, gibt seine Änderungen zurück.
