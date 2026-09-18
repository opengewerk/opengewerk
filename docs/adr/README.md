# Architecture Decision Records

Ein Architecture Decision Record, kurz ADR, hält eine einzelne Architekturentscheidung fest: welches Problem zur Debatte stand, welche Möglichkeiten es gab, wofür man sich entschieden hat und was daraus folgt. Der Zweck ist nicht die Entscheidung selbst, die steht im Code. Der Zweck ist die Begründung, damit in zwei Jahren niemand eine Regel umstößt, ohne den Grund zu kennen, oder sie aus Unsicherheit stehen lässt, obwohl der Grund längst weggefallen ist.

Die Dokumente folgen dem [MADR-Format](https://adr.github.io/madr/), auf Deutsch.

## Bestehende Entscheidungen

| Nummer | Titel | Status |
| --- | --- | --- |
| [0001](0001-drei-repositories.md) | Drei Repositories statt eines Monorepos | angenommen |
| [0002](0002-sprache-und-backend-framework.md) | Programmiersprache und Backend-Framework | angenommen |
| [0003](0003-datenbank-und-datenzugriff.md) | Datenbank und Datenzugriff | angenommen |
| [0004](0004-frontend-und-pwa.md) | Frontend-Framework und PWA-Architektur | angenommen |
| [0005](0005-offline-sync-und-konflikte.md) | Offline-Synchronisation und Konfliktauflösung | angenommen |
| [0006](0006-auth-und-mandantenfaehigkeit.md) | Authentifizierung, Autorisierung und Mandantenfähigkeit | angenommen |
| [0007](0007-dateispeicher-dokumente-und-pdf.md) | Dateispeicher, Dokumentenerzeugung und E-Rechnung | angenommen |
| [0008](0008-plugin-system-fuer-gewerke.md) | Plugin-System für Gewerke und Erweiterungen | angenommen |
| [0009](0009-werkzeuge-und-repo-struktur.md) | Werkzeuge und Repo-Struktur | angenommen |

## Der Tech-Stack auf einen Blick

Die ADRs 0002 bis 0008 wurden am 18.09.2026 gemeinsam entschieden, nachdem sie einen Tag als Vorlagen offen lagen. Die nicht gewählten Optionen bleiben zur Nachvollziehbarkeit in den Dokumenten stehen.

| ADR | Entscheidung |
| --- | --- |
| 0002 | TypeScript durchgängig, NestJS, Monorepo mit `domain`-Paket ohne I/O |
| 0003 | PostgreSQL mit Row-Level Security, Drizzle ORM, UUIDv7, append-only-Journal per DB-Regel |
| 0004 | React + Vite als eine PWA mit Büro- und Baustellen-Einstieg, Workbox |
| 0005 | Eigene Outbox mit serverautoritativem Merge, Konfliktregeln je Entität, Festschreibung nur online |
| 0006 | Eingebaute Auth über better-auth (Passkeys, TOTP, Magic-Link fürs Kundenportal), OIDC optional, Rollen und Rechte plus RLS |
| 0007 | Inhaltsadressierter Dateispeicher (Dateisystem oder S3), PDF über Chromium in einem eigenen Container, E-Rechnung in TypeScript mit KoSIT-Validierung, Mustang als Notausgang |
| 0008 | Gewerke als Datenpakete plus Compile-Time-Module im Monorepo, Elektro/PV als erstes Paket |
| 0009 | pnpm Workspaces mit Turborepo, Node 24, TypeScript 7, Vitest mit fast-check, ESLint mit Prettier, PostgreSQL 18 |

Drei Punkte, an denen die Entscheidung von der ursprünglichen Vorlage abweicht:

- **NestJS statt der schlankeren Fastify-Variante** (0002), weil die vorgegebene Modulgrenze später die Erweiterungspunkte des Plugin-Systems trägt.
- **Chromium rendert in einem eigenen Container** (0007), sonst wäre das Speicherziel aus 0002 nicht zu halten. Die beiden Vorlagen widersprachen sich an dieser Stelle.
- **Die Bindung der Kanzlei-Token an den Hub** (0006) ist keine Zusage für Phase 3 mehr. Phase 3 startet mit rotierenden Bearer-Token, DPoP oder mTLS kommen danach.

## Wann ein ADR sinnvoll ist

Immer dann, wenn eine Entscheidung schwer umkehrbar ist oder mehrere Module betrifft: Wahl der Datenbank, Aufbau des Datenmodell-Kerns, Offline-Sync-Strategie, Authentifizierung, Schnitt zwischen Kern und Plugin-Gewerken, Ablage der Belege. Eine Bibliothek auszutauschen ist dagegen meist kein ADR wert.

## Ein neues ADR anlegen

1. Die nächste freie vierstellige Nummer nehmen, die Nummern werden nie neu vergeben.
2. Datei nach dem Muster `NNNN-kurzer-titel.md` benennen, kleingeschrieben, Wörter mit Bindestrich getrennt. Die Überschrift im Dokument ist der Titel allein, ohne die Nummer davor, die steht im Dateinamen.
3. Das Dokument im MADR-Format schreiben: Kontext und Problemstellung, Entscheidungstreiber, betrachtete Optionen, Entscheidung mit Konsequenzen, Vor- und Nachteile der Optionen.
4. Den Status im YAML-Frontmatter setzen: `vorgeschlagen`, `angenommen`, `abgelehnt`, `überholt durch NNNN`. Beantwortet ein neues ADR offene Enden eines alten, ohne dessen Entscheidung umzustoßen, bekommt das alte zusätzlich das Feld `amended-by: NNNN`; sein Text bleibt unangetastet. Dazu gehören `date`, `decision-makers`, `consulted` und `informed`, so wie in den vorhandenen ADRs. Status und Datum gehören nicht als Aufzählung unter die Überschrift, sonst liest kein Werkzeug sie.
5. Die Tabelle in dieser Datei ergänzen.
6. Als Pull Request einreichen. Die Diskussion findet im Pull Request statt, nicht im Dokument.

ADR 0009 ist der erste Fall der zweiten Art: Es stößt 0002 nicht um, sondern schließt dessen offene Enden (Paketmanager, Node-Version, endgültige Paketliste) und legt Test-, Lint- und Formatierwerkzeug fest. Deshalb trägt 0002 den Zeiger `amended-by`, nicht `überholt durch`.

Ein angenommenes ADR wird nicht mehr inhaltlich umgeschrieben. Ändert sich die Entscheidung, entsteht ein neues ADR, und das alte bekommt den Status `überholt durch` mit Verweis auf das neue. So bleibt die Historie lesbar.
