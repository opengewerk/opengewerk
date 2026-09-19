---
status: angenommen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.3, Abschnitte 1.6, 9
informed: Mitwirkende der Organisation opengewerk
---

# Frontend-Framework und PWA-Architektur

## Kontext und Problemstellung

Zwei Oberflächen: Büro-Anwendung (Desktop, datenintensiv, Tabellen, Plantafel, Belegeditor) und Baustellen-App (Mobil, offline, Kamera, Unterschrift, wenige große Bedienelemente). Beide sollen als eine installierbare PWA ausgeliefert werden; native Apps sind Phase 2 der Plattform-Strategie.

## Betrachtete Optionen

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

## Entscheidung

Gewählt wurde **Option A, React 19 + Vite + TypeScript**: eine Codebasis mit zwei Einstiegspunkten (`/` Büro, `/m` Baustelle), die dieselben Domänenpakete, denselben Sync-Client und dieselbe Auth teilen, aber unterschiedliche Layouts und Navigationsmuster haben. Geräteerkennung schlägt beim ersten Start den passenden Einstieg vor.

Bausteine: TanStack Router + Query, Formular-Engine auf TanStack Form mit JSON-Schema-Renderer, Tabellen mit TanStack Table, Styling mit Tailwind und eigenen Komponenten (Radix-Primitives), Icons Lucide. Kein UI-Kit mit eigener Designsprache (kein MUI/Ant), damit das OpenGewerk-Branding trägt.

PWA: vite-plugin-pwa mit Workbox; App-Shell offline, API-Daten über den Sync-Client (ADR 0005), nicht über HTTP-Cache. Kamera, Barcode/QR-Scan, Unterschrift und Dateizugriff über Web-APIs; Web-Push für Benachrichtigungen (iOS ab 16.4 nur bei installierter PWA, im Hilfetext erklären).

## Konsequenzen

- Native Apps später als Capacitor-Wrapper derselben Codebasis; nur nötig, wenn Push-Zuverlässigkeit oder Bluetooth-Messgeräte es erfordern.
- Barrierefreiheit (Tastatur, Kontrast, Screenreader-Labels) von Anfang an in den Komponenten, nicht nachträglich.
- Bundle-Budget pro Einstieg festlegen (Ziel Baustelle: unter 300 kB gzip initial) und in CI prüfen.
- **Nachtrag vom 19.09.2026, das Designsystem.** Die Entscheidung oben sagt "kein UI-Kit mit eigener Designsprache, damit das OpenGewerk-Branding trägt", und lässt offen, was das Branding dann ist. Es ist die Marke: Schiefer `#1B2430`, Kupfer `#C8671F`, Elfenbein `#F4F1EA` und Barlow, die Schrift der Wortmarke. Barlow wird über `@fontsource` mitgeliefert und nicht von einem Schriftdienst geladen: eine self-hosted Instanz darf für ihre eigene Darstellung nicht am offenen Netz hängen, und die Baustellen-App hat die Hälfte der Zeit ohnehin kein Netz. Die Werte stehen in `packages/web/src/styles/tokens.css` und nirgends sonst.
- **Nachtrag vom 19.09.2026, Kupfer hat vier Werte.** Weiße Schrift auf dem reinen Markenkupfer erreicht 3,88:1. Das trägt eine Überschrift und fällt bei jedem Knopf unter 18,66 px durch, also bei den beiden wichtigsten Aktionen der Anwendung. Ein Markenhandbuch legt Farben für eine Bildmarke fest, wo Kontrast kaum eine Rolle spielt, und genau seine Autorität sorgt dafür, dass niemand nachrechnet. Deshalb `#C8671F` für Flächen und Marken, `#A6521A` für den gefüllten Knopf mit weißer Schrift, `#9A4F16` für Kupfer als Text oder Link, `#E08A3C` auf dunklem Grund. Dort dreht sich der Knopf um und trägt Schiefer-Schrift statt Weiß.
- **Nachtrag vom 19.09.2026, zwei Dichten statt eines Umbruchpunkts.** Die zwei Einstiege oben sind nicht zwei Bildschirmbreiten, sondern zwei Eingabegeräte: Maus und Tastatur gegen einen Daumen im Handschuh. Das Büro bekommt 34 px hohe Bedienelemente und 13 bis 14 px Schrift, die Baustelle 60 px und 17 px, und nichts Antippbares geht unter 44 px. Gesteuert wird das über `data-entry` an der Wurzel des Einstiegs, nicht über eine Medienabfrage, denn ein breites Tablet auf dem Dach ist immer noch eine Baustelle. Der helle Grund ist der Standard, der dunkle über `data-theme` wählbar, ohne Angabe entscheidet das Betriebssystem.
- **Nachtrag vom 19.09.2026, Kontrast steht in einem Test.** Die Konsequenz oben verlangt Barrierefreiheit in den Komponenten statt nachträglich. Umgesetzt ist das als Prüfung, die die Hexwerte aus der Token-Datei liest und jede Kombination aus Vordergrund und Fläche nachrechnet, in beiden Grundtönen und gegen alle drei Flächen. Nicht im Browser gemessen: `color-mix()` und eingefrorene Übergänge liefern dort Artefakte, und wer denen folgt, ändert funktionierende Farben. Beim ersten Lauf fielen drei Werte durch, die nur gegen die Karte geprüft worden waren und gegen die dunkelste helle Fläche zu hell sind. Dazu prüft dieselbe Datei, dass die Dunkelwerte in beiden Blöcken übereinstimmen, denn CSS kann sie nur zweimal hinschreiben, und zwei Blöcke, die dasselbe sagen müssen, driften.
