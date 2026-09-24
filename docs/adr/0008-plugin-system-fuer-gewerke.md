---
status: angenommen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.3, Abschnitte 0 (Leitentscheidung 1), 1.3, 1.7, 5.2
informed: Mitwirkende der Organisation opengewerk
---

# Plugin-System für Gewerke und Erweiterungen

## Kontext und Problemstellung

Elektro/PV ist Kernmodul; SHK, Dach, Maler und weitere Gewerke sollen später von der Community beigesteuert werden. Ein Gewerk besteht zum größten Teil aus **Daten** (Formulardefinitionen, Regelpakete, Textbausteine, Artikelkategorien, Berechtigungen, Fristentypen) und nur zu einem kleinen Teil aus Code (spezielle Berechnungen, Importadapter). Sicherheits- und Wartungsrisiken von zur Laufzeit geladenem Fremdcode müssen vermieden werden.

## Betrachtete Optionen

### A: Laufzeit-Plugins (dynamisch geladene Pakete, eigener Prozess oder WASM)

- Vorteile: Installation ohne Neubau; echte Drittanbieter-Erweiterungen.
- Nachteile: Sicherheits- und Stabilitätsrisiko; Versionskonflikte; Sandboxing (WASM) für DB-Zugriff aufwändig; für ein Ein-Personen-Projekt in Phase 0-3 nicht tragbar.

### B: Datenpakete + Compile-Time-Module im Monorepo

- Vorteile: Gewerke sind hauptsächlich JSON/YAML (Formulare, Regeln, Textbausteine), die per Pull Request kommen und ohne Code-Review-Risiko installierbar sind; Code-Anteile sind normale Module im Monorepo mit denselben Tests und derselben Release-Pipeline; keine Laufzeit-Unsicherheit.
- Nachteile: Neue Code-Module erfordern ein Release; Drittanbieter können keinen proprietären Code anhängen (bei AGPL ohnehin nicht gewollt).

### C: Nur Konfiguration, kein Plugin-Konzept

- Vorteile: Einfachst.
- Nachteile: Gewerke-spezifische Berechnungen (z. B. Dachflächen-Aufmaß) und Importadapter passen nicht in reine Konfiguration.

## Entscheidung

Gewählt wurde **Option B, Datenpakete plus Compile-Time-Module**, mit einem klar definierten Gewerke-Paketformat:

```
packages/gewerke/<name>/
  manifest.json        # Name, Version, Abhängigkeiten, benötigte Kernversion
  formulare/*.json     # Formulardefinitionen (Formular-Engine, ADR-Bezug 1.3)
  regeln/*.json        # Regelpakete (Regel-Engine 1.7), z. B. Gewährleistungsfristen des Gewerks
  fristen/*.json       # Fristentypen mit Standardintervallen
  textbausteine/*.json # Positions- und Belegtexte
  artikel/*.json       # Artikelkategorien, Einheiten
  rechte/*.json        # zusätzliche Berechtigungen
  src/                 # optional: Berechnungen, Importadapter (TypeScript, im Monorepo gebaut)
```

- Datenpakete werden beim Start registriert und in die Mandanten-Datenbank importiert; ein Mandant aktiviert Gewerke in den Einstellungen.
- Der Kern definiert **Erweiterungspunkte** (Hooks) mit stabilen Schnittstellen: Belegberechnung, Aufmaß-Berechnung, Import-Adapter (Messgeräte, Kataloge), Dashboard-Kacheln, Anlagentypen mit eigenen Feldern.
- Elektro/PV wird als erstes Paket in exakt diesem Format gebaut, der Kern darf nichts Elektro-Spezifisches hartkodieren. Das ist der Test, ob das Format trägt.
- Laufzeit-Plugins (Option A) bleiben als spätere Erweiterung offen, z. B. für externe Integrationen über die REST-API und Webhooks, die ohnehin außerhalb des Prozesses laufen.

## Konsequenzen

- Formular- und Regel-Engine müssen von Phase 0 an Pakete aus dem Dateisystem laden können, nicht nur aus der Datenbank.
- Versionierung: Ein Gewerke-Paket deklariert die minimale Kernversion; die CI prüft beim Kern-Release alle Pakete gegen die Erweiterungspunkte.
- Beitragsleitfaden für Gewerke-Pakete (CONTRIBUTING) mit Beispielpaket und Validierungsskript.
- **Nachtrag vom 24.09.2026, was von Elektro/PV im Kern bleibt (#136).** Gebaut ist es anders als oben verlangt: die Anlagenstruktur für Elektro und PV steht mit den Anlagenarten, Verteilern, Feldern, Stromkreisen, Betriebsmitteln, Wechselrichtern, Strings und Modulen samt Migrationen, Abgleichregeln und Bildschirmen im Kern, und die Regelpakete sind in `domain` gebaut und werden nicht aus dem Dateisystem geladen. Entschieden von Moritz am 24.09.2026: so bleibt es. Die Anlagenstruktur ist Datenmodell, das 1.1 der Feature-Gliederung zum Kern zählt, und ein Paket, das Tabellen, Abgleichregeln und Bildschirme mitbringt, bräuchte ein Paketsystem für Schema und Oberfläche, das vor dem zweiten Gewerk niemand braucht. Was ab #78 dazukommt, entsteht dagegen im Paketformat: die Formulardefinitionen und Grenzwerte des Gewerks liegen unter `packages/gewerke/elektro/` mit `manifest.json`, `formulare/` und `regeln/`, als erstes das Prüfprotokoll nach VDE 0100-600 (#79). Sie werden in Server und Oberfläche gebaut und nicht beim Start aus dem Dateisystem gelesen, denn ein Gerät ohne Netz braucht sie genauso wie der Server. Das Registrieren beim Start, das Aktivieren je Betrieb und die Rollen als Tabelle aus dem Nachtrag vom 18.09.2026 in ADR 0006 kommen mit dem zweiten Gewerk, also mit den Plugin-Gewerken in Phase 6; bis dahin gilt die erste Konsequenz oben nicht. Die Regelpakete unter `packages/domain/src/rules/data/` sind Recht und kein Gewerk und bleiben in `domain`, weil Gerät und Server aus ihnen dieselbe Antwort rechnen müssen.
