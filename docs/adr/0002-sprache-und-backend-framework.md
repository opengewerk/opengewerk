---
status: angenommen
amended-by: 0009
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

## Entscheidung

Gewählt wurde **Option A, TypeScript durchgängig**. Ausschlaggebend ist die Offline-first-Anforderung: Validierung, Nummernkreis-Vorschau, Belegberechnung (Summen, Steuer, Skonto) und Formular-Grenzwertprüfung müssen im Browser und auf dem Server identisch sein. Das ist mit geteilten TS-Modulen trivial und mit jeder anderen Sprache ein Generator-Projekt.

Als Framework wurde **NestJS** gewählt: Module, Dependency Injection, Guards für Mandant und Rechte, OpenAPI-Generierung für `opengewerk-api-spec`. Die schlankere Alternative Fastify mit eigener Modulkonvention wurde verworfen, weil die Modulgrenze dann von Hand durchgesetzt werden müsste und genau diese Grenze später die Erweiterungspunkte des Plugin-Systems trägt (ADR 0008). Die Einarbeitung in NestJS ist der bewusst in Kauf genommene Preis dafür.

Monorepo (pnpm Workspaces oder Turborepo) mit Paketen: `domain` (Schemas, Berechnungen, Regeln; ohne I/O), `server`, `web`, `mobile-pwa` (oder ein `web` mit zwei Einstiegen), `api-spec` (Konsument von `opengewerk-api-spec`).

Laufzeit: Node.js LTS (aktuell 22). Bun/Deno erst, wenn der gesamte Stack dort ohne Kompromisse läuft.

## Konsequenzen

- ZUGFeRD/XRechnung wird mit TS-Bibliotheken umgesetzt (z. B. `@e-invoice-eu/core`, Factur-X-Bibliotheken); Eignung vor Phase 1 mit einer Validierung gegen den KoSIT-Validator prüfen. Falls unzureichend: Mustang als separater Java-Microservice ist der Notausgang, nicht der Standard.
- Strenge Abhängigkeitsregeln: `domain` darf nichts aus `server`/`web` importieren; wird per ESLint-Boundary-Regel erzwungen.
- Speicherbedarf des Servers wird im Admin-Handbuch angegeben. Ziel: Der Anwendungsprozess läuft mit 2 GB RAM neben PostgreSQL. Die PDF-Erzeugung zählt nicht hinein, sie läuft nach ADR 0007 in einem eigenen Container, der nur beim Rendern hochfährt. Ohne diese Trennung wäre das Ziel mit Chromium im selben Prozess nicht zu halten.
- **Nachtrag vom 19.09.2026, die Grenzregel ist jetzt da, und sie ist nicht das Tragende.** Die Zusage oben stand zwischen dem 18.09.2026 und heute ohne Entsprechung im Code: die Flat Config sperrte in `packages/domain` nur Globale und das Lesen der Uhr, ein Boundary-Plugin gab es nicht. Getragen hat die Grenze trotzdem, nur woanders. `packages/domain/package.json` deklariert keine einzige Laufzeitabhängigkeit, und weil pnpm jedem Paket genau das gibt, was es deklariert, ist `@opengewerk/server` von dort aus nicht auflösbar. `tsconfig.json` setzt `types: []`, `tsconfig.build.json` setzt `rootDir` auf `src`, und `typecheck` hängt über `turbo.json` an `^build`. Ergänzt wurde `no-restricted-imports` für die beiden Paketnamen und für relative Pfade, die in ein Nachbarpaket führen. Der Gewinn ist nicht, dass ein Verstoß dadurch erst auffiele, sondern dass er als Regelverstoß auffällt statt als fehlendes Modul, und im Editor statt in der CI. Bewusst nicht `../../*`: aus `src/rules/data` ist das ein gewöhnlicher Pfad zu einem Nachbarordner im selben Paket.
- **Nachtrag vom 23.09.2026, die OpenAPI-Datei wird nicht erzeugt.** Die Entscheidung oben nennt als Grund für NestJS unter anderem die OpenAPI-Generierung für `opengewerk-api-spec`. Gebaut ist sie nicht, und sie wird es nicht (#138): der Vertrag zwischen Betrieb und Kanzlei entsteht zuerst und von Hand im eigenen Repository, danach die Implementierungen, und eine aus dem Code erzeugte Datei würde die Reihenfolge umdrehen. Ob die Anwendung den Vertrag erfüllt, prüfen Konformitätstests gegen die Spezifikation; sie kommen mit dem Kanzlei-Connector in Phase 3. Die eigene API zwischen Server und Oberfläche ist kein veröffentlichter Vertrag und braucht keine OpenAPI-Datei.
- **Nachtrag vom 23.09.2026, der Renderer läuft dauerhaft.** Oben steht, die PDF-Erzeugung laufe in einem Container, der nur beim Rendern hochfährt. Seit dem Nachtrag vom 22.09.2026 in ADR 0007 startet der Renderer mit der Instanz und läuft durch, weil jedes Angebot, jede Rechnung und jede Mail mit einem Beleg durch ihn geht. Das Ziel von zwei Gigabyte für den Anwendungsprozess bleibt davon unberührt, der Renderer zählt als eigener Container nicht hinein; zusammen blieben die Dienste im Leerlauf gemessen unter 600 MiB.
