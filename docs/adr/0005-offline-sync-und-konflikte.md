---
status: angenommen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.3, Abschnitte 1.5, 1.6, 4.2, 4.4, 5.1
informed: Mitwirkende der Organisation opengewerk
---

# Offline-Synchronisation und Konfliktauflösung

## Kontext und Problemstellung

Monteure erfassen Zeiten, Regieberichte, Prüfprotokolle, Fotos, Aufmaße und Mängel ohne Netz und synchronisieren später. Gleichzeitig verlangt GoBD, dass festgeschriebene Belege nur serverseitig und eindeutig entstehen. Das Konzept fordert sichtbare Konflikte, die der Nutzer entscheidet.

## Betrachtete Optionen

### A: CRDT-basiert (Automerge, Yjs)

- Vorteile: Automatische Zusammenführung ohne Konflikte; gut für gemeinsames Editieren von Texten.
- Nachteile: Fachliche Invarianten (Summen, Nummernkreise, „Beleg ist festgeschrieben“) lassen sich mit CRDTs nicht ausdrücken; Speicherwachstum; Debugging schwer; Konflikte werden versteckt statt entschieden, Widerspruch zum Konzept.

### B: Replikations-Engine (ElectricSQL, PowerSync, RxDB mit Replikation)

- Vorteile: Fertige lokale DB, Sync-Protokoll und Query-Layer; spart viel Eigenbau.
- Nachteile: Abhängigkeit von einem Produkt/Lizenzmodell (PowerSync kommerziell, Electric in Bewegung); Konfliktregeln je Entität nur eingeschränkt; RLS/Mandantenlogik muss in deren Modell passen.

### C: Eigener Outbox/Op-Log mit serverautoritativem Merge

- Vorteile: Volle Kontrolle über Konfliktregeln je Entität; GoBD-Grenze klar (Festschreibung nur online); schlank; keine Fremdabhängigkeit im Kern.
- Nachteile: Eigenbau von Queue, Delta-Pull, Konflikt-UI; muss sorgfältig getestet werden.

## Entscheidung

Gewählt wurde **Option C, eigene Outbox mit serverautoritativem Merge**, mit diesen Regeln:

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
- **Nachtrag vom 18.09.2026, Feldebene ohne Uhr.** Punkt 4 sagt "letzter Schreiber des Feldes gewinnt". Umgesetzt ist das ohne Uhrenvergleich: ein Vorgang trägt je Feld mit, welchen Wert das Gerät dort gesehen hat, und der Server lässt durch, was seitdem niemand sonst angefasst hat. Zwei Geräte an verschiedenen Feldern desselben Datensatzes gehen damit beide durch, das ist die Feldebene. Beim selben Feld entscheidet aber **nicht** der spätere Zeitstempel, sondern es wird ein Konflikt. Grund ist die Uhr: sie steht auf zwei Geräten verschieden, und ein Gerät, das einen Tag offline war, brächte einen Anspruch mit, den niemand nachprüfen kann. Nach Zeitstempel zu entscheiden wäre genau die stille Auflösung, wegen der oben die CRDTs abgelehnt wurden.
- **Nachtrag vom 18.09.2026, ein Vorgang wirkt ganz oder gar nicht.** Kollidiert eines seiner Felder, landet keines. Eine halb angewandte Änderung ergäbe einen Datensatz, den keines der beiden Geräte gemeint hat, und die Konfliktliste zeigte nur die Hälfte dessen, worüber zu entscheiden ist.
- **Nachtrag vom 18.09.2026, Stammdaten anlegen braucht trotzdem das Recht.** Punkt 4 stellt sich vor, dass ein Monteur vor Ort einen Kunden anlegt. Die Abgleichregel erlaubt das auch, aber ob es jemand darf, entscheidet das Rechtemodell aus ADR 0006 und nicht der Abgleich: eine Warteschlange ist ein anderer Weg hinein, keine andere Sache. Am 18.09.2026 hatte der Monteur dort nur `customer.read`, das Anlegen war ihm also verwehrt, und die Frage, ob er ein eigenes Recht dafür bekommen soll, ging an das Issue, das die Rollen erweitert. **Entschieden am 19.09.2026:** er hat jetzt `customer.create`, ein Recht, das anlegt und nicht ändert, siehe den Nachtrag von diesem Tag in ADR 0006. Die Regel dieses Absatzes steht unverändert, geändert hat sich nur ihre Antwort in diesem einen Fall. Ändern bleibt auch aus der Warteschlange verwehrt, und zwar zweimal: dem Monteur fehlt das Recht, und für alle anderen sagt die Abgleichregel oben, dass Stammdaten online geändert werden.
- **Nachtrag vom 18.09.2026, der Zeiteintrag fehlt.** Oben steht, Phase 0 liefere die Konfliktregeln für Zeiteintrag und Regiebericht. Den Zeiteintrag gibt es nicht: Zeiterfassung steht in Phase 1, und eine Tabelle zu erfinden, damit eine Liste vollständig aussieht, wäre schlimmer als die Lücke. Die Regel dafür ist dieselbe wie für alles, was ein Monteur ausfüllt, und die Stelle ist in den Abgleichregeln benannt.
- **Nachtrag vom 19.09.2026, gelöscht ist ein eigener Zustand im Abgleich.** Punkt 4 zählt Konfliktregeln je Entität auf und schweigt zum Löschen, obwohl die Konsequenzen unten den Soft-Delete festlegen. Was fehlte, war die Verbindung zwischen beidem. Weil nichts wirklich entfernt wird, findet der Abgleich eine gelöschte Zeile weiterhin, und eine Änderung daran wurde mit "angewendet" quittiert und landete auf einem Datensatz, den keine Liste mehr zeigt. Es gilt jetzt: eine Änderung an einer gelöschten Zeile ist ein Konflikt mit dem Grund "nicht mehr da", ein wiederholtes Löschen ist übersprungen und kein Konflikt, weil eine doppelt gesendete Warteschlange keine Meinungsverschiedenheit ist, und `deleted_at` ist eine Spalte, die nur der Server schreibt. Ein Gerät, das sie als gewöhnliches Feld setzt, ginge sonst am Löschpfad vorbei, und eines, das sie auf null zurücksetzt, machte eine Löschung rückgängig, die niemand zurückgenommen hat. Die gelöschte Zeile muss dabei weiterhin gefunden werden: daran hängt, dass ein zweites Anlegen desselben Datensatzes übersprungen wird statt am Primärschlüssel zu scheitern.
- **Nachtrag vom 19.09.2026, Löschen kollidiert mit jeder zwischenzeitlichen Änderung.** Ein Löschvorgang trägt keine Feld-Patches, der Feldvergleich aus Punkt 4 greift also nicht, und bis hierher wurde jedes Löschen angewendet. Maßgeblich ist stattdessen die Basisversion: weicht sie vom Stand des Servers ab, ist es ein Konflikt mit dem Grund "anderswo geändert". Das ist keine Verschärfung, sondern dieselbe Regel eine Ebene höher. Löschen betrifft jedes Feld auf einmal, kollidiert also zu Recht mit allem, was inzwischen geschrieben wurde, und die Frage, ob der Datensatz trotz der Änderung weg soll, gehört vor einen Menschen. Hat das Gerät keine Basisversion mitgeschickt, hat es nichts über den Stand behauptet, und das Löschen steht.
- **Nachtrag vom 19.09.2026, der Cursor darf nur so weit wie die langsamste Entität.** Punkt 3 sagt "Änderungen seit Cursor" und lässt offen, was bei einer Obergrenze je Abruf gilt. Die Grenze wirkt je Entität, der Cursor war aber das Höchste, was im ganzen Abruf vorkam. Hatte eine Entität mehr ausstehende Änderungen als hineinpassen und eine andere eine einzige mit einer höheren Nummer, dann bekam das Gerät die Nummer der anderen und alles dazwischen fiel für immer aus dem Fenster: ohne Fehler, ohne Hinweis, und es trifft genau das Gerät, das lange offline war, also den Zweck der ganzen Konstruktion. Der Cursor bleibt jetzt bei der niedrigsten Entität stehen, die ihre Grenze ausgeschöpft hat, und die Antwort trägt ein Kennzeichen, dass noch etwas aussteht. Zeilen oberhalb dieser Nummer kommen beim nächsten Abruf ein zweites Mal, und das ist die richtige Richtung: eine Zeile doppelt zu senden kostet nichts, eine zu verlieren ist endgültig. Die Form der Antwort gehört damit zum Vertrag mit den Geräten, sie zu ändern ist teurer, sobald Geräte im Feld sind.
