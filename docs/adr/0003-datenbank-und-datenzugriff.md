---
status: vorgeschlagen
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

## Empfehlung

**Option A: PostgreSQL** (16 oder neuer). Mandantentrennung als `tenant_id`-Spalte in jeder Tabelle **plus** Row-Level Security mit `SET LOCAL app.tenant_id` pro Transaktion (nicht Schema- oder Datenbank-pro-Mandant, das macht Migrationen und Backups unnötig komplex).

Datenzugriff: **Drizzle ORM** (SQL-nah, typsicher, Migrationen als SQL-Dateien im Repo, keine Laufzeit-Magie). Alternative Kysely (reiner Query-Builder) bei Bedarf nach noch mehr Kontrolle. Prisma nicht, wegen eigener Query-Engine und schwächerer RLS-/Transaktionskontrolle.

Journal-Absicherung auf DB-Ebene: Tabelle `journal_entries` ohne UPDATE/DELETE-Recht für die Anwendungsrolle; Trigger verhindert Änderungen; Storno ist eine neue Zeile mit Referenz.

Identitäten: **UUIDv7** als Primärschlüssel überall (zeitlich sortierbar, offline erzeugbar, keine Kollision zwischen Geräten). Fachliche Nummern (Rechnungsnummer) werden separat und nur serverseitig beim Festschreiben vergeben.

Im Client (PWA) kommt zusätzlich eine lokale Datenbank zum Einsatz, siehe ADR 0005.

## Konsequenzen

- Docker-Compose enthält PostgreSQL mit persistentem Volume; Backup-Skript nutzt `pg_dump` plus Dateispeicher (ADR 0007); Restore-Test ist Teil der CI.
- Jede Migration ist rückwärts prüfbar (Down-Migration oder dokumentierter manueller Weg); Flyway-ähnliche Disziplin: Migrationen sind unveränderlich, sobald gemerged.
- RLS-Tests: Für jede Tabelle ein Test, dass Mandant A keine Zeile von Mandant B lesen kann.
