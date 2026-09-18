# Architecture Decision Records

Ein Architecture Decision Record, kurz ADR, hält eine einzelne Architekturentscheidung fest: welches Problem zur Debatte stand, welche Möglichkeiten es gab, wofür man sich entschieden hat und was daraus folgt. Der Zweck ist nicht die Entscheidung selbst, die steht im Code. Der Zweck ist die Begründung, damit in zwei Jahren niemand eine Regel umstößt, ohne den Grund zu kennen, oder sie aus Unsicherheit stehen lässt, obwohl der Grund längst weggefallen ist.

Die Dokumente folgen dem [MADR-Format](https://adr.github.io/madr/), auf Deutsch.

## Bestehende Entscheidungen

| Nummer | Titel | Status |
| --- | --- | --- |
| [0001](0001-drei-repositories.md) | Drei Repositories statt eines Monorepos | angenommen |
| [0002](0002-sprache-und-backend-framework.md) | Programmiersprache und Backend-Framework | vorgeschlagen |
| [0003](0003-datenbank-und-datenzugriff.md) | Datenbank und Datenzugriff | vorgeschlagen |
| [0004](0004-frontend-und-pwa.md) | Frontend-Framework und PWA-Architektur | vorgeschlagen |
| [0005](0005-offline-sync-und-konflikte.md) | Offline-Synchronisation und Konfliktauflösung | vorgeschlagen |
| [0006](0006-auth-und-mandantenfaehigkeit.md) | Authentifizierung, Autorisierung und Mandantenfähigkeit | vorgeschlagen |
| [0007](0007-dateispeicher-dokumente-und-pdf.md) | Dateispeicher, Dokumentenerzeugung und E-Rechnung | vorgeschlagen |
| [0008](0008-plugin-system-fuer-gewerke.md) | Plugin-System für Gewerke und Erweiterungen | vorgeschlagen |

## Offene Entscheidungen (0002–0008)

Die ADRs 0002 bis 0008 sind Entscheidungsvorlagen: Sie enthalten die betrachteten Optionen mit Vor- und Nachteilen, eine Empfehlung und die Konsequenzen. Der Status bleibt `vorgeschlagen`, bis der Maintainer entschieden hat; danach wird er auf `angenommen` gesetzt, die nicht gewählten Optionen bleiben zur Nachvollziehbarkeit im Dokument.

Empfehlungen in Kurzform:

| ADR | Empfehlung |
| --- | --- |
| 0002 | TypeScript durchgängig, NestJS, Monorepo mit `domain`-Paket ohne I/O |
| 0003 | PostgreSQL mit Row-Level Security, Drizzle ORM, UUIDv7, append-only-Journal per DB-Regel |
| 0004 | React + Vite als eine PWA mit Büro- und Baustellen-Einstieg, Workbox |
| 0005 | Eigene Outbox mit serverautoritativem Merge, Konfliktregeln je Entität, Festschreibung nur online |
| 0006 | Eingebaute Auth (Passkeys/TOTP, Magic-Link fürs Kundenportal), OIDC optional, Rollen + Rechte + RLS |
| 0007 | Inhaltsadressierter Dateispeicher (Dateisystem/S3), HTML→PDF via Chromium, E-Rechnung in TS mit KoSIT-Validierung, Mustang als Notausgang |
| 0008 | Gewerke als Datenpakete plus Compile-Time-Module im Monorepo, Elektro/PV als erstes Paket |

Sinnvolle Reihenfolge der Entscheidung: 0002 → 0003 → 0005 → 0004 → 0006 → 0007 → 0008. 0005 steht vor 0004, weil der Sync-Mechanismus das Datenmodell im Client bestimmt.

## Wann ein ADR sinnvoll ist

Immer dann, wenn eine Entscheidung schwer umkehrbar ist oder mehrere Module betrifft: Wahl der Datenbank, Aufbau des Datenmodell-Kerns, Offline-Sync-Strategie, Authentifizierung, Schnitt zwischen Kern und Plugin-Gewerken, Ablage der Belege. Eine Bibliothek auszutauschen ist dagegen meist kein ADR wert.

## Ein neues ADR anlegen

1. Die nächste freie vierstellige Nummer nehmen, die Nummern werden nie neu vergeben.
2. Datei nach dem Muster `NNNN-kurzer-titel.md` benennen, kleingeschrieben, Wörter mit Bindestrich getrennt.
3. Das Dokument im MADR-Format schreiben: Kontext und Problemstellung, Entscheidungstreiber, betrachtete Optionen, Entscheidung mit Konsequenzen, Vor- und Nachteile der Optionen.
4. Den Status im Frontmatter setzen: `vorgeschlagen`, `angenommen`, `abgelehnt`, `überholt durch NNNN`.
5. Die Tabelle in dieser Datei ergänzen.
6. Als Pull Request einreichen. Die Diskussion findet im Pull Request statt, nicht im Dokument.

Ein angenommenes ADR wird nicht mehr inhaltlich umgeschrieben. Ändert sich die Entscheidung, entsteht ein neues ADR, und das alte bekommt den Status `überholt durch` mit Verweis auf das neue. So bleibt die Historie lesbar.
