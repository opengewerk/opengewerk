# SQL-Bausteine des Fundaments

Was jede Anwendung der Organisation in ihrer Datenbank braucht und `drizzle-kit` nicht
schreibt (ADR 0010, Punkt 9). Die Tabellen dazu stehen als Schema-Module unter
`src/database/schema/` und kommen über `@opengewerk/platform-server/schema`.

| Datei | Inhalt |
|---|---|
| `roles.sql` | Die Rolle, als die sich die Anwendung verbindet, ohne Passwort und ohne Anmeldung, und ihr Zugang zum Schema |
| `audit.sql` | Das Audit-Log: Fingerabdruck, schreibender Trigger, Prüfung der Hashkette und der Riegel, der einen Eintrag unveränderlich hält, außer dem Schwärzen eines Werts durch die Person, die den Mandanten führt (ADR 0013) |
| `sync.sql` | Der Abgleich: der Zähler je Mandant und der Stempel, der die fünf Spalten eines Datensatzes führt |
| `setup.sql` | Was außerhalb eines Mandanten gefragt wird: ob die Instanz leer ist, der erste Mandant, die Einladung zu einem Token, die Liste der Mandanten für Hintergrundläufe; dazu der Riegel, der eine führende Rolle ganz hält und keine Rolle entfernt, die ein Zugang oder eine offene Einladung nennt |
| `instance.sql` | Der Bereich der Instanz: ihr Protokoll mit dem Trigger, der es schreibt, und dem Riegel, der einen Eintrag unveränderlich hält, die eine Zeile der Einstellungen, der Weg zu einem weiteren Mandanten und die Liste der Mandanten mit ihrer Leitung |
| `attachments.sql` | Die Fassungen einer Datei in der Ablage eines Mandanten: wer eine abgelegt hat, schreibt die Datenbank, und der Riegel hält eine Fassung, wie sie geschrieben wurde. Die beiden Tabellen legt eine Anwendung an, die eine Ablage führt (`attachmentsSchema`) |
| `down/` | Die Rücknahme je Baustein |

Was eine einzelne Tabelle darüber hinaus braucht, also `FORCE ROW LEVEL SECURITY`, die Rechte
der Anwendungsrolle, den Audit-Trigger und den Stempel des Abgleichs, steht nicht hier, sondern
als eine Beschreibung je Tabelle in `src/migration/guards.ts`.

## Wie eine Anwendung daraus ihre erste Migration baut

1. Ihre Schema-Datei reicht die Tabellen des Fundaments weiter:
   `export * from '@opengewerk/platform-server/schema'`.
2. `drizzle-kit generate` schreibt daraus die erste Migration und ihren Snapshot.
3. `completeInitialMigrationIn(<Ordner der Migrationen>)` aus
   `@opengewerk/platform-server/migration` setzt die Bausteine darum: die Rolle davor, danach
   `FORCE` und die Rechte je Tabelle, die Funktionen und die Trigger. Die Rücknahme entsteht
   unter `down/` daneben. Eine Änderung nimmt es an dem, was `drizzle-kit` geschrieben hat, vor,
   und der Kopf der Datei sagt es: ein eindeutiger Index steht vor den Fremdschlüsseln.
   `drizzle-kit` schreibt jeden Schlüssel vor jeden Index, und der Schlüssel einer Fassung der
   Ablage auf `files` stützt sich auf den eindeutigen Index über Mandant und Prüfsumme; in einer
   ersten Migration, die beide Tabellen anlegt, lehnte PostgreSQL ihn sonst ab (#568).

Danach ist die Datei eingefroren wie jede Migration. Eine Tabelle, die eine spätere Migration
anlegt, bekommt ihre Anweisungen aus `guardStatements`.

## Welche Seite recht hat

Die Bausteine sind der Stand, bei dem die Migrationen der Handwerkersoftware angekommen sind.
Jede dieser Migrationen ist auf einer Installation gelaufen, ein Baustein nicht. Der Test
`packages/server/src/database/foundation.test.ts` baut deshalb eine Datenbank aus den
Bausteinen allein und eine aus allen Migrationen und vergleicht beide am Katalog. Weicht etwas
ab, wird der Baustein berichtigt und nicht die Migration.

Wer hier etwas ändert, ändert es also zuerst mit einer Migration in jeder Anwendung, die das
Fundament trägt, und zieht den Baustein im selben Pull Request nach.

## Schreibweise

Die Dateien sind Code: Kommentare englisch, die Meldungen in einem `RAISE EXCEPTION` deutsch,
denn die liest ein Mensch im Betrieb. Zwischen zwei Anweisungen steht die Marke
`--> statement-breakpoint`, an der der Migrationslauf trennt, und kein Abschnitt zwischen zwei
Marken besteht nur aus einem Kommentar.
