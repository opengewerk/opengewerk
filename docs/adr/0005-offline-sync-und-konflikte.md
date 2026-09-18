# ADR 0005: Offline-Synchronisation und Konfliktauflösung

- Status: vorgeschlagen
- Datum: 2026-09-18
- Bezug: Feature-Gliederung v2.3, Abschnitte 1.5, 1.6, 4.2, 4.4, 5.1

## Kontext

Monteure erfassen Zeiten, Regieberichte, Prüfprotokolle, Fotos, Aufmaße und Mängel ohne Netz und synchronisieren später. Gleichzeitig verlangt GoBD, dass festgeschriebene Belege nur serverseitig und eindeutig entstehen. Das Konzept fordert sichtbare Konflikte, die der Nutzer entscheidet.

## Optionen

### A: CRDT-basiert (Automerge, Yjs)

- Vorteile: Automatische Zusammenführung ohne Konflikte; gut für gemeinsames Editieren von Texten.
- Nachteile: Fachliche Invarianten (Summen, Nummernkreise, „Beleg ist festgeschrieben“) lassen sich mit CRDTs nicht ausdrücken; Speicherwachstum; Debugging schwer; Konflikte werden versteckt statt entschieden, Widerspruch zum Konzept.

### B: Replikations-Engine (ElectricSQL, PowerSync, RxDB mit Replikation)

- Vorteile: Fertige lokale DB, Sync-Protokoll und Query-Layer; spart viel Eigenbau.
- Nachteile: Abhängigkeit von einem Produkt/Lizenzmodell (PowerSync kommerziell, Electric in Bewegung); Konfliktregeln je Entität nur eingeschränkt; RLS/Mandantenlogik muss in deren Modell passen.

### C: Eigener Outbox/Op-Log mit serverautoritativem Merge

- Vorteile: Volle Kontrolle über Konfliktregeln je Entität; GoBD-Grenze klar (Festschreibung nur online); schlank; keine Fremdabhängigkeit im Kern.
- Nachteile: Eigenbau von Queue, Delta-Pull, Konflikt-UI; muss sorgfältig getestet werden.

## Empfehlung

**Option C** als Kern, mit klaren Regeln:

1. **Lokaler Speicher:** IndexedDB (über Dexie) als Spiegel der für das Gerät relevanten Daten (eigene Aufträge, zugehörige Kunden/Objekte/Anlagen, Artikel-Favoriten, Formulardefinitionen, Regelpakete). Fotos als Blobs mit Größenlimit und Nachladen.
2. **Schreiben offline:** Jede Änderung ist eine Operation in einer Outbox (Entität, ID, Feld-Patch, Zeitstempel, Geräte-ID, Basisversion). UUIDv7 werden lokal erzeugt.
3. **Delta-Pull:** Server liefert Änderungen seit Cursor (`updated_at` + Versionsnummer je Zeile); Pull vor Push, damit Konflikte lokal sichtbar werden.
4. **Konfliktregeln je Entität** (im `domain`-Paket, nicht generisch):
   - Zeiteintrag, Regiebericht-Entwurf, Foto, Mangel, Aufmaß: *Letzter Schreiber des Feldes gewinnt* auf Feldebene, außer bei bereits unterschriebenen/festgeschriebenen Datensätzen → dann **Konflikt** (Nutzer entscheidet: eigene Version als neuen Entwurf anlegen oder verwerfen).
   - Prüfprotokoll: Messwerte je Stromkreis sind eigene Zeilen → parallele Erfassung unterschiedlicher Stromkreise kollidiert nicht; gleicher Stromkreis → Konflikt.
   - Belege (Angebot, Rechnung): offline nur **Entwürfe**; Festschreibung, Nummernvergabe, E-Rechnungs-Erzeugung ausschließlich online und serverseitig.
   - Stammdaten (Kunde, Artikel): offline nur lesen und neue anlegen; Änderungen an bestehenden Stammdaten nur online.
5. **Sichtbarkeit:** Sync-Panel mit Zähler unsynchronisierter Operationen, letzter erfolgreicher Sync, Konfliktliste mit beiden Versionen nebeneinander.
6. **Idempotenz:** Jede Operation hat eine ID; der Server verwirft Duplikate; Wiederholung nach Abbruch ist sicher.

Option B wird als Evaluierung offen gehalten: Sollte RxDB mit eigener Replikationsfunktion die Punkte 1-3 ohne Lizenzabhängigkeit abdecken, kann es den Eigenbau der Queue ersetzen; die Konfliktregeln (4) bleiben in jedem Fall eigener Code.

## Konsequenzen

- Phase 0 liefert die Outbox, den Delta-Pull und die Konfliktregeln für Zeiteintrag und Regiebericht, ohne mobile Oberfläche; Phase 1 baut die UI darauf.
- Alle Tabellen bekommen `version`, `updated_at`, `updated_by`, `device_id`; Soft-Delete mit `deleted_at` statt physischem Löschen (DSGVO-Löschung als separater, protokollierter Vorgang).
- Sync-Szenarien werden als Integrationstests mit zwei simulierten Geräten abgedeckt (offline schreiben, parallel ändern, unterschiedliche Reihenfolgen).
