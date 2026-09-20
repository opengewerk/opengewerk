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

Das Fundament aus **Phase 0** steht. Es gibt das ausgearbeitete Konzept, die Architekturentscheidungen und den Unterbau: Datenmodell, Mandantentrennung, Rechte, Nummernkreise, Audit-Log, Offline-Datenschicht, Regel-Engine und seit dem 19.09.2026 den Betrieb über Docker Compose samt Sicherung, Rückspielen und Update-Pfad. Seit dem 20.09.2026 gibt es die **Anmeldung** nach ADR 0006: Sitzungen, zweiter Faktor, Betriebswahl, Geräteliste. Eine Oberfläche gibt es noch nicht, die API lässt sich aber mit einer echten Anmeldung benutzen. Was an Fachlogik darauf aufsetzt, kommt mit Phase 1.

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

Eine Anmeldung gibt es noch nicht, und solange das so ist, läuft eine Instanz mit einer Identitätsquelle, die **niemanden** erkennt. Jede Route hinter dem Guard antwortet damit mit 401. Das ist nicht dieselbe Sache wie der Notbehelf, der beim Bau der Rechte verworfen wurde: der hätte jeden hereingelassen. Dieser lässt keinen herein, und deshalb kann eine Instanz betrieben, migriert und gemessen werden, bevor es irgendwo etwas zum Anmelden gibt. Wenn die Authentifizierung kommt, wird genau diese eine Klasse ausgetauscht.

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

### Offline-Datenschicht

Ein Monteur im Keller hat kein Netz und muss trotzdem arbeiten können. Jede Änderung wird deshalb auf dem Gerät als Vorgang in eine Warteschlange gelegt und später der Reihe nach verschickt. Die Schlüssel entstehen auf dem Gerät (UUIDv7), bevor irgendeine Verbindung da ist.

**Ein Vorgang trägt für jedes Feld mit, was das Gerät dort gesehen hat.** Das ist die Entscheidung, an der alles andere hängt. Der Server vergleicht diesen Wert mit dem aktuellen: stimmt er, hat niemand dazwischengefunkt und die Änderung geht durch. Stimmt er nicht, ist das ein Konflikt. Zwei Geräte, die verschiedene Felder desselben Datensatzes geändert haben, gehen beide durch, ohne dass jemand etwas entscheiden muss. Das ist der Abgleich auf Feldebene aus ADR 0005, und er braucht dafür keine Uhr auf jedem Feld.

**Ein Vorgang wirkt ganz oder gar nicht.** Sobald eines seiner Felder kollidiert, landet nichts davon, und die ganze beabsichtigte Änderung geht in die Konfliktliste. Halb anzuwenden ergäbe einen Datensatz, den keines der beiden Geräte je gemeint hat.

**Konflikte werden nicht aufgelöst, sondern gezeigt.** Dafür wurden CRDTs in ADR 0005 abgelehnt: eine Mechanik, die alles selbst entscheidet, entscheidet die Fälle, die sie falsch trifft, genauso still wie die richtigen. Die Konfliktliste hat drei Bilder nebeneinander: was das Gerät wollte, was es zu sehen glaubte, und was tatsächlich dastand.

Was ein Gerät ohne Verbindung darf, steht je Entität fest. Stammdaten dürfen angelegt, aber nicht geändert werden; ein Beleg darf geschrieben werden, solange er Entwurf ist, und keinen Moment länger. Festschreiben gibt es offline gar nicht, es vergibt eine Nummer und macht den Beleg fest, und das passiert auf dem Server.

**Dieselbe Übertragung zweimal ändert nichts.** Jeder Vorgang hat eine Kennung vom Gerät, der Server merkt sich jede, die er gesehen hat. Ein Gerät, dem die Verbindung nach dem Commit abbricht, schickt seine Warteschlange noch einmal, und das ist der Normalfall, nicht die Ausnahme.

**Gelöscht wird durch Markieren, nicht durch Entfernen.** Eine entfernte Zeile ist eine Zeile, von der ein Gerät, das gerade offline war, nie wieder etwas hört: der Abgleich liefert, was sich geändert hat, und eine Zeile, die es nicht mehr gibt, ist nicht darunter.

Der Stand, ab dem ein Gerät nachfragt, ist eine Nummer je Mandant, die in der Reihenfolge hochzählt, in der Transaktionen festschreiben. Ein Stand auf Zeitstempeln würde still eine Zeile überspringen, deren Transaktion früh begann und spät festschrieb.

Die Warteschlange selbst liegt später im Browser. Die Regeln liegen jetzt schon in `domain`, denn nur so kann ein Gerät dieselbe Antwort ausrechnen, bevor es etwas schickt, und einen Konflikt anzeigen statt ihn zu entdecken.

### Regel-Engine

Gesetzliche Parameter stehen nicht im Quelltext, sondern als Datensätze in Regelpaketen unter `packages/domain/src/rules/data/`. Jeder Datensatz hat einen Gültigkeitszeitraum und die Fundstelle, aus der er stammt. Die Fundstelle ist keine Zierde: sie ist der Unterschied zwischen einer Zahl, die jemand nachprüfen kann, und einer, die jemand glauben muss.

**Jede Abfrage braucht einen Tag, und es gibt keinen Weg, ohne einen zu fragen.** Diese eine fehlende Bequemlichkeit trägt die historische Anwendung aus Abschnitt 1.7: eine Rechnung von 2027 kann 2030 nicht versehentlich nach den Sätzen von 2030 beurteilt werden, weil keine Funktion in dieser Engine weiß, welcher Tag heute ist.

**Ein neuer Steuersatz ist ein Eintrag, kein Release.** Der Basiszinssatz nach §247 BGB ist das beste Beispiel: die Bundesbank setzt ihn zum 1. Januar und zum 1. Juli neu fest, und jedes Mal ist das eine Zeile in einer Datei, die jeder gegen die Bekanntmachung prüfen kann, statt einer Änderung an einer Rechenfunktion.

**Gerechnet wird in ganzen Zahlen**, in Basispunkten und in Cent. Neunzehn Prozent als 0,19 und ein Betrag als 22000.00 liefern jede Rechnung dem binären Fließkomma aus, und dort sind neunzehn Prozent von hundert Euro nicht verlässlich neunzehn Euro. Gerundet wird an genau einer Stelle, kaufmännisch und von der Null weg, damit eine Gutschrift die Rechnung spiegelt, die sie korrigiert, statt einen Cent daneben zu liegen.

**Wo keine Regel hinterlegt ist, gibt es keine Antwort.** Die Engine rechnet nicht mit einem erfundenen Wert weiter. Ein erfundener Zinssatz auf einer echten Rechnung ist schlimmer als ein fehlender, und das Paket sagt in sich selbst, bis wann es reicht.

Davon getrennt stehen die **mandantenbezogenen Parameter**: ob ein Betrieb die Kleinunternehmerregelung in Anspruch nimmt, welches Zahlungsziel er auf seine Rechnungen schreibt. Die liegen in der Datenbank, tragen ebenfalls einen Gültigkeitszeitraum und werden nicht geändert, sondern ab einem Tag abgelöst. Ein Betrieb kann damit nie eine gesetzliche Größe verschieben: der Schlüssel ist eine Aufzählung von Einstellungen, und keine Regel steht darin.

> **Stand der Prüfung:** Am 19.09.2026 sind alle 26 Datensätze gegen ihre Fundstelle gehalten worden, die Basiszinssätze gegen die Tabelle der Bundesbank, die übrigen gegen die datierten Gesetzesfassungen. Kein eingetragener Wert wich von seiner Fundstelle ab. Was dabei aufgefallen ist, steht in Issue #31: der Nenner von 360 Tagen in der Verzugszinsrechnung trägt als einzige Zahl der Engine keine Fundstelle, die Stichtage von 2014 hängen nach Art. 229 § 34 EGBGB am Schuldverhältnis und nicht am Tag, und mehrere gesetzliche Größen, die Abschnitt 1.7 des Konzepts aufzählt, stehen noch in keinem Paket. **Das ersetzt die fachkundige Abnahme nicht.** Eine Vorprüfung sagt, dass die Zahl zur Fundstelle passt; ob die Fundstelle die richtige ist und ob die Vereinfachungen tragen, sagt sie nicht.

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
`curl http://127.0.0.1:3000/health` antwortet mit `{"status":"bereit"}`. Alles
andere antwortet mit 401, denn es gibt noch kein Konto.

### Der erste Zugang

Niemand meldet sich selbst an. Ein Konto entsteht nur über die Kommandozeile,
und der erste muss es, denn er soll ja gerade die Person anlegen, die sich
anmelden könnte:

```bash
docker compose -f docker/compose.yaml exec app node dist/add-staff.js <betriebs-id> chefin@betrieb.de "Olga Beispiel" owner
```

Das Passwort kommt aus `OPENGEWERK_PASSWORD` und nicht aus einem Argument: ein
Argument steht in der Prozessliste und im Verlauf der Shell, wo es monatelang
liegen bleibt.

Für die Rolle `owner` ist ein zweiter Faktor Pflicht. Bis er eingerichtet ist,
kommt die Anmeldung bis zur Betriebswahl und nicht weiter. Das ist Absicht: die
Pflicht hängt an der Rolle und nicht an einer Einstellung, sonst wäre sie keine.

`TRUSTED_ORIGINS` ist die Liste der Adressen, von denen aus ein Browser eine
angemeldete Anfrage schicken darf, und damit der Schutz davor, dass ein Formular
auf einer fremden Seite hier etwas auslöst. Nur Herkunft, also Schema, Host und
notfalls Port: ein Pfad oder ein Schrägstrich am Ende passt nie zu dem, was ein
Browser sendet, und die Sperre sähe konfiguriert aus, ohne etwas zu tun.

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
> gerechnet hat. Ob ein schlankeres Chromium diese Schnittstelle ersetzen kann,
> wird mit der Dokumentenerzeugung in Phase 1 entschieden.

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

Phase 0 (Fundament) ist gebaut. Als Nächstes kommt Phase 1, der MVP für den
Pilotbetrieb.

## Projektfamilie

- [`opengewerk`](https://github.com/opengewerk/opengewerk): diese Handwerkersoftware, das CRM und ERP für den Betrieb.
- [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei): der Kanzlei-Hub, mit dem ein Steuerberater alle seine OpenGewerk-Mandanten aus einer Anwendung heraus bearbeitet, ohne dass die Daten den Betrieb verlassen.
- [`opengewerk-api-spec`](https://github.com/opengewerk/opengewerk-api-spec): der gemeinsame API-Vertrag zwischen beiden, versioniert nach SemVer, damit Hub und Handwerkersoftware unabhängig releasen können.

## Mitmachen

Das Projekt steht noch am Anfang, gerade jetzt zählt jede fachliche Rückmeldung aus dem Betriebsalltag mehr als Code.

- Fragen, Ideen und alles ohne konkreten Vorschlag gehören in die [Discussions](https://github.com/opengewerk/opengewerk/discussions).
- Für kurze Fragen und zum Mitreden gibt es einen [Discord-Server](https://discord.gg/NRrEvbQdxz). Er ersetzt die Discussions nicht: ein Chatverlauf ist nicht durchsuchbar, und was dort geklärt wird und für andere zählt, gehört hinterher in eine Discussion oder ein Issue.
- Konkrete Fehler und Wünsche laufen über die [Issue-Vorlagen](https://github.com/opengewerk/opengewerk/issues/new/choose).
- Die Beitragsregeln stehen in [CONTRIBUTING.md](https://github.com/opengewerk/.github/blob/main/CONTRIBUTING.md), der Verhaltenskodex in [CODE_OF_CONDUCT.md](https://github.com/opengewerk/.github/blob/main/CODE_OF_CONDUCT.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer OpenGewerk als Dienst für andere betreibt, gibt seine Änderungen zurück.
