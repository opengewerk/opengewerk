---
status: angenommen
date: 2026-09-17
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.2, Konzept "OpenGewerk Kanzlei" v1.1
informed: Mitwirkende der Organisation opengewerk
---

# Drei Repositories statt eines Monorepos

## Kontext und Problemstellung

OpenGewerk besteht aus zwei Anwendungen, die zusammenarbeiten, aber verschiedenen Leuten gehören: die Handwerkersoftware läuft beim Handwerksbetrieb, der Kanzlei-Hub läuft in der Steuerberaterkanzlei. Zwischen beiden liegt eine API, über die der Hub die Daten des Mandanten abruft. Beide Seiten werden unterschiedlich schnell weiterentwickelt und von unterschiedlichen Betreibern aktualisiert. Ein Betrieb, der seine Instanz ein halbes Jahr nicht anfasst, darf die Kanzlei nicht ausschließen, und umgekehrt.

Daraus folgt die Frage: Wie werden Code und Schnittstellenvertrag auf Repositories verteilt, damit beide Seiten unabhängig veröffentlichen können, ohne sich gegenseitig zu brechen?

## Entscheidungstreiber

- Hub und Handwerkersoftware müssen unabhängig voneinander releasen können.
- Der Schnittstellenvertrag braucht eine einzige verbindliche Fassung, die beide Seiten zitieren können.
- Die Kompatibilität zweier laufender Installationen muss prüfbar sein, ohne dass jemand beide Codebasen liest.
- Auch ein fremdes System soll den Vertrag später implementieren dürfen, ohne die Lizenz der Anwendungen zu übernehmen.
- Die beiden Anwendungen haben unterschiedliche Zielgruppen und sollen getrennt auffindbar sein.

## Betrachtete Optionen

1. **Ein Monorepo** mit Handwerkersoftware, Hub und Vertrag in einem Repository.
2. **Zwei Repositories**, je eines pro Anwendung, der Vertrag liegt in einem davon und wird in das andere kopiert.
3. **Drei Repositories**: `opengewerk`, `opengewerk-kanzlei` und ein eigenes Vertrags-Repository `opengewerk-api-spec`.

## Entscheidung

Gewählt wurde Option 3, drei Repositories. Das entspricht Leitentscheidung 8 der Feature-Gliederung und Leitentscheidung 4 des Kanzlei-Konzepts.

`opengewerk-api-spec` enthält die OpenAPI-Definition, die JSON-Schemas und die Konformitätstests, versioniert nach SemVer. Handwerkersoftware und Hub deklarieren jeweils, welche Version der Spezifikation sie unterstützen, und veröffentlichen ihre eigenen Releases unabhängig davon.

### Konsequenzen

Gut:

- Eine Änderung am Vertrag ist als solche sichtbar, mit eigenem Tag und eigenem Änderungsprotokoll. Sie kann nicht unbemerkt in einem Anwendungs-Commit mitlaufen.
- Die Kompatibilität zweier Installationen lässt sich an zwei Versionsnummern ablesen.
- Der Vertrag kann permissiv lizenziert werden (Apache-2.0), während die Anwendungen unter AGPL-3.0 stehen.
- Wer nur den Hub sucht, findet ein Repository mit Hub-Issues und Hub-Discussions, nicht eine gemeinsame Halde.

Schlecht:

- Eine Änderung, die alle drei Teile betrifft, braucht drei Pull Requests in einer bestimmten Reihenfolge: erst der Vertrag, dann die Implementierungen.
- Es gibt drei Issue-Trackers, drei CI-Konfigurationen und drei Changelogs zu pflegen.
- Die Konzeptdokumente liegen verteilt, Querverweise müssen von Hand aktuell gehalten werden.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn alle drei Repositories in der Organisation `opengewerk` bestehen, `opengewerk-api-spec` eine getaggte Version trägt und sowohl Handwerkersoftware als auch Hub ihre unterstützte Spec-Version an einer maschinenlesbaren Stelle ausweisen.

## Vor- und Nachteile der Optionen

### Option 1: Ein Monorepo

- Gut: Eine Änderung über alle drei Teile ist ein einziger Commit, Brüche fallen sofort auf.
- Gut: Nur ein Issue-Tracker und eine CI.
- Schlecht: Beide Anwendungen hängen an einer gemeinsamen Versionsnummer, obwohl sie bei verschiedenen Betreibern in verschiedenen Ständen laufen.
- Schlecht: Der Vertrag ist nicht als eigenständiges, zitierbares Artefakt verfügbar und lässt sich nicht getrennt lizenzieren.

### Option 2: Zwei Repositories mit kopiertem Vertrag

- Gut: Weniger Verwaltungsaufwand als bei drei Repositories.
- Schlecht: Zwei Kopien des Vertrags laufen erfahrungsgemäß auseinander, und dann ist unklar, welche gilt.
- Schlecht: Ein dritter Implementierer müsste sich die maßgebliche Fassung aus einer der beiden Anwendungen herausziehen.

### Option 3: Drei Repositories

- Gut: siehe Konsequenzen.
- Schlecht: siehe Konsequenzen.

## Weitere Informationen

- Feature-Gliederung Handwerkersoftware v2.2, Abschnitt 0, Leitentscheidung 8
- Planungskonzept OpenGewerk Kanzlei v1.1, Abschnitt 0, Leitentscheidung 4, und Abschnitt 7
