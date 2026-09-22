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

Das Fundament aus **Phase 0** steht. Es gibt das ausgearbeitete Konzept, die Architekturentscheidungen und den Unterbau: Datenmodell, Mandantentrennung, Rechte, Nummernkreise, Audit-Log, Offline-Datenschicht, Regel-Engine und seit dem 19.09.2026 den Betrieb über Docker Compose samt Sicherung, Rückspielen und Update-Pfad. Seit dem 20.09.2026 gibt es die **Anmeldung** nach ADR 0006 (Sitzungen, zweiter Faktor, Betriebswahl, Geräteliste), die **Belegpositionen** mit Beträgen und Steuer, die **erste Oberfläche** (beide Einstiege, Kunde bis Auftrag, der Abgleich als Leiste und der Konfliktbildschirm) und die **Ersteinrichtung im Browser**: eine frische Installation kommt von null bis zum angemeldeten Inhaber, ohne Kommandozeile und ohne SQL. Eine Installation zeigt damit nicht mehr nur eine API, sondern eine Anwendung, mit der sich arbeiten lässt. Seit dem 21.09.2026 kommt ein festgeschriebener Beleg als **PDF** heraus, mit dem Briefkopf des Betriebs, und eine Rechnung ohne die Pflichtangaben nach §14 UStG wird gar nicht erst festgeschrieben. Den Briefkopf pflegt der Betrieb im Büro. Seit demselben Tag entstehen dort auch **Angebot, Kostenvoranschlag und Auftragsbestätigung**: mit Titeln und Positionen, mit Texten über und unter den Positionen aus Textbausteinen, als PDF, und die Auftragsbestätigung entsteht aus dem festgeschriebenen Angebot und kennt es. Auf der Baustelle entsteht seit demselben Tag der **Regiebericht**: ohne Netz geschrieben, dort vom Kunden auf dem Gerät unterschrieben und danach unveränderlich, im Büro festgeschrieben und als PDF mit der Unterschrift. Aus Angebot, Auftragsbestätigung und Regiebericht entsteht die **Rechnung**: die Schlussrechnung und davor, wo die Arbeit länger dauert, kumulierte Abschlagsrechnungen, die zusammen auf den Cent die ganze Leistung ergeben. Eine festgeschriebene Rechnung lässt sich danach nicht mehr ändern, nur noch **stornieren**: die Stornorechnung nennt sie, wiederholt jeden ihrer Beträge mit umgekehrtem Vorzeichen, und beide bleiben in den Büchern. Eine Rechnung an ein Unternehmen im Inland geht außerdem als **E-Rechnung** hinaus, als ZUGFeRD-PDF oder als XRechnung, vor dem Speichern gegen das Schema geprüft; welches Format eine Rechnung bekommt, entscheiden die Stammdaten des Kunden und nicht ein Schalter an der Rechnung.

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

An der Oberfläche arbeitet man mit zwei Prozessen nebeneinander: der Server auf Port 3000, und daneben

```bash
pnpm --filter @opengewerk/web run dev
```

Vite liefert dann beide Einstiege aus, `/` und `/m`, und reicht jeden Pfad, der dem Server gehört, an ihn weiter. Der Service Worker bleibt dabei aus: einer, der weiter die vorige Fassung ausliefert, ist das Verwirrendste, was beim Bauen an einer Oberfläche passieren kann.

| Paket | Inhalt |
| --- | --- |
| [`packages/domain`](packages/domain) | Schemas, Berechnungen, Regeln, Fristen. Kein I/O, keine Frameworks |
| [`packages/server`](packages/server) | NestJS, Drizzle, Auth, Sync-Endpunkte |
| [`packages/web`](packages/web) | React und Vite, eine Codebasis, Einstiege `/` für das Büro und `/m` für die Baustelle, Abgleich-Client und PWA |

`domain` rechnet im Browser und auf dem Server identisch und kennt deshalb weder Node- noch DOM-Typen. Ein `import ... from 'node:fs'` ist dort ein Typfehler, kein Diskussionspunkt in der Codereview.

### Vorschau ohne Anmeldung

Um die Oberfläche anzusehen, ohne ein Konto anzulegen:

```bash
docker compose -f docker/compose.test.yaml up -d
pnpm run preview
```

Das baut die Oberfläche, legt in einer eigenen Datenbank `opengewerk_preview` einen Beispielbetrieb an und startet den Server unter `http://127.0.0.1:3000`. Dort läuft jede Anfrage ohne Anmeldung mit der Rolle Inhaber dieses Betriebs. Im Betrieb stehen zwei Kunden, ein Objekt mit Anlage, zwei Aufträge, ein festgeschriebenes Angebot mit der Auftragsbestätigung daraus, ein Kostenvoranschlag in Arbeit, ein vom Kunden unterschriebener Regiebericht und Textbausteine. Die Unterschrift kommt dabei über `/sync`, wie von einem Gerät, denn eine eigene Route für Unterschriften gibt es nicht. Angelegt wird das alles über die echten Routen, also mit Steuerfall, Nummernkreis und eingefrorenem Belegstand wie in einem echten Betrieb. Bei jedem Start entsteht der Betrieb neu; was in der Vorschau geändert wird, ist danach weg.

**Die Vorschau lässt jede Anfrage durch und ist deshalb eingezäunt.** Sie liegt unter `packages/server/src/preview/` und wird nicht nach `dist` übersetzt, sondern nach `preview-build/`, und steht damit in keinem Abbild. Sie startet nicht mit `NODE_ENV=production`, lauscht nur auf 127.0.0.1 und nimmt nur eine Datenbank auf diesem Rechner, deren Name auf `_preview` endet; gelesen wird die Adresse aus `PREVIEW_DATABASE_URL` und nie aus `DATABASE_URL`. Hinter dem Wächter ist alles echt: Rechte, Mandantentrennung und Audit-Log. Ein Test lässt die Beispieldaten bei jedem Lauf gegen die echten Routen laufen, damit eine geänderte Route hier auffällt und nicht erst beim nächsten Start der Vorschau.

Wer dabei an der Oberfläche baut, lässt die Vorschau laufen und startet daneben `pnpm --filter @opengewerk/web run dev`; Vite reicht die API an Port 3000 weiter. Ein PDF entsteht, wenn `RENDERER_URL` und `RENDERER_TOKEN` gesetzt sind, wie bei einer Instanz. Die Anmeldung selbst deckt die Vorschau nicht ab, die prüfen die Tests der Anmeldebildschirme.

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

Einmal gemergte Migrationen werden nicht mehr geändert. Sie sind auf fremden Datenbanken bereits gelaufen; eine Korrektur ist eine neue Datei. Der Migrationslauf verlässt sich nicht darauf, dass alle daran denken: er vergleicht die Hashes in der Datenbank mit den Dateien und lehnt ab, wenn eine davon nicht mehr dieselbe ist. Warum das nötig ist, steht unter [Aktualisieren](#aktualisieren).

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

Bis zum 20.09.2026 lief eine Instanz mit einer Identitätsquelle, die **niemanden** erkannte, und jede Route hinter dem Guard antwortete mit 401. Das war nicht dieselbe Sache wie der Notbehelf, der beim Bau der Rechte verworfen wurde: der hätte jeden hereingelassen. Dieser ließ keinen herein, und deshalb konnte eine Instanz betrieben, migriert und gemessen werden, bevor es irgendwo etwas zum Anmelden gab. Mit der Anmeldung ist genau diese eine Klasse ausgetauscht worden; sie ist geblieben und lässt sich über `CLOSED=true` wieder einschalten.

**Der Guard kennt seit der Anmeldung eine dritte Art von Route.** Öffentlich ist der Health-Check, mit einem Recht läuft alles, was Daten anfasst, und dazwischen liegen die fünf Routen zwischen Passwort und Betriebswahl: angemeldet ja, Betrieb nein, Recht nein. Ein Recht können sie nicht verlangen, denn Rechte kommen aus einer Mitgliedschaft und die gilt je Betrieb. Sie stehen als Liste im Test, eine sechste macht ihn rot.

### Nummernkreise und Festschreibung

Die Nummer bekommt ein Beleg beim Festschreiben, nicht beim Anlegen. Vorher ist er ein Entwurf ohne Nummer, danach ist er fest.

**Der Zähler steht in einer Tabellenzeile, nicht in einer PostgreSQL-Sequenz.** Das ist die wichtigste Entscheidung hier. Eine Sequenz vergibt ihren Wert außerhalb der Transaktion und behält ihn auch dann, wenn die Transaktion zurückrollt; genau richtig für einen technischen Schlüssel und genau falsch für eine Rechnungsnummer. Der Zähler in der Zeile wird per `update ... returning` hochgezählt, was die Zeile bis zum Ende der Transaktion sperrt: gleichzeitige Anfragen werden nacheinander bedient, und ein Abbruch nimmt die Nummer wieder mit.

Alle Rechnungsarten teilen einen Kreis, Storno und Gutschrift eingeschlossen. §14 UStG verlangt eine fortlaufende Nummer je Rechnung, und ein eigener Kreis fürs Storno risse ein Loch in den, auf den es ankommt.

**Unveränderlichkeit sitzt in der Datenbank.** Ein Trigger auf `documents` lässt an einem festgeschriebenen Beleg genau einen Schritt zu, den Wechsel auf storniert, und auch den nur, wenn sich sonst kein Feld ändert. Verglichen wird über `to_jsonb`, nicht über eine Spaltenliste, damit eine später hinzugefügte Spalte automatisch mitgeschützt ist. Löschen gibt es nicht. Eine Regel, die nur der Server kennt, gilt nicht mehr, sobald jemand mit `psql` danebensteht.

Die Vorschau der nächsten Nummer nutzt dieselbe Funktion in `domain` wie die endgültige Vergabe. Sie ist eine Vorschau und keine Zusage: wer zuerst festschreibt, bekommt die Nummer.

### Belegpositionen

Die Beträge stehen an der Zeile und nicht am Kopf. Eine Summe am Beleg wäre dieselbe Zahl an einem zweiten Ort, und zwei Orte laufen auseinander. Was der Beleg zeigt, rechnet `totalsFor` jedes Mal aus den Zeilen, mit dem **Belegdatum**: eine Rechnung aus dem zweiten Halbjahr 2020 ist auch 2030 eine Rechnung mit sechzehn Prozent.

**Die Reihenfolge der Rechenschritte ist die deutsche.** Erst werden die Zeilen je Steuersatz addiert, dann wird die Steuer einmal auf diese Summe gerechnet. Jede Zeile einzeln zu besteuern und die Steuerbeträge zu addieren ergibt bei etwa jeder dritten Rechnung einen anderen Betrag, weil jede Zeile für sich rundet.

**Die Nettosumme der Zeile wird gespeichert und von einem Check gehalten.** Gespeichert, weil Menge mal Preis gerundet werden muss und die gerundete Zahl die ist, die der Kunde gesehen hat. Gehalten, weil eine gespeicherte abgeleitete Zahl, die niemand prüft, einmal falsch wird und falsch bleibt. Der Check rechnet über `numeric`, nicht über die Ganzzahlen: PostgreSQL rundet ein `numeric` kaufmännisch und ein `double precision` zur geraden Zahl, und nur das erste stimmt mit der Anwendung überein.

**Die Positionen frieren mit ihrem Beleg ein.** Ein Trigger liest den Status des Belegs, nicht ein Feld an der Zeile. Ohne ihn ließe sich eine Position nach dem Festschreiben noch ändern, und dann wäre die ganze Nummernvergabe nichts wert. Geprüft wird das durch die API und an ihr vorbei, direkt auf der Tabelle.

**Zwei Fälle zeigen keine Steuer, sondern einen Satz.** Kleinunternehmer nach §19 UStG und Bauleistung nach §13b UStG. Beide tragen den vorgeschriebenen Hinweis statt eines Betrags von null, denn eine Zeile "0,00 EUR Umsatzsteuer" sagt etwas anderes und Falsches. Welcher Fall gilt, wird beim Anlegen aus dem Kunden und den Einstellungen des Betriebs abgeleitet, am Beleg gespeichert und mit dem Festschreiben eingefroren: wer ihn beim Lesen neu ableitete, schriebe die Rechnung vom letzten Jahr um, sobald sich ein Kennzeichen ändert. §19 geht dabei vor §13b, denn wo keine Steuer anfällt, ist auch keine umzukehren. Den Satz für den Kleinunternehmer gibt seit 2025 §34a Satz 1 Nr. 5 UStDV vor, ein Hinweis darauf, dass die Steuerbefreiung für Kleinunternehmer gilt, und in diesen Worten steht er seit dem 22.09.2026 auf dem Beleg. Vorher hieß es, nach §19 werde keine Umsatzsteuer berechnet; das nannte den Paragrafen, aber nicht die Befreiung, die er seit 2025 ist. Ein festgeschriebener Beleg behält den Satz, mit dem er festgeschrieben wurde.

### Belegvorlage und PDF

Ein Rahmen für alle Belegarten: Briefkopf, Anschriftfeld, Informationsblock, Positionen, Summen, Hinweise und eine Fußzeile auf jeder Seite. Der Aufbau folgt DIN 5008 Form B, damit die Anschrift im Fenster eines Umschlags landet. Die Vorlage liegt im Repository (`packages/server/src/documents/template.ts`), was ein Betrieb beisteuert, pflegt er im Büro unter "Briefkopf": Name, Anschrift, Kontakt, Steuernummer, Bankverbindung, Handelsregister und ein Logo. Ändern darf das nur der Inhaber, lesen auch das Büro.

**Die Pflichtangaben werden vor der Festschreibung geprüft, nicht danach.** Fehlt einer Rechnung etwas, wird sie mit 422 abgelehnt, und die Antwort zählt auf, was fehlt und nach welchem Paragrafen. Der Zähler rührt sich dabei nicht, es entsteht also keine Lücke. Geprüft wird nach der Liste, die der Beleg wirklich braucht, und davon gibt es drei: §14 Abs. 4 UStG als Regel, §33 UStDV für eine Kleinbetragsrechnung und seit 2025 §34a UStDV für einen Kleinunternehmer. Die Kleinbetragsrechnung kommt ohne Anschrift des Kunden aus, ein Kleinunternehmer ohne Rechnungsnummer und Leistungsdatum, und ein Reverse Charge bekommt nie die kurze Liste. Die Grenze von 250 Euro und der Stichtag von §34a stehen im Regelpaket `invoice.json`, nicht im Code. Die Prüfung selbst liegt in `domain` und rechnet auf dem Gerät dieselbe Antwort aus wie auf dem Server.

**Der Beleg hält beim Festschreiben fest, was er sagt.** In derselben Transaktion, die die Nummer vergibt, entsteht eine Zeile in `document_snapshots` mit allem, was gedruckt wird: Briefkopf, Kunde, Objekt, Positionen, Summen und die Pflichthinweise. Gedruckt wird danach nur noch daraus. Zieht der Kunde um oder ändert der Betrieb seine Bankverbindung, bleibt die Rechnung vom letzten Monat, wie sie war. Die Anwendung darf diese Zeile nur einfügen und lesen, und ein Trigger lehnt Ändern und Löschen für jede Rolle ab, auch für einen Superuser.

**Das PDF entsteht beim ersten Abruf und wird danach nur noch ausgeliefert.** `GET /documents/:id/pdf` druckt einen festgeschriebenen Beleg einmal aus seinem Stand, legt das Ergebnis im Dateispeicher ab und gibt ab dann genau diese Bytes zurück. Chromium setzt eine Seite nicht zweimal gleich, und ein Beleg, der bei jedem Öffnen ein wenig anders aussieht, ist nicht der Beleg, der verschickt wurde. Dass das PDF nicht schon beim Festschreiben entsteht, hat einen Grund: der Renderer ist ein Container, den eine Installation weglassen darf, und eine Rechnung festzuschreiben darf nicht daran scheitern, dass er gerade nicht läuft. Fehlt er, antwortet die Route mit 503 und nennt den Befehl, der ihn startet. Ein Entwurf wird bei jedem Abruf neu gesetzt, trägt quer über jede Seite "Entwurf" und wird nie gespeichert. Ein unterschriebener Regiebericht, der noch keine Nummer hat, wird ebenso bei jedem Abruf gesetzt, aber ohne diese Marke: an ihm ändert sich nichts mehr, und er ist, was der Kunde unterschrieben hat.

**Der Dateispeicher ist inhaltsadressiert.** Eine Datei liegt unter dem SHA-256 ihres Inhalts, zwei Verzeichnisebenen tief (`ab/cd/abcd…`), wird vor dem Umbenennen auf die Platte geschrieben und beim Lesen gegen ihren Namen geprüft. Wem eine Datei gehört, weiß der Speicher nicht; das beantwortet die Tabelle `files` unter derselben Mandantentrennung wie alles andere. Wer den Hash der Rechnung eines anderen Betriebs kennt, hat eine Zeichenkette und keine Datei. Das ist das Fundament, auf dem die Dokumentenablage aufsetzt.

**Die Schrift reist mit.** Barlow steckt als Daten im HTML, das an den Renderer geht, damit ein PDF nach einem Update des Renderer-Abbilds nicht anders umbricht als vorher. Die Fußzeile mit Seitenzahl setzt Chromium selbst, als eigenes kleines Dokument mit eigener Schrift. Was von einer Person kommt, wird vor dem Einsetzen maskiert; ein Test hält fest, dass aus einer Position `<script>` Text wird und kein Markup.

Was diese Vorlage bewusst noch nicht kann: Zahlungsbedingungen, Reverse Charge mit den Angaben des Empfängers, Bauabzugsteuer und Widerrufsbelehrung. Sie gehören zu den Belegarten, die sie brauchen, und kommen mit deren Issues. PDF/A erzeugt Chromium nicht. Wo es gebraucht wird, beim ZUGFeRD-PDF, macht OpenGewerk das gedruckte PDF nachträglich zu PDF/A-3, siehe das Kapitel E-Rechnung.

Ein PDF lokal ansehen geht mit demselben Renderer wie im Betrieb:

```bash
docker run -d --rm --name renderer -p 127.0.0.1:3999:3000 -e TOKEN=probe ghcr.io/browserless/chromium:latest
```

und dann `RENDERER_URL=http://127.0.0.1:3999` und `RENDERER_TOKEN=probe` für den Server. In der CI läuft kein Renderer, die Tests der Route arbeiten mit einem Ersatz, der feste Bytes zurückgibt.

### Angebot und Auftragsbestätigung

Die ersten beiden Glieder der Belegkette aus Abschnitt 1.4 der Feature-Gliederung, im Büro. Ein Angebot entsteht am Auftrag, bekommt Titel und Positionen, Texte über und unter den Positionen und kommt als PDF heraus. Aus dem festgeschriebenen Angebot entsteht die Auftragsbestätigung.

**Kostenvoranschlag und Angebot sind zwei Belegarten, nicht eine mit Schalter.** Am Auftrag stehen dafür zwei Knöpfe. Ein Kostenvoranschlag ist nach §649 BGB eine Schätzung ohne Gewähr für ihre Richtigkeit, und wird er wesentlich überschritten, muss der Kunde das vorher erfahren; ein Angebot nennt Preise, an die sich der Betrieb bindet. Der Bildschirm eines Kostenvoranschlags sagt das in einem Satz. Die Fundstelle stand im Konzept bis v2.5 als §650 BGB, dort stand der Kostenanschlag vor der Reform des Bauvertragsrechts 2018.

**Ein Titel ist eine Zeile ohne Betrag.** Seine Stelle in der Liste ist seine ganze Bedeutung: alles bis zum nächsten Titel gehört zu ihm. Als Zeile wandert er mit demselben Feld wie die Positionen, reist wie sie auf ein Gerät und friert mit seinem Beleg ein, ohne eine Zeile neuen Codes. Ein Check hält ihn frei von Menge und Preis, und `totalsFor` lässt ihn aus der Summe heraus: sonst öffnete ein Titel mit dem Regelsatz als Vorgabe eine Steuergruppe von null Euro auf einem Beleg, dessen Positionen anders besteuert sind. Die Gliederung (Titel 1, 2, Positionen 1.1, 1.2, unter jedem Titel seine Summe) rechnet `outlineRows` in `domain` aus, und zwar für den Bildschirm und das PDF, damit Position 2.3 auf beiden dieselbe ist. Gespeichert wird sie nicht, die Nummer einer Position ist ihre Stelle.

**Die Auftragsbestätigung entsteht auf dem Server, in einem Schritt.** `POST /documents/:id/successors` legt den Kopf und jede Zeile des Vorgängers in einer Transaktion an und verweist über `predecessorDocumentId` auf ihn. Über den Postausgang wären es Dutzende einzelne Vorgänge, und eine Verbindung, die mittendrin abreißt, hinterließe eine Auftragsbestätigung mit der Hälfte der Positionen. Welche Art aus welcher entstehen darf, steht in `successorKinds` in `domain`; die Rechnungen haben ihre Glieder mit #74 bekommen, siehe das Kapitel dazu. Ein Folgebeleg entsteht nur aus einem festgeschriebenen Beleg, denn angenommen hat der Kunde, was verschickt wurde. Die Zeilen werden kopiert und nicht verknüpft, die Auftragsbestätigung darf eine Position weglassen, die nicht bestellt wurde. Der Steuerfall kommt mit, die Texte über und unter den Positionen nicht: sie gehören zu dem Brief, der das Angebot war.

**Ein festgeschriebener Beleg sagt, warum er sich nicht ändern lässt.** Früher antwortete die Route auf eine Änderung mit 404, als gäbe es den Beleg nicht. Jetzt kommt 409 mit dem Grund, und der Grund hängt an der Art: eine Rechnung wird storniert, weil sie in den Büchern steht, auf ein Angebot folgt ein neues, weil nichts darauf gebucht wurde. Der Satz kommt aus `whyFixed` in `domain`, der Bildschirm zeigt denselben.

**Textbausteine sind Schreibhilfen und keine Aufzeichnungen.** Es gibt sie für Positionen und für die Texte über und unter den Positionen, gepflegt im Büro unter "Textbausteine" und abgelegt unter `/documents/text-snippets`. Einsetzen kopiert den Text in den Beleg, der Beleg verweist nicht auf den Baustein; ein geänderter Baustein schreibt also kein Angebot vom letzten Jahr um, und gelöscht wird er deshalb wirklich, das Audit-Log behält ihn. Ein Baustein trägt nur Text, keinen Preis: ein Text mit Preis ist ein Artikel, und der Artikelstamm ist eine eigene Arbeit.

**Im Büro entsteht ein Beleg über die Route, seine Zeilen über den Postausgang.** Das Anlegen geht an `POST /documents`, und der Server schlägt dabei aus dem Kunden und den Angaben des Betriebs vor, wie der Beleg besteuert wird. Seit #73 tut er das auch für einen Beleg, der über den Postausgang ankommt und keinen Steuerfall mitbringt; bis dahin kam ein solcher mit der Vorgabe an, und ein Kleinunternehmer hätte aus einem Regiebericht eine Rechnung mit Umsatzsteuer gemacht. Kopf, Texte und Zeilen gehen danach durch den Postausgang wie jeder andere Datensatz. Menge und Preis werden getippt, wie man sie hier schreibt, "2,5" und "1.234,56", und nie über `parseFloat` gelesen, das aus "1.234,56" ein 1,234 machte.

Was ausdrücklich nicht dazugehört und in 4.2 der Feature-Gliederung steht: Alternativ-, Eventual- und Bedarfspositionen (sie ändern die Summenlogik), GAEB, der Sicherheitseinbehalt nach VOB/B §17 und die Widerrufsbelehrung.

### Regiebericht mit Unterschrift

Der erste Beleg, der auf der Baustelle entsteht, nach Abschnitt 4.10 der Feature-Gliederung. Unter `/m` hat jeder Auftrag seine Regieberichte und den Knopf "Regiebericht schreiben". Darin steht, was gemacht wurde, dazu Arbeitszeit und Material, und am Ende unterschreibt der Kunde auf dem Gerät. Alles davon geht durch den Postausgang, die Unterschrift eingeschlossen, denn geschrieben wird der Bericht im Keller.

**Ein Regiebericht trägt keine Preise.** Er hält fest, was geleistet wurde; bepreist wird es auf der Rechnung, die daraus entsteht. Die Zeilen stehen mit null Euro in der Tabelle, und `showsPrices` in `domain` entscheidet für das PDF und den Bildschirm im Büro gleichermaßen, dass Einzelpreis, Summen und Steuerhinweis fehlen.

**Unterschrieben wird genau die Seite, die der Kunde sieht.** Vor der Unterschrift zeigt das Gerät den gesicherten Bericht ohne jede Bearbeitungsmöglichkeit, und aus genau diesem Stand rechnet es einen Fingerabdruck über Text und Zeilen (`signedContentFingerprint`). Der Server rechnet ihn beim Eintreffen aus seinen Zeilen nach. Hat das Büro in der Zwischenzeit eine Position ergänzt, stimmen die beiden nicht überein, und die Unterschrift wird als Konflikt abgelehnt, statt unter einer Seite zu landen, die der Kunde nie gesehen hat. Der Konfliktbildschirm bietet dafür kein "Fassung vom Gerät übernehmen", sondern erklärt, dass neu unterschrieben werden muss. Der Fingerabdruck erkennt ein Versehen und beweist nichts; er ist eine einfache elektronische Signatur mit Zeitpunkt und Geräteangabe, wie 4.10 sie beschreibt, keine fortgeschrittene.

**Mit der Unterschrift ist der Bericht `signed`, und danach ändert sich nichts mehr.** Die Unterschrift liegt in `document_signatures`, einer Tabelle, in die die Anwendung nur einfügen darf. Ein Trigger lehnt Ändern und Löschen für jede Rolle ab, ein zweiter setzt den Beleg beim Einfügen von `draft` auf `signed`. Von da an lehnen Postausgang, Routen und Datenbank jede Änderung an Bericht und Positionen ab, jede mit ihrem Grund. Das Einzige, was noch geht, ist Festschreiben: das Büro vergibt die Nummer, und der eingefrorene Stand trägt die Unterschrift mit (Fassung 3 von `DocumentContent`). Der Monteur darf schreiben und unterschreiben lassen, festschreiben darf er nicht.

**Die Unterschrift ist ein Pfad und nichts sonst.** Das Feld zeichnet in einem Rahmen von 1000 mal 400 Einheiten, gespeichert wird `M` und `L` mit ganzen Zahlen. Diese Strenge ist die Sicherheit: der Pfad steht später in einem SVG im Büro und in der Seite, die der Renderer druckt, und eine Zeichenkette aus Buchstaben M und L, Ziffern und Kommas kann dort nichts anderes einschleusen. Server und Datenbank prüfen dieselbe Form.

Was nicht dazugehört: die fortgeschrittene oder qualifizierte Signatur, die Zeiterfassung (#76) und Material aus dem Lager. Aus dem festgeschriebenen Regiebericht entsteht die Schlussrechnung, siehe das nächste Kapitel.

### Rechnung: Schlussrechnung und kumulierte Abschlagsrechnung

Das Ende der Kette aus Abschnitt 1.4 der Feature-Gliederung. Eine Rechnung entsteht aus dem, worauf die Arbeit vereinbart oder festgehalten wurde: Angebot, Kostenvoranschlag, Auftragsbestätigung oder Regiebericht. Am festgeschriebenen Beleg stehen dafür "Abschlagsrechnung erstellen" und "Schlussrechnung erstellen", am Regiebericht nur die Schlussrechnung, denn er hält fertige Arbeit fest.

**Die Abschlagsrechnung ist kumuliert, wie Abschnitt 4.2 es verlangt.** Sie nennt den Leistungsstand gesamt und zieht ab, was die Abschlagsrechnungen davor in derselben Kette gestellt haben. Die nächste Abschlagsrechnung entsteht aus der vorigen und übernimmt ihre Positionen, die Mengen wachsen mit der Arbeit; die Schlussrechnung entsteht aus der letzten und zieht alle ab. Abgezogen wird, was auf den früheren Rechnungen stand, netto und Steuer je Satz, aus ihrem eingefrorenen Stand und nie neu gerechnet (`billedAfter` in `domain`). Nur so geht die Kette auf: jede Rechnung stellt den Unterschied zwischen ihrem Stand und dem Gestellten, und alle zusammen ergeben genau die ganze Leistung. Einzeln besteuert tun sie das nicht; ein Test in `domain` hält drei Rechnungen über je 4.000,50 Euro fest, die einzeln einen Cent Steuer zu viel ergäben. Wechselt der Steuersatz zwischen einer Abschlagsrechnung und der Schlussrechnung, besteuert die Schlussrechnung die ganze Leistung mit ihrem Satz und zieht die Steuer ab, die schon ausgewiesen war. Eine stornierte Abschlagsrechnung wird übergangen, ihr Storno hat sie zurückgenommen.

**Abgezogen wird, was gestellt wurde, nicht was gezahlt wurde.** Abschnitt 4.2 nennt beides. Zahlungen kennt die Anwendung noch nicht, die Zuordnung gehört zu Finance in Phase 3; bis dahin weist die Schlussrechnung die gestellten Abschläge aus. Das trägt nur, solange jede Abschlagsrechnung bezahlt ist. § 14 Abs. 5 UStG verlangt in der Endrechnung die vereinnahmten Teilentgelte abzusetzen, und eine offene Abschlagsforderung lässt sich nach Abnahme und Schlussrechnung nach der Rechtsprechung des BGH nicht mehr neben der Schlussrechnung geltend machen. Eine offene oder nur zum Teil bezahlte Abschlagsrechnung macht die Schlussrechnung deshalb zu niedrig. Diese Lesart gehört wie die Regelpakete vor die fachkundige Abnahme in #31, die Vorprüfung vom 22.09.2026 steht dort.

**Auf dem Papier drei Teile.** Die Gesamtleistung (bei einer Abschlagsrechnung "Leistungsstand gesamt") mit Steuer je Satz, jede abgezogene Abschlagsrechnung mit Nummer, Datum und ihren Beträgen, und der Rechnungsbetrag mit Netto und Steuer je Satz. Der Bildschirm im Büro zeigt dasselbe, gerechnet mit derselben Funktion; die Abzüge eines Entwurfs holt er über `GET /documents/:id/deductions`, weil nur der Server die eingefrorenen Stände hat.

**Der Leistungszeitraum kommt mit.** Eine Schlussrechnung aus einem Regiebericht nimmt dessen Datum als Tag der Leistung, der Bericht entsteht am Tag der Arbeit. Aus einem anderen Vorgänger kommt der Zeitraum, den er nennt; nennt er keinen, trägt ihn das Büro im Kopf der Rechnung ein, und ohne ihn wird eine Schlussrechnung nicht festgeschrieben (§14 Abs. 4 Nr. 6 UStG). Die Abschlagsrechnung braucht keinen, sie wird geschrieben, während die Arbeit noch läuft.

Der Steuerfall muss in der ganzen Kette derselbe sein. Eine Schlussrechnung nach § 19 lässt sich nicht gegen Abschläge mit Umsatzsteuer rechnen, das ergäbe eine negative Steuer, die niemand schuldet; das Festschreiben lehnt es ab und nennt die Abschlagsrechnung, die nicht passt.

Was dieser Teil noch nicht kann: die Teilrechnung, eine Rechnung aus mehreren Regieberichten zugleich und den Mengenabgleich aus Abschnitt 1.4 (angeboten, geliefert, abgerechnet).

### Storno

Eine festgeschriebene Rechnung wird nicht geändert und nicht gelöscht, sondern storniert, so will es Leitentscheidung 4 der Feature-Gliederung und Abschnitt 4.2. Am Bildschirm einer festgeschriebenen Rechnung steht dafür "Stornieren", mit einer Rückfrage wie beim Festschreiben, denn auch dieser Schritt lässt sich nicht zurücknehmen. Stornieren darf, wer festschreiben darf: eine Stornorechnung ist eine Buchung wie die Rechnung, die sie aufhebt.

**Die Stornorechnung ist der Spiegel der Rechnung und wird nicht neu gerechnet.** `POST /documents/:id/cancellation` schreibt sie in einer Transaktion: den Kopf, jede Position mit umgekehrter Menge, die nächste Nummer aus dem Kreis der Rechnungen, den eingefrorenen Stand, und die Rechnung wechselt auf storniert. Was die Stornorechnung sagt, kommt aus dem eingefrorenen Stand der Rechnung (`cancellationOf` in `domain`): Summen, Steuer je Satz und Abzüge werden umgedreht, nicht aus den Zeilen neu gerechnet. Nur so hebt sie auf den Cent auf, was verschickt wurde, auch wenn sich zwischen Rechnung und Storno ein Steuersatz geändert hat; der Bildschirm im Büro rechnet eine Stornorechnung aus demselben Grund mit dem Datum der Rechnung. Kunde, Objekt und Leistungszeitraum sind die der Rechnung, der Briefkopf ist der von heute, denn die Stornorechnung stellt der Betrieb, wie er heute firmiert.

**Sie nennt die Rechnung, die sie aufhebt.** Im Informationsblock steht "Zur Rechnung" mit Nummer und Datum, über den Positionen ein Satz, dass diese Rechnung in voller Höhe storniert wird. Ohne den Verweis wird sie nicht festgeschrieben (§ 31 Abs. 5 UStDV), geprüft über dieselbe Liste der Pflichtangaben wie jede Rechnung; festgehalten ist er in Fassung 5 von `DocumentContent`. Hat die Rechnung Abschlagsrechnungen abgezogen, gibt die Stornorechnung diese Abzüge als "zurückgenommener Abzug" zurück, und die beiden Rechnungsbeträge ergeben zusammen null.

**In einer Kette wird die spätere Rechnung zuerst storniert.** Baut eine festgeschriebene Rechnung auf der zu stornierenden auf, etwa eine Schlussrechnung auf einer Abschlagsrechnung, lehnt die Route ab und nennt sie. Ihre Zahlen enthalten den Abzug, und ohne ihr eigenes Storno zöge sie etwas ab, das nicht mehr gilt. Ein Entwurf hält dagegen nichts auf, er steht in keinen Büchern, und eine stornierte Abschlagsrechnung wird bei den Abzügen späterer Rechnungen übergangen. Ein Entwurf selbst wird nicht storniert, sondern gelöscht. Eine Stornorechnung wird nicht storniert; soll die Leistung wieder berechnet werden, entsteht eine neue Rechnung aus dem Angebot, der Auftragsbestätigung oder dem Regiebericht.

**Eine Stornorechnung entsteht auf keinem anderen Weg.** Ein Trigger auf `documents` (Migration 0016) lehnt jede Zeile dieser Art ab, die nicht in der Transaktion dieser Route entsteht. Die Route kennzeichnet ihre Transaktion mit `app.cancelling` über `set_config(..., true)`, und die Kennzeichnung verschwindet mit der Transaktion. `POST /documents` und `PATCH` antworten deshalb mit 409, und der Abgleich lehnt einen solchen Vorgang vom Gerät als `set_by_server` ab.

Was nicht dazugehört: die Gutschrift und die Rechnungskorrektur mit geänderten Beträgen, ein eingetippter Anlass für das Storno und alles, was Zahlungen betrifft.

### E-Rechnung

Eine Rechnung an ein Unternehmen im Inland geht als **E-Rechnung** hinaus, eine an eine Privatperson als PDF. Das entscheidet kein Schalter an der Rechnung, sondern der Kunde: "Unternehmen im Sinne der Umsatzsteuer" und das Land in seinen Stammdaten (`formatFor` in `domain`). Ein Schalter am Beleg würde irgendwann falsch gesetzt. Die Ausnahmen sind die des Gesetzes: eine Rechnung bis 250 Euro (§ 33 Satz 4 UStDV) und jede Rechnung eines Kleinunternehmers (§ 34a Satz 4 UStDV) gehen als PDF, eine Rechnung mit Steuerschuldnerschaft des Leistungsempfängers zählt nie als Kleinbetrag. Am Bildschirm einer Rechnung steht, wie sie hinausgeht und warum, mit dem Paragrafen.

**Die XRechnung entsteht aus dem eingefrorenen Stand, wie das PDF.** `GET /documents/:id/xrechnung` schreibt sie beim ersten Abruf einer festgeschriebenen Rechnung, als UN/CEFACT CII nach XRechnung 3.0, hält sie gegen das XML-Schema, legt sie im Dateispeicher ab und gibt danach nur noch diese Datei heraus. Die Schemadateien liegen im Repository, zur Laufzeit kommt nichts aus dem Netz. Die Geschäftsregeln von EN 16931 und XRechnung prüft die CI mit dem Validator der KoSIT an Musterrechnungen: eine Schlussrechnung mit zwei Steuersätzen und abgezogenen Abschlagsrechnungen, eine Abschlagsrechnung, ein Storno, eine Rechnung nach § 13b UStG und ein Steuersatzwechsel zwischen Abschlag und Schlussrechnung. Ein Storno ist dort eine Rechnungskorrektur mit Verweis auf die aufgehobene Rechnung, und Abschlagsrechnungen werden als Positionen mit der Menge minus eins abgezogen, jede zu ihrem Steuersatz, so wie das PDF sie ausweist. Die Einzelheiten stehen in ADR 0007.

**Das ZUGFeRD-PDF ist das PDF der Rechnung mit der E-Rechnung darin.** `GET /documents/:id/zugferd` nimmt das PDF, das die Rechnung aufbewahrt, oder druckt es beim ersten Mal und bewahrt es dann als ihr PDF auf. Daran hängt es die E-Rechnung im Profil EN 16931 als `factur-x.xml` und macht aus dem Ganzen ein PDF/A-3, wie ZUGFeRD 2 und Factur-X es verlangen: Kennung, Farbprofil sRGB, Metadaten in XMP, die sagen, welcher Anhang die Rechnung ist. Die Seite bleibt die gedruckte: ein Kunde, der erst das PDF und später das ZUGFeRD-PDF bekommt, sieht zweimal dieselbe Rechnung. Das ZUGFeRD-PDF verlangt nur, was die Norm verlangt, und nicht, was XRechnung darüber hinaus will: eine Rechnung ohne Käuferreferenz geht als ZUGFeRD-PDF, aber nicht als XRechnung. Ob das Ergebnis als PDF/A-3 und als ZUGFeRD gültig ist, prüft die CI mit Mustang an Rechnungen, die der echte Renderer druckt. Eine davon trägt ein halbtransparentes Logo, denn an Transparenz scheitert PDF/A am ehesten. Am Bildschirm einer festgeschriebenen Rechnung stehen beide Dateien zum Herunterladen, das ZUGFeRD-PDF für Unternehmen, die XRechnung für Behörden.

**Was eine XRechnung verlangt, zeigt der Bildschirm schon am Entwurf.** Sie will mehr als § 14 UStG: eine Käuferreferenz des Kunden, bei einer Behörde die Leitweg-ID, seine E-Mail-Adresse, im Briefkopf Telefon, E-Mail und Bankverbindung, und vom Betrieb eine Umsatzsteuer-Identifikationsnummer oder eine Handelsregisternummer, weil die Steuernummer allein der Norm nicht genügt. Die Käuferreferenz steht dafür bei den Stammdaten des Kunden. Was fehlt, steht an der Rechnung, jeweils mit der Regel der Norm, und mit der Rechnung festgehalten wird, was an diesem Tag galt (Fassung 6 von `DocumentContent`).

**Ab wann die E-Rechnung Pflicht ist, steht im Regelpaket `e-invoice` und nicht im Code.** Seit 2025 verlangt § 14 Abs. 2 Satz 2 Nr. 1 UStG sie zwischen Unternehmen im Inland, und § 27 Abs. 38 UStG lässt Übergänge zu: für eine Leistung aus 2025 und 2026 mit einer Rechnung, die bis Ende 2026 übermittelt wird, für eine Leistung aus 2027 mit einer Rechnung, die bis Ende 2027 übermittelt wird, dann aber nur für einen Betrieb, dessen Gesamtumsatz im Vorjahr 800.000 Euro nicht überstieg. Diesen Umsatz kennt OpenGewerk vor der Buchhaltung aus Phase 3 nicht, deshalb erklärt der Betrieb ihn im Büro unter "Steuern", gespeichert als Einstellung `e_invoice.transition_claimed` über `POST /settings/parameters`; ohne Erklärung gilt die Pflicht. Die erste Erklärung gilt ab dem ersten Tag des Übergangs, auch wenn sie später kommt, denn der Umsatz des Vorjahres steht für das ganze Jahr fest; eine Rücknahme gilt ab dem Tag, an dem sie kommt. Jahr, Grenze und Frist liest der Bildschirm aus dem Regelpaket, und eine Rechnung für Arbeit aus 2027 verweist auf ihrer Karte "E-Rechnung" dorthin. Die E-Rechnung an ein Unternehmen stellt OpenGewerk schon vor der Pflicht aus. Solange sie nicht Pflicht ist, wird eine Rechnung auch festgeschrieben, wenn der E-Rechnung noch etwas fehlt; danach nicht mehr, denn dann wäre das PDF allein keine ordnungsgemäße Rechnung.

Was noch fehlt: die Gutschrift als E-Rechnung. Verschickt wird die E-Rechnung über die Karte "Per E-Mail" am Beleg, siehe das Kapitel zur Benachrichtigung. Der Empfang von E-Rechnungen gehört zu Phase 3.

### Aufgaben

Eine Aufgabe ist etwas, das eine Person bis zu einem bestimmten Tag erledigen soll. Abschnitt 2 der Feature-Gliederung verschiebt sie ausdrücklich aus dem CRM in die Querschnittsfunktionen, und das ist die eigentliche Aussage: Aufgaben gehören keinem Modul, sie hängen an allem. Eine Aufgabe hat einen Text, einen Fälligkeitstag, eine verantwortliche Person, den Status offen oder erledigt und auf Wunsch eine Notiz. Sie kann an einem Kunden, einem Objekt oder einem Auftrag hängen, muss es aber nicht.

**Sichtbar dort, wo sie hängt, und in einer eigenen Liste.** Kunde, Objekt und Auftrag haben im Büro einen Abschnitt "Aufgaben", und eine Aufgabe, die dort entsteht, hängt an diesem Datensatz. Am Auftrag nimmt sie Kunde und Objekt mit, damit sie auf allen drei Bildschirmen steht. Unter "Aufgaben" in der Navigation steht die Liste für den Morgen: erst die eigenen, dann was bei den anderen offen ist, jeweils nach Fälligkeit. Überfällig steht in Worten da und nicht nur in Rot. Auf der Baustelle stehen die eigenen offenen Aufgaben über den Aufträgen, und an jedem Auftrag lässt sich eine notieren, für sich selbst oder fürs Büro.

**Eine Aufgabe reist wie alles, was auf dem Gerät entsteht.** Anlegen, erledigen und weitergeben gehen durch den Postausgang, auch im Keller, und zwei Geräte an verschiedenen Feldern derselben Aufgabe kommen beide durch. Lesen und schreiben dürfen alle drei Rollen (`task.read`, `task.write`), denn eine Aufgabe schreibt, wem etwas auffällt, für den, der es tun muss. Löschen bietet die Oberfläche nicht an: was erledigt ist, bleibt an seinem Datensatz stehen und fällt aus den Listen für den Morgen heraus.

**Wer sie geschrieben hat, sagt die Datenbank.** Ein Trigger setzt `created_by` beim Anlegen auf den Benutzer der Anfrage und hält den Wert bei jeder Änderung fest. Ein Gerät, das selbst einen Urheber mitschickt, bekommt einen Konflikt `set_by_server`, sonst ließe sich eine Aufgabe jemand anderem unterschieben. Eine Transaktion, die für keinen Menschen handelt, schreibt eine Aufgabe ohne Urheber. Das ist die Naht für die Fristen-Engine aus Phase 2: sie legt ihre Aufgaben über dieselbe Tabelle und dieselben Trigger an und braucht keinen zweiten Weg.

**Verantwortlich ist jemand, der im Betrieb arbeitet.** Der Fremdschlüssel `tasks_assignee_works_here` zeigt auf Betrieb und Benutzer der Mitgliedschaft zusammen und findet damit nur eine Zugehörigkeit zu diesem Betrieb, auch an jeder Prüfung der Anwendung vorbei. Davor prüft der Abgleich, ob die Person dazugehört und nicht gesperrt ist, und lehnt sonst genau diesen einen Vorgang ab. Der Schlüssel allein ließe die ganze Übertragung scheitern, und ein Postausgang, der an einer Aufgabe hängen bleibt, schickt auch den Regiebericht dahinter nicht mehr. Die Namen zur Auswahl liefert `GET /tasks/assignees`, gesperrte Zugänge eingeschlossen, damit eine alte Aufgabe ihren Namen behält; auswählen lassen sie sich nicht.

Was nicht dazugehört: automatisch erzeugte Aufgaben, die mit den Fristen in Phase 2 kommen, eine Zuweisung über Betriebsgrenzen und Kanban oder Plantafel. Die Benachrichtigung der verantwortlichen Person per E-Mail kommt mit #81.

### Steuern

Was ein Betrieb über seine eigene Besteuerung erklärt, steht im Büro unter "Steuern", und ändern kann es nur der Inhaber. Es sind drei Erklärungen: die Kleinunternehmerregelung nach § 19 UStG, die Ist-Versteuerung nach § 20 UStG und der Übergang von 2027 für die E-Rechnung. Alle drei hängen an einem Umsatz, den OpenGewerk vor der Buchhaltung aus Phase 3 nicht kennt, und die Ist-Versteuerung obendrein an einer Entscheidung des Finanzamts. Deshalb erklärt der Betrieb sie, statt dass die Anwendung sie schätzt.

**Jede Erklärung gilt ab einem Tag, und was davor galt, bleibt.** Gespeichert wird sie als Einstellung mit Gültigkeitszeitraum (`small_business.claimed`, `cash_accounting.permitted`, `e_invoice.transition_claimed`), und ein neuer Zeitraum beginnt immer nach dem letzten. Den Tag wählt der Betrieb selbst: die Kleinunternehmerregelung hängt am Umsatz eines Kalenderjahres und beginnt in der Regel am 1. Januar, sie endet aber schon an dem Tag, an dem der Umsatz im laufenden Jahr die Grenze überschreitet, und die Ist-Versteuerung beginnt an dem Tag, den das Finanzamt nennt. Nur beim Übergang von 2027 steht der Tag fest, weil der Umsatz des Vorjahres für das ganze Jahr gilt. Grenzen und Fundstellen liest der Bildschirm aus den Regelpaketen `small-business`, `cash-accounting` und `e-invoice`, nicht aus dem Code.

**Was die Erklärungen bewirken.** Mit der Kleinunternehmerregelung schlägt OpenGewerk neue Belege ohne Umsatzsteuer vor, mit dem Hinweis auf die Steuerbefreiung, und eine Rechnung geht als PDF hinaus; am Entwurf lässt sich das ändern. Die Ist-Versteuerung ändert heute genau eines: ab dem 1. Januar 2028 trägt jede Rechnung mit ausgewiesener Umsatzsteuer die Angabe „Versteuerung nach vereinnahmten Entgelten“, die § 14 Abs. 4 Satz 1 Nr. 6a UStG von da an verlangt, im PDF wie in der E-Rechnung. Ab demselben Tag darf der Kunde die Vorsteuer aus einer solchen Rechnung erst abziehen, wenn er gezahlt hat, und daran erkennt er es. Gelesen wird die Erklärung am Belegdatum und mit dem Festschreiben eingefroren. Eine Rechnung nach § 19 oder § 13b trägt die Angabe nicht, dort weist sie keine Steuer aus; diese Lesart steht mit auf der Liste für #31. Wofür der Unterschied zwischen Soll- und Ist-Versteuerung eigentlich zählt, der Zeitraum, in dem die Steuer anzumelden ist, gehört zur Umsatzsteuer-Voranmeldung der Buchhaltung, die dieselbe Einstellung liest.

### Benachrichtigung per E-Mail

Abschnitt 2 der Feature-Gliederung sieht Benachrichtigungen aus genau zwei Quellen vor, der Fristen-Engine und Statuswechseln, und dazu einen Satz, der wichtiger ist als die Funktion selbst: keine modulspezifischen Erinnerungen. Wer eine Mail dort verschickt, wo sie gebraucht wird, hat am Ende sieben Absender, sieben Vorlagen und sieben Stellen für die Adresse des Betriebs. Deshalb gibt es einen Absender und einen Weg zu ihm.

**Auslöser, keine Aufrufe.** Wer jemanden benachrichtigen will, meldet in `notifications/` einen Anlass, heute eine fällige Aufgabe. Dort wird entschieden, wer es erfährt und was die Nachricht sagt, und sie landet als Zeile in `mail_outbox`. Verschickt wird nur aus `mail/`. Ein Test in `mail/boundaries.test.ts` wird rot, sobald eine Datei außerhalb dieser beiden Ordner nodemailer einbindet oder in den Postausgang schreibt.

**Ein Postausgang, der einen Ausfall übersteht.** Ein Job läuft jede Minute über alle Betriebe, schreibt, was fällig geworden ist, und verschickt, was wartet. Eine Nachricht wird in einer kurzen Transaktion beansprucht, außerhalb davon verschickt und danach als versendet vermerkt, so bleibt keine Transaktion offen, während ein Mailserver sich Zeit lässt. Antwortet er nicht, wartet die Nachricht und wird wieder versucht, nach einer, fünf, fünfzehn und sechzig Minuten, dann alle drei Stunden, zwanzigmal und damit gut zwei Tage lang. Eine Antwort, die sich nicht ändern wird, etwa ein Postfach, das es nicht gibt, beendet die Versuche sofort. Gelöscht wird keine Nachricht, auch keine gescheiterte: sie bleibt mit dem letzten Fehler stehen. Stirbt der Prozess zwischen Versand und Vermerk, geht die Nachricht nach zehn Minuten ein zweites Mal hinaus, und zweimal ist besser als nie.

**Was bisher verschickt wird.** Eine Aufgabe erreicht die verantwortliche Person am Morgen ihres Fälligkeitstags, ab sechs Uhr, einmal je Aufgabe und Tag. Wird sie verschoben, gibt es am neuen Tag eine neue Nachricht; ist sie erledigt, gelöscht oder die Person im Betrieb gesperrt, keine. Eine Aufgabe, deren Tag beim Anlegen schon vorbei war, bekommt keine, sonst fände, wer den Versand einschaltet, einen Stapel alter Erinnerungen im Postfach.

**Der Beleg an den Kunden.** Am Bildschirm eines festgeschriebenen Belegs steht die Karte "Per E-Mail". Die Adresse des Kunden ist eingetragen, eine andere gilt nur für diese eine Nachricht, und darunter steht, was mit dem Beleg schon verschickt wurde und ob es ankam. Verschicken darf, wer festschreiben darf: was als Aussage des Betriebs zum Kunden geht, ist Sache des Büros. Welche Datei mitgeht, folgt aus dem Kunden wie das Format der Rechnung. Ein Unternehmen im Inland bekommt das ZUGFeRD-PDF, weil es die E-Rechnung ist und zugleich eine Seite, die ein Mensch lesen kann; alle anderen bekommen das PDF. Fehlt der E-Rechnung etwas, geht das PDF, solange die E-Rechnung nicht Pflicht ist, danach wird der Versand mit der Liste der Lücken abgelehnt. Die Datei ist die, die der Beleg aufbewahrt (`DocumentFiles.issued`): wer die Rechnung später herunterlädt, bekommt dieselben Bytes wie die Mail, und läuft der Renderer gerade nicht, wartet die Nachricht wie auf einen Mailserver. Solange eine Nachricht mit dem Beleg an dieselbe Adresse noch wartet, nimmt die Route keine zweite an; ist sie hinaus, lässt sich der Beleg noch einmal schicken. Der Tag, an dem eine Rechnung hinausging, steht damit im Postausgang, und nach der Übermittlung fragt der Übergang in § 27 Abs. 38 UStG.

**Der unterschriebene Regiebericht, auf Wunsch sofort.** Unter "E-Mail" im Büro schaltet der Inhaber ein, dass ein Regiebericht, den der Kunde auf der Baustelle unterschreibt, gleich danach an diesen Kunden geht, als PDF mit der Unterschrift (`report.mail_on_signature`). Die Unterschrift ist dafür der Auslöser: der Job findet neu unterschriebene Berichte und schreibt je Bericht eine Nachricht, wenn die Einstellung am Tag der Unterschrift an war und beim Kunden eine Adresse steht. Geschaltet wird ab heute und nie rückwirkend, und der Job sieht nur Unterschriften der letzten 48 Stunden an; wer einschaltet, verschickt damit keinen Stapel alter Berichte. Fehlt die Adresse, bleibt der Bericht beim Büro und lässt sich über die Karte "Per E-Mail" verschicken, wie jeder festgeschriebene Beleg auch schon vor seiner Nummer. Derselbe Bildschirm sagt, ob die Instanz überhaupt einen Mailserver hat und von welcher Adresse sie verschickt.

**Der Betrieb steht in jeder Nachricht.** Als Absender erscheint der Name aus dem Briefkopf, Antworten gehen an die E-Mail-Adresse aus dem Briefkopf, und am Ende steht der Betrieb mit Anschrift und Kontakt. Die Adresse, von der verschickt wird, ist die der Instanz aus `MAIL_FROM`; auf einer Instanz mit mehreren Betrieben sieht so jeder Kunde den Namen seines Betriebs.

### Audit-Log

Jede Änderung an jeder Tabelle steht im Log, eine Zeile je Feld, das sich wirklich geändert hat: alter Wert, neuer Wert, Zeitpunkt, Benutzer und Anlass. Die Felder einer Änderung teilen sich eine Kennung, damit die Frage "und was hat sich im selben Moment noch bewegt" beantwortbar bleibt.

**Geschrieben wird von einem Datenbank-Trigger, nicht von der Anwendung.** Das ist die Entscheidung, an der hier alles hängt. Eine Zeile im Server fängt genau dort nichts, wo der Server umgangen wird, und eine Änderung über `psql` oder aus einer Migration ist der Fall, für den ein Log überhaupt existiert. Der Trigger hängt an jeder Tabelle, angebracht über eine Schleife über den Katalog statt über eine Liste; ein Test stellt dieselbe Frage später noch einmal an den Katalog, damit eine Tabelle aus einer künftigen Migration nicht still durchrutscht.

Kommt die Änderung über die Anwendung, stehen Benutzer und Anlass dabei. Kommt sie nicht von dort, steht der Benutzer leer, und das ist kein Loch, sondern der Befund: daneben steht die Datenbankrolle, und die sagt, dass jemand direkt an der Datenbank war. Den Anlass setzt heute die HTTP-Schicht auf das Recht, das die Route verlangt hat, also etwa `document.issue`. Ein Anlass, den ein Mensch eintippt ("Storno wegen Zahlendreher"), ist die bessere Antwort auf dieselbe Frage und gehört zu der Oberfläche, die danach fragt.

**Ergänzt wird das Log, mehr nicht.** Ändern, Löschen und Leeren sind durch einen eigenen Trigger versperrt, auch für den Eigentümer der Tabelle, und die Anwendungsrolle hat auf der Tabelle nur Leserecht. Das verhindert eine Änderung. Es verhindert sie aber nur, solange der Trigger da ist, und wer Rechte auf der Datenbank hat, schaltet ihn ab.

**Deshalb die Hashkette.** Jeder Eintrag wird zusammen mit dem Hash seines Vorgängers gehasht. Eine Änderung im Nachhinein ist damit nicht mehr unsichtbar: entweder passt der Eintrag nicht mehr zu seinem eigenen Fingerabdruck, oder der folgende zeigt ins Leere. Eine Prüfung läuft die Kette eines Mandanten ab und nennt die erste Stelle, an der es nicht mehr aufgeht. Gehasht wird die ganze Zeile ohne ihren eigenen Hash, eine später hinzugefügte Spalte ist also automatisch mit abgedeckt, und dieselbe Funktion berechnet den Fingerabdruck beim Schreiben und beim Prüfen; zwei Definitionen würden auseinanderlaufen.

Die Kette läuft je Mandant. Das ist keine Feinheit, sondern folgt aus der Mandantentrennung: ein Mandant sieht nur seine eigenen Einträge, und eine Kette, die er nicht lesen kann, kann er auch nicht nachrechnen. Die Reihenfolge entsteht an einer Zähler-Zeile je Mandant, nach demselben Muster wie bei den Nummernkreisen. Der Preis ist, dass zwei gleichzeitige Schreibvorgänge desselben Betriebs aufeinander warten; bei einem Handwerksbetrieb ist das nichts.

**Und was auch die Kette nicht leistet.** Wer den Trigger abschalten kann, kann auch jeden Eintrag ab der geänderten Stelle neu schreiben, und dann geht die Kette wieder auf. Sie macht eine kleine Korrektur unmöglich zu verstecken und eine große teuer. Ein echter Beweis wird sie erst gegen einen Hash, der woanders liegt, etwa in einem Backup: der schreibt alles fest, was vor ihm geschrieben wurde. Das gehört zum Backup-Issue, nicht hierher.

### Offline-Datenschicht

Ein Monteur im Keller hat kein Netz und muss trotzdem arbeiten können. Jede Änderung wird deshalb auf dem Gerät als Vorgang in eine Warteschlange gelegt und später der Reihe nach verschickt. Die Schlüssel entstehen auf dem Gerät (UUIDv7), bevor irgendeine Verbindung da ist.

**Ein Vorgang trägt für jedes Feld mit, was das Gerät dort gesehen hat.** Das ist die Entscheidung, an der alles andere hängt. Der Server vergleicht diesen Wert mit dem aktuellen: stimmt er, hat niemand dazwischengefunkt und die Änderung geht durch. Stimmt er nicht, ist das ein Konflikt. Zwei Geräte, die verschiedene Felder desselben Datensatzes geändert haben, gehen beide durch, ohne dass jemand etwas entscheiden muss. Das ist der Abgleich auf Feldebene aus ADR 0005, und er braucht dafür keine Uhr auf jedem Feld.

**Ein Vorgang wirkt ganz oder gar nicht.** Sobald eines seiner Felder kollidiert, landet nichts davon, und die ganze beabsichtigte Änderung geht in die Konfliktliste. Halb anzuwenden ergäbe einen Datensatz, den keines der beiden Geräte je gemeint hat.

**Konflikte werden nicht aufgelöst, sondern gezeigt.** Dafür wurden CRDTs in ADR 0005 abgelehnt: eine Mechanik, die alles selbst entscheidet, entscheidet die Fälle, die sie falsch trifft, genauso still wie die richtigen. Die Konfliktliste hat drei Bilder nebeneinander: was das Gerät wollte, was es zu sehen glaubte, und was tatsächlich dastand.

Was ein Gerät ohne Verbindung darf, steht je Entität fest. Stammdaten dürfen angelegt, aber nicht geändert werden; ein Beleg darf geschrieben werden, solange er Entwurf ist, und keinen Moment länger. Festschreiben gibt es offline gar nicht, es vergibt eine Nummer und macht den Beleg fest, und das passiert auf dem Server.

**Dieselbe Übertragung zweimal ändert nichts.** Jeder Vorgang hat eine Kennung vom Gerät, der Server merkt sich jede, die er gesehen hat. Ein Gerät, dem die Verbindung nach dem Commit abbricht, schickt seine Warteschlange noch einmal, und das ist der Normalfall, nicht die Ausnahme.

**Gelöscht wird durch Markieren, nicht durch Entfernen.** Eine entfernte Zeile ist eine Zeile, von der ein Gerät, das gerade offline war, nie wieder etwas hört: der Abgleich liefert, was sich geändert hat, und eine Zeile, die es nicht mehr gibt, ist nicht darunter.

Der Stand, ab dem ein Gerät nachfragt, ist eine Nummer je Mandant, die in der Reihenfolge hochzählt, in der Transaktionen festschreiben. Ein Stand auf Zeitstempeln würde still eine Zeile überspringen, deren Transaktion früh begann und spät festschrieb.

**Was ein Datensatz vom Server beim Anlegen bekommt, weiß das Gerät vorher.** Ein Regiebericht, der im Keller entsteht, hat bis zur ersten Verbindung keinen Status, denn den setzt der Server. Die Regel "nur solange Entwurf" fand deshalb nichts und lehnte schon die erste Position des eigenen Berichts ab. Die Abgleichregel nennt seitdem unter `createdAs` den Startzustand der Felder, die nur der Server schreibt, und das Gerät legt ihn unter jeden Datensatz, den es selbst angelegt hat. Ein Test in `domain` hält fest, dass jede Regel auf ein solches Feld einen Startzustand hat.

**Eine neue Fassung, die eine Entität mehr kennt, fragt einmal von vorn.** Eine Fassung überspringt die Zeilen einer Entität, die sie nicht kennt, und schiebt ihren Stand trotzdem weiter. Beim Update läuft auf dem Gerät aber zuerst noch die alte Fassung aus dem Service Worker, und die hat genau das mit den ersten Unterschriften getan: nach "Jetzt übernehmen" zeigte die neue Fassung unterschriebene Berichte ohne Unterschrift. Das Gerät merkt sich deshalb, welche Entitäten die Fassung kannte, die den Stand geschrieben hat. Kennt die laufende eine mehr, oder fehlt die Liste, gilt der Stand nicht, und der nächste Abgleich holt alles. Das kostet einen vollen Abruf und nichts sonst, denn ein Abruf überschreibt nur.

Die Warteschlange liegt seit dem 20.09.2026 wirklich im Browser, in IndexedDB, je Betrieb eine eigene Datenbank. Die Regeln liegen in `domain`, und genau deshalb rechnet das Gerät dieselbe Antwort aus, bevor es etwas schickt: eine Belegposition an einer festgeschriebenen Rechnung wird abgelehnt, solange das Formular noch offen ist, und nicht zwei Stunden später auf einem Bildschirm, den niemand mehr ansieht.

### Regel-Engine

Gesetzliche Parameter stehen nicht im Quelltext, sondern als Datensätze in Regelpaketen unter `packages/domain/src/rules/data/`. Jeder Datensatz hat einen Gültigkeitszeitraum und die Fundstelle, aus der er stammt. Die Fundstelle ist keine Zierde: sie ist der Unterschied zwischen einer Zahl, die jemand nachprüfen kann, und einer, die jemand glauben muss.

**Jede Abfrage braucht einen Tag, und es gibt keinen Weg, ohne einen zu fragen.** Diese eine fehlende Bequemlichkeit trägt die historische Anwendung aus Abschnitt 1.7: eine Rechnung von 2027 kann 2030 nicht versehentlich nach den Sätzen von 2030 beurteilt werden, weil keine Funktion in dieser Engine weiß, welcher Tag heute ist.

**Ein neuer Steuersatz ist ein Eintrag, kein Release.** Der Basiszinssatz nach §247 BGB ist das beste Beispiel: die Bundesbank setzt ihn zum 1. Januar und zum 1. Juli neu fest, und jedes Mal ist das eine Zeile in einer Datei, die jeder gegen die Bekanntmachung prüfen kann, statt einer Änderung an einer Rechenfunktion.

**Gerechnet wird in ganzen Zahlen**, in Basispunkten und in Cent. Neunzehn Prozent als 0,19 und ein Betrag als 22000.00 liefern jede Rechnung dem binären Fließkomma aus, und dort sind neunzehn Prozent von hundert Euro nicht verlässlich neunzehn Euro. Gerundet wird an genau einer Stelle, kaufmännisch und von der Null weg, damit eine Gutschrift die Rechnung spiegelt, die sie korrigiert, statt einen Cent daneben zu liegen.

**Wo keine Regel hinterlegt ist, gibt es keine Antwort.** Die Engine rechnet nicht mit einem erfundenen Wert weiter. Ein erfundener Zinssatz auf einer echten Rechnung ist schlimmer als ein fehlender, und das Paket sagt in sich selbst, bis wann es reicht.

Davon getrennt stehen die **mandantenbezogenen Parameter**: ob ein Betrieb die Kleinunternehmerregelung in Anspruch nimmt, ob ihm das Finanzamt die Ist-Versteuerung gestattet hat, ob er den Übergang von 2027 erklärt und welches Zahlungsziel er auf seine Rechnungen schreibt. Die liegen in der Datenbank, tragen ebenfalls einen Gültigkeitszeitraum und werden nicht geändert, sondern ab einem Tag abgelöst. Ein Betrieb kann damit nie eine gesetzliche Größe verschieben: der Schlüssel ist eine Aufzählung von Einstellungen, und keine Regel steht darin.

> **Stand der Prüfung:** Am 19.09.2026 sind alle 26 Datensätze gegen ihre Fundstelle gehalten worden, die Basiszinssätze gegen die Tabelle der Bundesbank, die übrigen gegen die datierten Gesetzesfassungen. Kein eingetragener Wert wich von seiner Fundstelle ab. Was dabei aufgefallen ist, steht in Issue #31: der Nenner von 360 Tagen in der Verzugszinsrechnung trägt als einzige Zahl der Engine keine Fundstelle, die Stichtage von 2014 hängen nach Art. 229 § 34 EGBGB am Schuldverhältnis und nicht am Tag, und mehrere gesetzliche Größen, die Abschnitt 1.7 des Konzepts aufzählt, stehen noch in keinem Paket. **Das ersetzt die fachkundige Abnahme nicht.** Eine Vorprüfung sagt, dass die Zahl zur Fundstelle passt; ob die Fundstelle die richtige ist und ob die Vereinfachungen tragen, sagt sie nicht. Am 21.09.2026 kam das Paket `invoice` mit vier Datensätzen dazu, die Grenze der Kleinbetragsrechnung nach §33 UStDV und der Stichtag der vereinfachten Rechnung für Kleinunternehmer nach §34a UStDV, beide auf dieselbe Weise gegen den Gesetzestext und die Änderungsgesetze gehalten. Am selben Tag kam mit #75 das Paket `e-invoice` dazu: ab wann die E-Rechnung Pflicht ist, die beiden Übergänge nach § 27 Abs. 38 UStG mit der Grenze von 800.000 Euro und die Ausnahmen für Kleinbetrag und Kleinunternehmer. Wortlaut und Gliederung sind bei gesetze-im-internet.de nachgesehen; auch dieses Paket gehört vor die Abnahme in #31. Am 22.09.2026 sind die dreizehn Datensätze beider Pakete noch einmal gegen den Wortlaut gehalten worden, dazu gegen das BMF-Schreiben vom 15.10.2025, die FAQ des BMF zur E-Rechnung und Abschnitt 14.8 UStAE. Kein Wert wich ab. Vier Lesarten brauchen eine Entscheidung, darunter der Abzug gestellter statt vereinnahmter Abschläge; das Protokoll steht in #31. Am selben Tag kamen das Paket `cash-accounting` mit der Umsatzgrenze der Ist-Versteuerung nach § 20 Satz 1 Nr. 1 UStG seit 2012 und im Paket `invoice` der Stichtag der Angabe nach § 14 Abs. 4 Satz 1 Nr. 6a UStG dazu, gegen den Gesetzestext und die datierten Fassungen samt Änderungsgesetzen gehalten. Auch sie gehören vor die Abnahme in #31.

### Oberfläche

Eine Codebasis, zwei Einstiege, wie ADR 0004 es festlegt. `/` ist das Büro, `/m` ist die Baustelle. Sie teilen sich das Domänenpaket, den Abgleich-Client, die Anmeldung und jede einzelne Komponente; verschieden sind Dichte, Navigation und der Zuschnitt der Bildschirme.

**Die beiden Einstiege sind nicht zwei Bildschirmbreiten, sondern zwei Eingabegeräte.** Das Büro bekommt 34 Pixel hohe Bedienelemente und dichte Tabellen, die Baustelle 60 Pixel und eine Hauptaktion je Bildschirm. Gesteuert wird das über ein Attribut an der Wurzel und nicht über eine Medienabfrage, denn ein breites Tablet auf dem Dach ist immer noch eine Baustelle. Beim ersten Start schlägt die Anwendung den passenden Einstieg vor und merkt sich, was jemand wählt, auch das Bleiben: ein Vorschlag, der jeden Morgen wiederkommt, ist einer, den man wegklickt, ohne ihn zu lesen.

**Der Abgleich ist immer sichtbar, als Leiste und nie als Hinweis, der verschwindet.** Sie sagt, ob alles angekommen ist, wie viel noch auf dem Gerät liegt und warum. Ein Konflikt bekommt einen eigenen Bildschirm mit drei Spalten: was das Gerät wollte, was inzwischen im System steht, und was das Gerät vorfand, als jemand es geändert hat. Die dritte Spalte ist die, die die beiden anderen erklärt. Entschieden wird auf dem Gerät, und die Entscheidung geht als gewöhnliche Änderung durch denselben Postausgang, damit sie dieselben Regeln passiert und im selben Audit-Log landet.

**Gelesen wird lokal, geschrieben auf zwei Wegen.** Alles, was ein Gerät anzeigt, kommt aus IndexedDB, mit dem Postausgang darübergelegt. Was ohne Verbindung entstehen darf, geht in die Warteschlange; was eine Verbindung braucht, geht direkt an die Route, der der Datensatz gehört. Stammdaten sind der zweite Fall: ein Monteur darf einen Kunden anlegen, den es noch nicht gibt, und die Anschrift eines bestehenden korrigiert das Büro, das eine Verbindung hat.

**Der Postausgang wird über den Serverstand gelegt, nicht in ihn hineingeschrieben.** Das ist die Entscheidung, an der die Schicht hängt. Lehnt der Server einen Vorgang ab, ändert sich an dem Datensatz dort nichts, der nächste Abgleich bringt also nichts mit, und eine in die lokale Kopie geschriebene Änderung stünde für immer auf dem Bildschirm, ohne irgendwo sonst zu existieren. Übereinandergelegt heilt es sich von selbst: der Vorgang fällt aus der Warteschlange, und übrig bleibt, was der Server wirklich hält.

**Das Bündelbudget wird gemessen, nicht gewünscht.** ADR 0004 nennt eine Zahl: unter 300 kB gzip beim ersten Laden auf der Baustelle. `pnpm --filter @opengewerk/web run budget` liest die gebauten HTML-Dateien, zählt zusammen, was der Browser holt, bevor die Anwendung läuft, und bricht ab, wenn es zu viel wird. Am 21.09.2026 nach dem ZUGFeRD-PDF aus #75 gemessen: **Baustelle 140 kB, Büro 165 kB**. Die Schriften werden daneben ausgewiesen und nicht mitgezählt, sie kommen je Schnitt nach und blockieren nichts.

**Vor der Anmeldung stehen drei Bildschirme, die es nur gibt, solange sie gebraucht werden.** Eine leere Instanz zeigt die Ersteinrichtung statt der Anmeldung. Ein Konto, dessen Rolle einen zweiten Faktor verlangt, richtet ihn ein, bevor es einen Betrieb wählt. Und wer einen Einladungslink bekommen hat, löst ihn dort ein und wählt dabei sein Passwort selbst. Alle drei sitzen im Tor und nicht hinter der Navigation, denn wer dort steht, erreicht keinen einzigen Bildschirm dahinter. Nachträglich geht der zweite Faktor über "Konto" im Büro, wo auch die eigene Geräteliste steht.

**Die gebaute Oberfläche liefert derselbe Prozess aus, der auch die API bedient.** Ein zweiter Container davor wäre eine weitere Sache, die eine Installation einrichten und aktualisieren muss. Zwei Hüllen gibt es trotzdem: alles unter `/m` kommt mit der Baustellen-Hülle zurück, alles andere mit der des Büros. Ein tiefer Link in die Baustelle, der mit der Bürohülle beantwortet wird, öffnet auf einem Telefon eine Oberfläche für Maus und Tastatur.

Was ausdrücklich noch fehlt und je ein eigenes Issue bekommt: Prüfprotokoll, Zeiterfassung, der Aufbau unterhalb der Anlage (Verteiler, Feld, Stromkreis) und die Plantafel.

## Betrieb

Betriebsfähigkeit gehört zum Produkt, nicht in eine Anleitung. Auf einer leeren
Maschine mit Docker reichen drei Zeilen:

```bash
cp docker/.env.example docker/.env
```

Dann die fünf Passwörter in `docker/.env` ersetzen, jedes einzeln erzeugt mit
`openssl rand -hex 32`, dazu `TRUSTED_ORIGINS` auf die Adresse setzen, unter der
die Instanz erreichbar sein wird. Danach starten:

```bash
docker compose -f docker/compose.yaml up -d
```

Danach läuft eine migrierte Instanz auf `127.0.0.1:3000`, und
`curl http://127.0.0.1:3000/health` antwortet mit `{"status":"bereit"}`. Im
Browser steht dort die Oberfläche: `/` für das Büro, `/m` für die Baustelle.

### Der erste Zugang

Im Browser, und sonst nirgends nötig. Eine Instanz, auf der es weder einen
Betrieb noch ein Konto gibt, zeigt statt der Anmeldung die Einrichtung: Name des
Betriebs, Name und E-Mail der Person, die ihn führt, und ein Passwort, das sie
selbst wählt. Daraus entstehen in einem Zug der Betrieb, das Konto und die
Zugehörigkeit dazwischen, alle drei in einer Transaktion.

Direkt danach kommt der zweite Faktor, denn das erste Konto ist ein `owner`, und
für diese Rolle ist er Pflicht (ADR 0006). Ein QR-Code für die
Authenticator-App, derselbe Schlüssel darunter zum Abtippen und zehn
Wiederherstellungscodes, die einmal zu sehen sind. Erst wenn ein Code aus der App
gestimmt hat, gilt der Faktor als eingerichtet: ein falsch abgetippter Schlüssel
sperrt sonst die einzige Person aus, die diese Instanz hat.

**Die Einrichtung verschwindet, sobald es einen Betrieb oder ein Konto gibt.**
Die Bedingung ist eine Abfrage an die Datenbank und kein Schalter, den jemand
zurückstellen kann, und sie wird unter einer Sperre gestellt: zwei Leute, die
den Bildschirm gleichzeitig öffnen, legen einen Betrieb an und nicht zwei. Ein
zweiter Versuch bekommt 409 und den Satz dazu. `CLOSED=true` schaltet sie mit
ab, dann gibt es die Route gar nicht.

### Jeder weitere Zugang

Im Büro, unter "Zugänge", und nur für den Inhaber: wer Rollen vergeben kann,
kann sich selbst die Rolle des Inhabers geben, deshalb liegt das nicht bei der
Bürokraft. Dort stehen die Konten des Betriebs mit Rollen, Zustand und der
letzten Anmeldung, daneben die offenen Einladungen.

**Ein Passwort vergibt das Büro nicht.** Wer angelegt wird, bekommt einen
Einmal-Link, und den gibt das Büro weiter, wie es die Person eben erreicht. Auf
der anderen Seite wählt sie ihr Passwort selbst; niemand im Betrieb bekommt es
je zu sehen. Ein Passwort, das ein Kollege kennt und das dann drei Jahre bleibt,
ist schlechter als eines, das niemand kennt.

Der Link gilt sieben Tage, funktioniert genau einmal und lässt sich zurückziehen.
Gespeichert wird von ihm nur eine Prüfsumme, er steht also genau in dem Moment
auf dem Bildschirm, in dem er entsteht, und danach nie wieder. Wer ihn verlegt,
erzeugt einen neuen; der alte wird dabei ungültig.

**Gesperrt statt gelöscht.** Ein gesperrter Zugang kommt nicht mehr hinein, und
zwar sofort: die laufenden Sitzungen dieses Betriebs werden beendet, nicht erst
beim Ablauf. In jeder Historie und im Audit-Log bleibt die Person sichtbar, denn
ein gelöschtes Konto nähme allem den Namen, was sie je geschrieben hat. Wer in
zwei Betrieben arbeitet, wird in beiden getrennt gesperrt: die Sperre hängt an
der Zugehörigkeit und nicht am Konto.

**Der letzte Inhaber lässt sich weder sperren noch entmachten.** Sonst schließt
sich ein Betrieb aus seiner eigenen Benutzerverwaltung aus, und der Weg zurück
führt über psql.

Wer Inhaber wird, braucht ab dem nächsten Aufruf einen zweiten Faktor. Der
Bildschirm sagt das, bevor das Häkchen gesetzt wird, und nicht der 403 danach.

Über die Kommandozeile geht es weiterhin, und dafür bleibt es auch: das ist der
Rückweg, wenn sich jemand ausgesperrt hat, und der einzige Weg auf einer
Maschine ohne Browser.

```bash
docker compose -f docker/compose.yaml exec app node dist/add-staff.js <betriebs-id> monteur@betrieb.de "Max Beispiel" technician
```

**Ohne Passwort im Aufruf, und das ist der Normalfall.** Fehlt
`OPENGEWERK_PASSWORD`, erzeugt der Befehl eines und gibt es einmal aus, in fünf
Fünfergruppen aus einem Alphabet ohne `i`, `l`, `o` und `u`, damit es niemand
falsch abliest. Es steht dann auf dem Terminal dessen, der den Befehl abgesetzt
hat, und nirgends sonst: nicht im Protokoll des Containers, das jemand
weitergibt, wenn er um Hilfe bittet, nicht in der Prozessliste und nicht in der
Umgebung. Beim ersten Anmelden gehört es ersetzt.

Wer eines vorgeben will, setzt `OPENGEWERK_PASSWORD`, und dann gilt weiter die
Untergrenze von zwölf Zeichen. Als Argument geht es nicht und soll es nicht: ein
Argument steht in der Prozessliste und im Verlauf der Shell, wo es monatelang
liegen bleibt.

Gab es das Konto schon, sagt der Befehl das und rührt das Passwort nicht an. Nur
die Rollen im genannten Betrieb ändern sich.

Einen zweiten Faktor kann jedes Konto auch später einrichten, auf dem Bildschirm
"Konto" im Büro. Für `owner` ist er Pflicht und die Anwendung fragt von selbst
danach, für alle anderen ist er eine Empfehlung.

`TRUSTED_ORIGINS` ist die Liste der Adressen, von denen aus ein Browser eine
angemeldete Anfrage schicken darf, und damit der Schutz davor, dass ein Formular
auf einer fremden Seite hier etwas auslöst. Nur Herkunft, also Schema, Host und
notfalls Port: ein Pfad oder ein Schrägstrich am Ende passt nie zu dem, was ein
Browser sendet, und die Sperre sähe konfiguriert aus, ohne etwas zu tun. Seit es
eine Oberfläche gibt, ist das die erste Zeile, die eine Installation anfassen
muss: steht dort nicht die Adresse, unter der die Anwendung erreichbar ist,
scheitert die Anmeldung im Browser, während `curl` durchgeht.

`SESSION_SECRET` gehört in die Sicherung der Installation. Wird es getauscht,
sind alle abgemeldet und jeder schon eingerichtete zweite Faktor ist nicht mehr
lesbar.

`CLOSED=true` schaltet die Instanz zu: sie startet, migriert, beantwortet ihren
Health-Check und lehnt jede Anfrage an die Daten ab, die Anmeldung
eingeschlossen. Für ein Rückspielen oder ein Wartungsfenster, in dem die Instanz
erreichbar sein soll, ohne etwas herauszugeben.

**Hex und nicht base64 bei den Passwörtern**, und das ist kein Geschmack. Die
Passwörter stehen in Verbindungsadressen, und ein `/` oder `@` darin teilt die
Adresse an der falschen Stelle: aus `postgres://opengewerk_owner:ab/cd@postgres/...`
wird ein Zugriff auf einen Rechner namens `opengewerk_owner`. Die Fehlermeldung
lautet dann "getaddrinfo ENOTFOUND", und darauf kommt niemand von selbst.
`openssl rand -base64` liefert regelmäßig beide Zeichen. OpenGewerk erkennt
diesen Fall beim Start und sagt, woran es liegt.

### E-Mail

OpenGewerk verschickt über einen Mailserver, den die Instanz in der `.env` bekommt, einmal für alle Module. Ohne `SMTP_HOST` verschickt sie nichts, und nichts wartet auf den Versand.

```bash
SMTP_HOST=mail.example.de
SMTP_SECURITY=starttls
MAIL_FROM=rechnung@betrieb.example.de
```

Dazu `SMTP_USER` und `SMTP_PASSWORD`, wenn der Server eine Anmeldung verlangt, beide oder keines. `SMTP_SECURITY` ist `starttls` für Port 587 und verlangt die Verschlüsselung, statt sie nur anzunehmen, `tls` für Port 465 oder `none` für einen Relay im selben Netz; `SMTP_PORT` braucht es nur für einen anderen Port. `MAIL_FROM` ist nur die Adresse, den Namen davor nimmt jede Nachricht aus dem Briefkopf ihres Betriebs.

**Geprüft wird beim Start.** Eine Anmeldung, die der Server ablehnt, ein Rechnername, den es nicht gibt, oder eine verschlüsselte Verbindung, die nicht zustande kommt, halten den Start an und stehen als ein Satz im Log. Das sind falsche Angaben, und sie sollen auffallen, bevor die erste Rechnung nicht ankommt. Antwortet der Server nur gerade nicht, startet die Instanz trotzdem und sagt das im Log, die Nachrichten warten im Postausgang. Die Startzeile nennt Server und Absender, oder dass kein Mailserver eingerichtet ist. Eine geschlossene Instanz (`CLOSED=true`) verschickt nichts.

### Drei Dienste, und was sie kosten

| Dienst | Abbild | Speicher im Leerlauf |
| --- | --- | --- |
| Anwendung | 291 MB | 81 MiB unter einem Limit von 1 GB, 195 MiB ohne Limit |
| PostgreSQL 18 | 433 MB | 33 MiB |
| Renderer (abschaltbar) | 3,9 GB | 342 MiB |

Gemessen am 19.09.2026 mit `docker stats --no-stream` auf einer leeren
Instanz. Die zwei Zahlen bei der Anwendung sind die wichtigste Angabe hier:
Node wählt seinen Heap nach dem verfügbaren Speicher, und auf einer Maschine
mit 30 GB nimmt es sich mehr, als es braucht. Bekommt der Container ein Limit,
schrumpft der Bedarf auf ein Drittel. Für das Ziel aus ADR 0002, zwei Gigabyte
für alles, ist damit reichlich Luft: Anwendung und Datenbank zusammen bleiben
unter 120 MiB, nachgemessen mit `mem_limit` von 1 GB und 768 MB.

Der Renderer ist der Grund, warum er ein eigener Container ist. Er kostet
allein mehr Speicher als der Rest zusammen und fast vier Gigabyte auf der
Platte, und die meisten Installationen brauchen ihn selten. Er läuft deshalb
nur, wenn er angefordert wird:

```bash
docker compose -f docker/compose.yaml --profile renderer up -d
```

Ohne ihn läuft alles andere weiter, und ein Versuch, ein PDF zu erzeugen,
bekommt eine Meldung, die den Befehl oben nennt. Das ist die Zusage aus
ADR 0007.

> Das Abbild `ghcr.io/browserless/chromium` bringt eine fertige PDF-Schnittstelle
> mit, ist mit 3,9 GB aber deutlich größer als die 300 MB, mit denen ADR 0007
> gerechnet hat. Die Dokumentenerzeugung aus #71 läuft über dieses Abbild, und
> ein Beleg braucht dort gemessen unter einer halben Sekunde. Ob ein
> schlankeres Chromium die Schnittstelle ersetzen kann, ist damit nicht
> entschieden, nur leichter zu entscheiden: die Naht dafür ist `Renderer` in
> `packages/server/src/documents/renderer.ts`, und ein Wechsel ändert keine
> Vorlage.

### Zwei Rollen, nicht eine

Der Container migriert nicht beim Start, sondern in einem eigenen Schritt davor,
und der meldet sich mit einer anderen Rolle an:

- `opengewerk_owner` besitzt die Tabellen und führt die Migrationen aus.
- `opengewerk_app` ist die Rolle, mit der die Anwendung arbeitet. Sie darf
  nichts anlegen und nichts ändern am Schema, und für sie gilt die
  Mandantentrennung.

Die Trennung ist der Grund, warum eine Anwendung mit den Zugangsdaten des
Eigentümers gar nicht erst startet: für den Eigentümer einer Tabelle greift
Row-Level Security nur über `FORCE`, und eine Instanz, die als er verbindet,
hätte eine Absicherung, die aussieht wie eine und keine ist. OpenGewerk weist
so eine `DATABASE_URL` beim Start zurück, statt sie hinzunehmen.

Angelegt werden beide Rollen einmalig von `docker/postgres-init/10-roles.sh`,
beim ersten Start des Datenbank-Containers. Die Migration legt `opengewerk_app`
bewusst ohne Passwort und ohne Anmelderecht an: Zugangsdaten gehören nicht in
eine Datei, die in jedem Klon dieses Repositories liegt.

### Sicherung und Rückspielen

Ein Backup, das nie zurückgespielt wurde, ist kein Backup. Deshalb liegt hier
beides als Skript vor, und der Rückspielweg prüft danach nach, ob wirklich
alles zurückgekommen ist.

```bash
docker compose -f docker/compose.yaml --profile backup run --rm backup backup.sh
```

Das Ergebnis ist ein Archiv mit drei Teilen und einem Manifest:

| Teil | Inhalt |
| --- | --- |
| `database.dump` | die Datenbank, `pg_dump` im Custom-Format |
| `storage.tar` | der inhaltsadressierte Dateispeicher |
| `audit-chains.tsv` | je Mandant der Kopf der Audit-Hashkette |
| `manifest.json` | Zeitstempel, PostgreSQL-Version und eine Prüfsumme je Teil |

**Datenbank und Dateien liegen im selben Lauf, und die Reihenfolge ist nicht
vertauschbar.** Ein Beleg zeigt per Hash auf eine Datei. Würden zuerst die
Dateien gesichert, hätte alles, was zwischen den beiden Schritten hochgeladen
wird, eine Zeile im Dump und keine Datei im Archiv: eine zurückgespielte
Rechnung, die auf nichts zeigt. Andersherum ist der schlimmste Fall eine Datei,
auf die niemand verweist, und die kostet Plattenplatz und sonst nichts.

**Die Sicherung meldet sich als Superuser an**, nicht als Eigentümer der
Tabellen. Row-Level Security ist auf jeder Tabelle mit `FORCE` gesetzt und gilt
damit auch für den Eigentümer; ein Dump unter dieser Rolle käme entweder mit
einer Fehlermeldung zurück oder, schlimmer, leer. Eine Sicherung, die weniger
sehen darf als alles, ist keine.

### Zurückspielen

```bash
docker compose -f docker/compose.yaml --profile backup run --rm backup restore.sh latest
```

Der Lauf sperrt die Anwendung für seine Dauer aus, spielt beide Teile zurück
und prüft danach drei Dinge, von denen jedes eine Frage beantwortet, die die
anderen nicht beantworten können:

1. **Das Manifest**, ob das Archiv heil angekommen ist. Diese Prüfung läuft
   vor allem anderen: eine beschädigte Sicherung wird abgelehnt, bevor die
   Datenbank angefasst wird.
2. **Die Dateihashes.** Ein inhaltsadressierter Speicher kann das allein
   beantworten, denn der Name einer Datei ist der SHA-256 ihres Inhalts. ADR
   0007 verlangt eine Stichprobe; geprüft werden alle, weil das bei den
   Datenmengen eines Handwerksbetriebs Sekunden kostet und eine Stichprobe
   "wahrscheinlich" sagt, wo das hier "ja" sagt.
3. **Die Audit-Ketten**, ob das Log dasselbe Log ist.

**Die Anwendung wird ausgesperrt, nicht um Abwesenheit gebeten.** Der erste
Entwurf zählte offene Verbindungen und schützte vor nichts: der
Verbindungspool schließt eine ungenutzte Verbindung nach Sekunden, die Zählung
steht also auf null, während die Anwendung läuft. Stattdessen bekommt
`opengewerk_app` für die Dauer des Laufs `NOLOGIN`, bestehende Verbindungen
werden beendet, und der Superuser, der zurückspielt, ist davon nicht betroffen.
Die gesamte Datenbank zu sperren ginge nicht, das schlösse auch ihn aus.

### Die Sicherung als Zeuge für das Audit-Log

Die Hashkette im Audit-Log macht eine kleine Korrektur unmöglich zu verstecken.
Gegen jemanden, der den Trigger abschalten kann, hilft sie allein nicht: er
ändert einen Eintrag, rechnet alle folgenden neu, und die Kette geht wieder
auf. Genau dafür liegt der Kopf jeder Kette in der Sicherung, also außerhalb
der Datenbank.

```bash
docker compose -f docker/compose.yaml --profile backup run --rm backup verify.sh latest
```

Das hält das Log der laufenden Instanz gegen die Sicherung, ohne etwas
zurückzuspielen, und beantwortet nicht "geht die Kette auf", sondern "ist
Eintrag Nummer N noch derselbe, den diese Sicherung gesehen hat".

Am 19.09.2026 gegengeprüft: nach einer gefälschten Änderung mit anschließend
neu berechneter Kette meldet die Prüfung in der Datenbank
`gebrochen bei: nirgends`, und `verify.sh` nennt trotzdem den betroffenen
Mandanten samt beider Fingerabdrücke. Der unbeteiligte zweite Mandant bleibt
dabei unauffällig.

### Verschlüsselung und Aufbewahrung

Ein Archiv wird mit einem **öffentlichen** Schlüssel verschlüsselt (age). Das
ist nicht dasselbe wie eine Passphrase: die Maschine, die sichert, kann ihre
eigenen älteren Sicherungen nicht lesen. Wer den Server übernimmt, bekommt das
Archiv nicht mit dazu.

```bash
docker run --rm opengewerk/backup:latest age-keygen
```

Die Zeile mit `age1…` ist der öffentliche Schlüssel und gehört als
`BACKUP_AGE_RECIPIENT` in die `.env`. Die Zeile mit `AGE-SECRET-KEY-…` gehört
woanders hin, nicht auf diese Maschine: ein Schlüssel, der neben dem Archiv
liegt, schützt vor nichts. Zum Zurückspielen wird er für genau diesen einen
Lauf hineingereicht.

Ohne gesetzten Empfänger läuft die Sicherung trotzdem, gibt aber eine Warnung
aus. Sie enthält Kundendaten, Belege und das Audit-Log.

`BACKUP_KEEP` legt fest, wie viele Generationen bleiben (Vorgabe 14). Ältere
werden nach jedem Lauf entfernt. `BACKUP_TARGET` bestimmt, wohin die Archive
gehen; die Vorgabe ist ein Docker-Volume, und das überlebt ein
`docker compose down`, aber keinen Plattendefekt. Eine Installation, die es
ernst meint, zeigt damit auf ein Verzeichnis auf einer anderen Maschine.

### Aktualisieren

Ein Update ist das, was Leitentscheidung 6 verspricht: Abbild tauschen,
Migration läuft, Dienst startet. Zwei Aufrufe, und ihre Reihenfolge ist der
ganze Punkt:

```bash
docker compose -f docker/compose.yaml run --rm --build migrate
docker compose -f docker/compose.yaml up -d
```

Läuft die Migration durch, tauscht der zweite Aufruf die Container, und nach
wenigen Sekunden antwortet die Instanz wieder. Schlägt sie fehl, bricht der
erste Aufruf mit dem Grund ab, der zweite wird nie erreicht, und die laufende
Instanz beantwortet weiter Anfragen. Die Datenbank steht dabei unverändert auf
dem Stand davor: alle ausstehenden Migrationen laufen in einer einzigen
Transaktion, ein halbes Update gibt es nicht.

**Nicht `docker compose up -d` allein**, obwohl der Migrationsdienst auch dort
davorhängt. Compose erzeugt zuerst alle Container neu, deren Abbild sich
geändert hat, und startet sie erst danach. Der laufende Anwendungscontainer ist
also schon weg, wenn die Migration überhaupt anfängt. Geht sie schief, steht
die Instanz still, statt weiter zu antworten. Nachgemessen am 19.09.2026; der
Unterschied ist genau ein Aufruf mehr.

Daraus folgt eine Regel für die Migrationen selbst: **eine Migration muss auch
zur vorherigen Fassung passen.** Zwischen den beiden Aufrufen läuft die alte
Anwendung einen Moment lang auf dem neuen Schema. Eine Spalte hinzufügen ist
deshalb unbedenklich, eine umbenennen oder entfernen nicht. Das braucht zwei
Fassungen: in der ersten die neue Spalte anlegen und beschreiben, in der
zweiten die alte entfernen.

Sprünge über mehrere Stände hinweg funktionieren, ein Betrieb aktualisiert
nicht jede Woche. Der Lauf spielt alles ein, was seit dem Stand der Datenbank
dazugekommen ist, und tut gegen eine schon aktuelle Datenbank nichts. Die CI
fährt genau das: eine Instanz auf einem älteren Stand, Daten darauf, zwei
Migrationen darüber, danach derselbe Bestand und dieselbe Audit-Kette.

Zwei Fälle lehnt der Lauf ab, statt sie stillschweigend zu übergehen:

- **Eine gemergte Migration wurde nachträglich geändert.** Geprüft werden die
  Hashes in der Datenbank gegen die Dateien im Abbild. Ohne diese Prüfung
  passiert schlicht nichts, und genau das ist das Problem: das Werkzeug
  vergleicht nur Zeitstempel, findet nichts Neueres und meldet Erfolg. Wer die
  Änderung gemacht hat, hält sie für eingespielt.
- **Das Abbild ist älter als die Datenbank**, ein zurückgedrehtes Update also.
  Zurück geht nicht, das ältere Abbild kennt die Spalten nicht, die der neuere
  Stand angelegt hat. Der Weg zurück führt über die Sicherung von vor dem
  Update.

Vor ein Update gehört eine Sicherung, siehe oben. Sie ist auch der Weg zurück,
wenn eine Migration zwar durchläuft, das Ergebnis aber nicht stimmt.

### Was beim Aufsetzen sonst noch Zeit kostet

- **Das Volume gehört auf `/var/lib/postgresql`, nicht auf `.../data`.** Die
  Abbilder ab PostgreSQL 18 legen die Daten in einem Unterverzeichnis je
  Hauptversion ab, damit ein späteres `pg_upgrade --link` nicht über eine
  Mount-Grenze stolpert. Auf dem alten Pfad startet der Container gar nicht
  erst, mit einer langen Meldung, in der die eine entscheidende Zeile
  untergeht.
- **Vor die Anwendung gehört ein Reverse Proxy mit TLS.** Sie lauscht
  absichtlich nur auf `127.0.0.1`. Eine Anwendung, die Rechnungen führt, steht
  nicht unverschlüsselt im Netz.
- **Die `.env` ist die einzige Datei mit Zugangsdaten.** `chmod 600`, und sie
  bleibt draußen aus dem Repository.

## Roadmap

Der Fahrplan steht in Abschnitt 10 der
[Feature-Gliederung](docs/konzept/Feature-Gliederung.md) und bewusst nur dort.
An dieser Stelle stand bis zum 19.09.2026 eine Abschrift, die beim Umschnitt auf
den MVP-Fahrplan nicht mitgezogen wurde und am Ende zwei Bausteine in Phase 0
nannte, die dort nicht hingehören. Eine Kopie driftet, also gibt es keine mehr.

Leitgedanke ist, so früh wie möglich einen echten Betrieb damit abzuwickeln.
Pilotkunde ist der Elektro- und PV-Betrieb des Maintainers; Version 1 ist
erreicht, wenn dessen Aufträge vollständig in OpenGewerk laufen, von der Anfrage
bis zur bezahlten Rechnung. Was dafür nicht nötig ist, kommt später. Ausgenommen
ist, was sich nicht nachrüsten lässt: Datenmodell, Offline-Datenschicht,
Festschreibung und Mandantentrennung gehören ins Fundament, auch wenn die
Oberfläche dafür erst danach kommt.

Phase 0 (Fundament) ist gebaut, an Phase 1, dem MVP für den Pilotbetrieb, wird
gearbeitet. Was davon steht, sagt das Kapitel Status oben, was noch offen ist, der
[Meilenstein Phase 1](https://github.com/opengewerk/opengewerk/milestone/2).

## Projektfamilie

- [`opengewerk`](https://github.com/opengewerk/opengewerk): diese Handwerkersoftware, das CRM und ERP für den Betrieb.
- [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei): der Kanzlei-Hub, mit dem ein Steuerberater alle seine OpenGewerk-Mandanten aus einer Anwendung heraus bearbeitet, ohne dass die Daten den Betrieb verlassen.
- [`opengewerk-api-spec`](https://github.com/opengewerk/opengewerk-api-spec): der gemeinsame API-Vertrag zwischen beiden, versioniert nach SemVer, damit Hub und Handwerkersoftware unabhängig releasen können.
- [opengewerk.de](https://opengewerk.de): die Website des Projekts, gebaut aus [`opengewerk-website`](https://github.com/opengewerk/opengewerk-website).

## Mitmachen

Das Projekt steht noch am Anfang, gerade jetzt zählt jede fachliche Rückmeldung aus dem Betriebsalltag mehr als Code.

- Fragen, Ideen und alles ohne konkreten Vorschlag gehören in die [Discussions](https://github.com/opengewerk/opengewerk/discussions).
- Für kurze Fragen und zum Mitreden gibt es einen [Discord-Server](https://discord.gg/NRrEvbQdxz). Er ersetzt die Discussions nicht: ein Chatverlauf ist nicht durchsuchbar, und was dort geklärt wird und für andere zählt, gehört hinterher in eine Discussion oder ein Issue.
- Konkrete Fehler und Wünsche laufen über die [Issue-Vorlagen](https://github.com/opengewerk/opengewerk/issues/new/choose).
- Die Beitragsregeln stehen in [CONTRIBUTING.md](https://github.com/opengewerk/.github/blob/main/CONTRIBUTING.md), der Verhaltenskodex in [CODE_OF_CONDUCT.md](https://github.com/opengewerk/.github/blob/main/CODE_OF_CONDUCT.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer OpenGewerk als Dienst für andere betreibt, gibt seine Änderungen zurück.
