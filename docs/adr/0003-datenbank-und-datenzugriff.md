---
status: angenommen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.3, Abschnitte 1.1, 1.3, 1.5, 2 (Mandanten), 4.8
informed: Mitwirkende der Organisation opengewerk
---

# Datenbank und Datenzugriff

## Kontext und Problemstellung

Anforderungen an die Datenbank: unveränderbares Journal (GoBD), Mandantentrennung, JSON-basierte Formulardaten mit Abfragen darauf, Volltextsuche, Änderungsverfolgung für den Offline-Sync, Betrieb auf einem einzelnen kleinen Server, einfache Backups.

## Betrachtete Optionen

### A: PostgreSQL

- Vorteile: JSONB mit Indizes für Formular- und Regeldaten; Row-Level Security als zweite Verteidigungslinie für Mandantentrennung; Trigger/Constraints zur technischen Absicherung des append-only-Journals; eingebaute Volltextsuche (deutsch); logische Replikation/`xmin`-basierte Änderungserkennung für Sync; sehr gute Tool-Landschaft; Standard bei ERPNext, Odoo, Dolibarr-Alternativen.
- Nachteile: Etwas mehr Betriebsaufwand als SQLite; Backups brauchen `pg_dump`/WAL-Archiv.

### B: MariaDB/MySQL

- Vorteile: Weit verbreitet auf Shared-Hosting; Referenzprojekt nutzt es.
- Nachteile: JSON-Unterstützung und RLS schwächer; weniger geeignet für die Formular-Engine.

### C: SQLite (Server-seitig)

- Vorteile: Null Betriebsaufwand, eine Datei, Backup = Kopie.
- Nachteile: Schreibkonkurrenz bei mehreren Nutzern und Sync-Läufen; keine RLS; Volltext nur über FTS5; skaliert nicht auf Betriebe mit vielen Monteuren.

## Entscheidung

Gewählt wurde **Option A, PostgreSQL** (16 oder neuer). Mandantentrennung als `tenant_id`-Spalte in jeder Tabelle **plus** Row-Level Security mit `SET LOCAL app.tenant_id` pro Transaktion (nicht Schema- oder Datenbank-pro-Mandant, das macht Migrationen und Backups unnötig komplex).

Datenzugriff: **Drizzle ORM**, SQL-nah, typsicher, Migrationen als SQL-Dateien im Repo, keine Laufzeit-Magie. Prisma wurde verworfen, weil dessen eigene Query-Engine die für die Mandantentrennung nötige Kontrolle über Transaktionen und `SET LOCAL` erschwert. Kysely als reiner Query-Builder bleibt der Rückfallweg, falls Drizzle an einer Stelle im Weg steht.

Journal-Absicherung auf DB-Ebene: Tabelle `journal_entries` ohne UPDATE/DELETE-Recht für die Anwendungsrolle; Trigger verhindert Änderungen; Storno ist eine neue Zeile mit Referenz.

Identitäten: **UUIDv7** als Primärschlüssel überall (zeitlich sortierbar, offline erzeugbar, keine Kollision zwischen Geräten). Fachliche Nummern (Rechnungsnummer) werden separat und nur serverseitig beim Festschreiben vergeben.

Im Client (PWA) kommt zusätzlich eine lokale Datenbank zum Einsatz, siehe ADR 0005.

## Konsequenzen

- Docker-Compose enthält PostgreSQL mit persistentem Volume; Backup-Skript nutzt `pg_dump` plus Dateispeicher (ADR 0007); Restore-Test ist Teil der CI.
- Jede Migration ist rückwärts prüfbar (Down-Migration oder dokumentierter manueller Weg); Flyway-ähnliche Disziplin: Migrationen sind unveränderlich, sobald gemerged.
- RLS-Tests: Für jede Tabelle ein Test, dass Mandant A keine Zeile von Mandant B lesen kann.
- **Nachtrag vom 18.09.2026, das Muster für eine unveränderliche Tabelle.** Das Audit-Log setzt die oben für `journal_entries` beschriebene Absicherung zum ersten Mal um, und dabei sind zwei Dinge dazugekommen, die dort noch nicht stehen. Erstens schreibt nicht die Anwendung, sondern ein Trigger an jeder Tabelle: nur so taucht auch eine Änderung im Log auf, die an der Anwendung vorbei passiert, und genau die ist der Grund für ein Log. Zweitens läuft dieser Trigger als `SECURITY DEFINER` und schreibt durch eine Policy, die für das Einfügen offen ist. Das klingt nach einem Loch und ist keins: die Anwendungsrolle hat auf der Tabelle nur SELECT, kommt also gar nicht an die Policy heran. Wäre die Policy eng, müsste jede Änderung einen Mandanten in der Sitzung haben, und eine Migration hätte keinen. Wer `journal_entries` in Phase 3 baut, nimmt dasselbe Muster.
- **Nachtrag vom 18.09.2026, Hashkette und der Eigentümer in den Tests.** Über dem Audit-Log liegt eine Hashkette je Mandant: jeder Eintrag wird mit dem Hash seines Vorgängers zusammen gehasht, eine Prüffunktion läuft sie ab. Append-only verhindert eine Änderung, die Kette macht eine sichtbar, die trotzdem passiert ist. Je Mandant und nicht je Instanz, weil ein Mandant nur seine eigenen Zeilen sieht und eine Kette, die er nicht lesen kann, auch nicht nachrechnen kann. Dazu eine Beobachtung, die allgemeiner gilt als dieses Issue: **die Testdatenbank läuft seitdem unter einem Eigentümer ohne Superuser-Rechte.** Für einen Superuser gilt Row-Level Security nie, also war genau der Teil des Entwurfs ungeprüft, der nur für einen gewöhnlichen Eigentümer überhaupt greift, `FORCE` eingeschlossen. Wer eine neue Tabelle mit Policies anlegt, sollte das nicht wieder aufweichen.
- **Nachtrag vom 19.09.2026, was "unveränderlich, sobald gemerged" braucht, um zu gelten.** Die Regel steht seit der ersten Fassung oben, durchgesetzt hat sie niemand. Drizzle schreibt zwar je Migration einen Hash in die Datenbank, vergleicht beim nächsten Lauf aber nur den Zeitstempel der zuletzt eingespielten. Gemessen am 19.09.2026: eine nachträglich geänderte, längst gemergte Migration wird übersprungen, der Lauf meldet Erfolg, und die hinzugefügte Tabelle existiert nicht. Wer die Änderung gemacht hat, hält sie für eingespielt. Seitdem vergleicht der Lauf vor dem Migrieren die Hashes der eingespielten Migrationen mit den Dateien im Abbild und sieht danach nach, ob auch wirklich alles gelaufen ist. Das Zweite fängt den Gegenfall: eine Migration, deren Zeitstempel vor dem der zuletzt eingespielten liegt, wird sonst ebenso stillschweigend übergangen, und genau das hinterlassen zwei in der falschen Reihenfolge gemergte Branches. Nebenbei hängt der Hash an der Datei, wie sie gelesen wird, Zeilenenden eingeschlossen; das ist ein Grund mehr für die LF-Regel des Projekts.
- **Nachtrag vom 19.09.2026, eine Transaktion für alle und was daraus folgt.** Alle ausstehenden Migrationen laufen zusammen in einer einzigen Transaktion. Scheitert die dritte von drei, steht die Datenbank auf dem Stand davor und nicht irgendwo dazwischen, und das ist der Grund, warum ein abgebrochenes Update kein Restore nach sich zieht. Der Preis ist eine Einschränkung an die Migrationen selbst: nichts darin darf außerhalb einer Transaktion laufen müssen, `CREATE INDEX CONCURRENTLY` an erster Stelle. Ein Test hält das fest, statt es der Aufmerksamkeit zu überlassen. Zweitens muss eine Migration auch zur vorherigen Fassung passen: sie läuft vor dem Tausch des Abbilds, die alte Anwendung arbeitet also einen Moment lang auf dem neuen Schema. Eine Spalte hinzufügen ist unbedenklich, eine umbenennen oder entfernen braucht zwei Fassungen. Warum die Migration vor dem Tausch läuft und nicht mittendrin, steht in der README unter "Aktualisieren".
- **Nachtrag vom 20.09.2026, eine abgeleitete Spalte und der Check darunter.** Die Belegposition speichert ihre Nettosumme, statt sie beim Lesen zu rechnen. Das ist eine Entscheidung über die Zeit und nicht über die Geschwindigkeit: Menge mal Preis muss auf Cent gerundet werden, und die gerundete Zahl ist die, die der Kunde gesehen hat. Später neu zu rechnen hieße, dass eine Änderung an der Rundungsregel stillschweigend eine Rechnung von 2027 verändert, und genau das soll die ganze Engine datierter Regeln verhindern. Eine gespeicherte abgeleitete Zahl driftet allerdings, sobald irgendein Weg sie anders schreibt als die beiden Zahlen daneben hergeben. Deshalb hält ein Check-Constraint dieselbe Arithmetik wie die Anwendung. Ein Detail darin ist nicht optional: der Ausdruck rechnet über `numeric` und nicht über die Ganzzahlen, weil PostgreSQL ein `numeric` kaufmännisch rundet und ein `double precision` zur geraden Zahl. Ohne den Cast wäre der Check bei jedem zweiten halben Cent anderer Meinung als der Code, den er absichern soll. Ein Test misst beide gegen denselben Fall.
- **Nachtrag vom 20.09.2026, ein Trigger, der auf eine andere Tabelle schaut.** Der Schutz eines festgeschriebenen Belegs saß bis hierher an der Kopfzeile. Die Positionen sind eine eigene Tabelle, also brauchte es einen zweiten Trigger, und der liest den Status des Belegs statt eines Feldes an der Zeile. Zwei Dinge daran sind nicht offensichtlich. Erstens entscheidet der Name über die Reihenfolge: PostgreSQL feuert BEFORE-Trigger alphabetisch, und `document_lines_stay_fixed` läuft vor `stamp_sync_columns`, sieht die Zeile also so, wie der Aufrufer sie geschickt hat. Zweitens lässt der Trigger beim Löschen einen fehlenden Beleg durch. Das klingt nach einem Loch und ist der Kaskade geschuldet: wird ein Entwurf gelöscht, ist die Kopfzeile schon weg, wenn der Trigger für die Zeile läuft. Streng zu sein hieße, das Löschen eines Entwurfs zu verbieten. Einen festgeschriebenen Beleg kann ohnehin niemand löschen, dafür sorgt `document_stays_fixed` eine Tabelle höher, es gibt also keinen Weg, auf dem ein fehlender Beleg etwas anderes bedeuten könnte.
