# ADR 0004: Frontend-Framework und PWA-Architektur

- Status: vorgeschlagen
- Datum: 2026-09-18
- Bezug: Feature-Gliederung v2.3, Abschnitte 1.6, 9

## Kontext

Zwei Oberflächen: Büro-Anwendung (Desktop, datenintensiv, Tabellen, Plantafel, Belegeditor) und Baustellen-App (Mobil, offline, Kamera, Unterschrift, wenige große Bedienelemente). Beide sollen als eine installierbare PWA ausgeliefert werden; native Apps sind Phase 2 der Plattform-Strategie.

## Optionen

### A: React + Vite (SPA/PWA)

- Vorteile: Größtes Ökosystem; Formular-Engine profitiert von React Hook Form/TanStack Form; TanStack Query/Router für Offline-Caching und Routen; Service-Worker-Tooling (Workbox, vite-plugin-pwa) ausgereift; Maintainer-Erfahrung mit React/Next.js.
- Nachteile: Bundle-Größe; viele Entscheidungen (State, Styling) selbst zu treffen.

### B: Next.js

- Vorteile: Bekannt, Konventionen, SSR.
- Nachteile: SSR und App-Router bringen für eine self-hosted Offline-PWA nichts und komplizieren Service Worker, Caching und Auth; Node-Server für das Frontend ist ein zweiter Prozess ohne Nutzen.

### C: SvelteKit oder Vue/Nuxt

- Vorteile: Kleinere Bundles, weniger Boilerplate.
- Nachteile: Kleinerer Beitragenden-Pool; weniger fertige Bausteine für komplexe Formulare und Tabellen; Bruch mit der Erfahrung des Maintainers.

### D: Zwei getrennte Apps (Büro und Mobil)

- Vorteile: Jede App bleibt schlank.
- Nachteile: Doppelte Auth, doppelter Sync-Client, doppelte Komponenten; genau das Duplikat, das das Konzept vermeiden will.

## Empfehlung

**Option A: React 19 + Vite + TypeScript**, eine Codebasis mit zwei Einstiegspunkten (`/` Büro, `/m` Baustelle), die dieselben Domänenpakete, denselben Sync-Client und dieselbe Auth teilen, aber unterschiedliche Layouts und Navigationsmuster haben. Geräteerkennung schlägt beim ersten Start den passenden Einstieg vor.

Bausteine: TanStack Router + Query, Formular-Engine auf TanStack Form mit JSON-Schema-Renderer, Tabellen mit TanStack Table, Styling mit Tailwind und eigenen Komponenten (Radix-Primitives), Icons Lucide. Kein UI-Kit mit eigener Designsprache (kein MUI/Ant), damit das OpenGewerk-Branding trägt.

PWA: vite-plugin-pwa mit Workbox; App-Shell offline, API-Daten über den Sync-Client (ADR 0005), nicht über HTTP-Cache. Kamera, Barcode/QR-Scan, Unterschrift und Dateizugriff über Web-APIs; Web-Push für Benachrichtigungen (iOS ab 16.4 nur bei installierter PWA, im Hilfetext erklären).

## Konsequenzen

- Native Apps später als Capacitor-Wrapper derselben Codebasis; nur nötig, wenn Push-Zuverlässigkeit oder Bluetooth-Messgeräte es erfordern.
- Barrierefreiheit (Tastatur, Kontrast, Screenreader-Labels) von Anfang an in den Komponenten, nicht nachträglich.
- Bundle-Budget pro Einstieg festlegen (Ziel Baustelle: unter 300 kB gzip initial) und in CI prüfen.
