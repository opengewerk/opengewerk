---
status: vorgeschlagen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.3, Abschnitte 0, 1, 9
informed: Mitwirkende der Organisation opengewerk
---

# Programmiersprache und Backend-Framework

## Kontext und Problemstellung

OpenGewerk ist ein self-hosted Modular-Monolith mit REST-API, Offline-first-PWA, Formular- und Regel-Engine und später einem Plugin-Ökosystem für Gewerke. Entwickelt wird zunächst von einer Person, die Wert auf schnelle Iteration am eigenen Pilotbetrieb legt. Die Sprache entscheidet über Typteilung zwischen Client und Server (wichtig für Offline-Validierung), über die Einstiegshürde für Community-Beiträge und über die Betriebskosten auf kleinen Servern.

## Betrachtete Optionen

### A: TypeScript durchgängig (Node.js)

- Vorteile: Eine Sprache für Backend, PWA und Kanzlei-Hub; Domänen-Schemas (z. B. Zod) werden einmal definiert und laufen im Browser für Offline-Validierung und im Server identisch; größte Community bei Web-Entwicklern; JSON-Schema-Formulare (1.3) sind in TS natürlich; gute Bibliotheken für PDF, E-Rechnung, IMAP, CalDAV.
- Nachteile: Laufzeit-Performance und Speicher unter Go/Java; Abhängigkeitsdschungel (npm) erfordert Disziplin; keine echte Parallelität ohne Worker.

### B: Go

- Vorteile: Ein Binary, minimaler Speicher, ideal für Self-hosting auf kleinen Servern; sehr wartbar; starke Standardbibliothek.
- Nachteile: Keine Typteilung mit dem Browser (Schemas doppelt pflegen oder generieren); weniger Bibliotheken für deutsche Fachformate (ZUGFeRD, GAEB, DATANORM); Formular-Engine und Regel-Engine mit JSON-lastiger Dynamik sind in Go umständlicher.

### C: Java/Kotlin mit Spring Boot

- Vorteile: Reifste Enterprise-Bibliotheken für Fachformate (Mustang für ZUGFeRD ist Java); Referenzprojekt „Handwerkerprogramm“ (Winfo2024Kuhn) zeigt, dass es funktioniert; JPA/Flyway sind bewährt.
- Nachteile: Keine Typteilung mit dem Browser; hoher Speicherbedarf; langsamere Iteration; kleinerer Beitragenden-Pool im Handwerks-Open-Source-Umfeld.

### D: Python (Django)

- Vorteile: Schnell zu schreiben, Django-Admin, gute ORM/Migrationen; Odoo/ERPNext-Nähe.
- Nachteile: Keine Typteilung; Performance; asynchrone Sync-Endpunkte weniger elegant; Frontend bleibt ohnehin TS.

## Empfehlung

**Option A: TypeScript durchgängig.** Ausschlaggebend ist die Offline-first-Anforderung: Validierung, Nummernkreis-Vorschau, Belegberechnung (Summen, Steuer, Skonto) und Formular-Grenzwertprüfung müssen im Browser und auf dem Server identisch sein. Das ist mit geteilten TS-Modulen trivial und mit jeder anderen Sprache ein Generator-Projekt.

Framework: **NestJS** als Struktur für den Modular-Monolithen (Module, Dependency Injection, Guards für Mandanten/Rechte, OpenAPI-Generierung für `opengewerk-api-spec`). Alternative bei Wunsch nach weniger Magie: Fastify mit eigener Modulkonvention, dann muss die Modulgrenze selbst durchgesetzt werden.

Monorepo (pnpm Workspaces oder Turborepo) mit Paketen: `domain` (Schemas, Berechnungen, Regeln; ohne I/O), `server`, `web`, `mobile-pwa` (oder ein `web` mit zwei Einstiegen), `api-spec` (Konsument von `opengewerk-api-spec`).

Laufzeit: Node.js LTS (aktuell 22). Bun/Deno erst, wenn der gesamte Stack dort ohne Kompromisse läuft.

## Konsequenzen

- ZUGFeRD/XRechnung wird mit TS-Bibliotheken umgesetzt (z. B. `@e-invoice-eu/core`, Factur-X-Bibliotheken); Eignung vor Phase 1 mit einer Validierung gegen den KoSIT-Validator prüfen. Falls unzureichend: Mustang als separater Java-Microservice ist der Notausgang, nicht der Standard.
- Strenge Abhängigkeitsregeln: `domain` darf nichts aus `server`/`web` importieren; wird per ESLint-Boundary-Regel erzwungen.
- Speicherbedarf des Servers wird im Admin-Handbuch angegeben (Ziel: läuft auf 2 GB RAM neben PostgreSQL).
