---
status: angenommen
date: 2026-10-19
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" (Abschnitte 2.1, 4.2, 10 und 12), Entscheidungen vom 08.10.2026 und 15.10.2026 an opengewerk-haustechnik#180, ADR 0008, 0010 und 0011
informed: Mitwirkende der Organisation opengewerk
---

# Elektro-Struktur und PV-Struktur im Fundament

## Kontext und Problemstellung

Unter einer Anlage der Handwerkersoftware liegt seit #70 ihre Elektro-Struktur: Verteiler, Felder, Stromkreise mit Schutzorgan, Fehlerstromschutz und Leitung, und an jedem Stromkreis seine Betriebsmittel. Seit #300 hat eine PV-Anlage dort ihre Wechselrichter, Strings und Module. Aus der Struktur druckt die Handwerkersoftware das Stromkreisverzeichnis für die Tür eines Verteilers, und die Formulare des Pakets Elektro lesen ihre Stromkreise. Alles liegt in `domain`, im Server und in `web` der Handwerkersoftware (`model/electrical.ts`, `model/photovoltaic.ts`, `database/schema/electrical.ts`, `photovoltaic.ts`, `electrical/`, `app/electrical.tsx`, `app/photovoltaic.tsx`), die Tabellen seit `0000_datenmodell_kern.sql`, die Einzelheiten der Stromkreise seit `0030_circuit_details.sql`.

OpenGewerk Haustechnik braucht dieselbe Struktur unter ihren Anlagen. Ihr Planungskonzept sagt in Abschnitt 2.1, die Elektro-Struktur unter einer Anlage sei die von OpenGewerk; Abschnitt 4.2 hängt sie unter die Niederspannungsanlage, mit einem Blatt im Stromkreisverzeichnis je Verteiler, und Abschnitt 12 legt die Messwerte je Stromkreis in Phase 2. Moritz hat am 08.10.2026 entschieden, dass die Struktur dafür ins Fundament zieht und beide Anwendungen sie dort binden, und später, dass die PV-Struktur mitkommt (opengewerk-haustechnik#180).

Anders als Lager (ADR 0011) und Qualifikationen (ADR 0012) entsteht hier nichts neu. Es gibt ein Modell, mit Tabellen in jeder Instanz der Handwerkersoftware und mit Daten darin. Die Frage ist, wie es ins Fundament kommt, ohne dass das Fundament die Anlage der Handwerkersoftware kennt und ohne dass eine laufende Instanz eine Migration braucht.

## Entscheidungstreiber

- Ein Modell der Struktur in der Organisation, nicht zwei (ADR 0010).
- Das Fundament kennt keine Anwendung: nicht die Anlage, an der ein Verteiler hängt, nicht die Arten von Anlagen, die zu einer PV-Anlage gehören, keinen Kunden, kein Objekt und keinen Auftrag.
- Die Tabellen in den Instanzen der Handwerkersoftware bleiben, wie sie sind; der Umzug ist für eine laufende Instanz keine Migration.
- Was die Handwerkersoftware an der Struktur gelernt hat, gilt in beiden Anwendungen: die Grenzen der Werte, welche Auslösecharakteristik zu welchem Schutzorgan passt, dass ein Stromkreis kein Feld eines anderen Verteilers nennt und dass jeder Teil über den Mandanten an seinem Vorgänger hängt.
- Die Struktur wird vor Ort ohne Netz aufgenommen; alle Tabellen reisen.
- Die Haustechnik hängt an jeden Datensatz mit Ort ihre Liegenschaft und ihren Bereich. Das muss an jeder Tabelle der Struktur gehen, ohne dass das Fundament von Bereichen weiß.

## Betrachtete Optionen

1. Die Haustechnik baut die Struktur nach.
2. Die Tabellen ziehen unverändert ins Fundament, mit `installation_id`.
3. Regeln, Tabellenfabriken, die Prüfungen des Abgleichs, das Stromkreisverzeichnis und die Teile der Bildschirme ziehen ins Fundament. Woran die Struktur hängt, gibt die Anwendung als eigene Spalte hinein, und die Handwerkersoftware bindet den Baustein im selben Schritt.

## Entscheidung

Gewählt: **Option 3**, entschieden von Moritz am 19.10.2026 ("Mach das so").

- **In `platform-domain`** (`model/electrical.ts`, `model/photovoltaic.ts`): die Arten der Verteiler, die Schutzorgane, Auslösecharakteristiken, Typen der Fehlerstrom-Schutzeinrichtungen und Verlegearten mit ihren Namen; die Typen `DistributionBoard`, `BoardSection`, `Circuit`, `Equipment`, `Inverter`, `PvString` und `PvModule`, ohne das, woran ein Verteiler oder ein Wechselrichter hängt; die Grenzen und Prüfungen (`circuitProblems`, `characteristicsFor`, `pvLimits`, `inverterProblems`, `pvStringProblems`, `pvModuleProblems`, `serialNumberProblem`) und die Texte, mit denen Büro, Gerät und Blatt einen Wert zeigen (`overcurrentText`, `cableText`, `peakPower`, `azimuthName` und die übrigen). Die Werte bleiben, wie sie sind: Ströme, Querschnitte und Längen in Tausendsteln, Leistung in ganzen Watt, Richtung und Neigung in ganzen Grad.
- **Bei der Anwendung bleibt, was ihre Anlage kennt**: welche Arten von Anlagen zu einer PV-Anlage gehören (`pvCompanionKinds` der Handwerkersoftware), die Verweise einer Anlage auf ihre PV-Anlage und ihren Wechselrichter (`pv_system_id`, `inverter_id` an `installations`) und deren Prüfungen.
- **In `platform-server`** (`database/schema/electrical.ts`, `photovoltaic.ts`): die Fabrik `electricalSchema` mit `distribution_boards`, `board_sections`, `circuits` und `equipment` samt ihren fünf Enums, und die Fabrik `photovoltaicSchema` mit `inverters`, `pv_strings` und `pv_modules`. Sie legen Tabellen, Schlüssel, Prüfungen und Indizes mit den Namen an, die die Handwerkersoftware heute hat. Eine Anwendung gibt an jede Tabelle eigene Spalten und Bedingungen hinein, wie bei den Ansprechpartnern und beim Lager. **Woran ein Verteiler und ein Wechselrichter hängen, ist eine solche eigene Spalte**: `installation_id` in der Handwerkersoftware, die Anlage samt Liegenschaft und Bereich in der Haustechnik. Die Schlüssel innerhalb der Struktur (Feld an Verteiler, Stromkreis an Verteiler und Feld, Betriebsmittel an Stromkreis, String an Wechselrichter, Modul an String) legt die Fabrik an, über den Mandanten wie bisher. Was `drizzle-kit` nicht schreibt, schreibt die Migration der Anwendung: dass beim Entfernen eines Felds seine Stromkreise ohne Feld am Verteiler bleiben (`set null` nur für die eine Spalte), die Rechte und die Trigger, die beim Markieren eines Teils mitmarkieren, was darunter hängt.
- **Die Prüfungen des Abgleichs** liegen in `platform-server`: was ein Gerät an Art, Werten und Grenzen eines Teils gar nicht senden darf (`structureProblem`), und dass das Feld eines Stromkreises zu seinem Verteiler gehört (`sectionRefusal`). Die Anwendung ruft beide aus ihren Prüfungen des Abgleichs; die Prüfung der Verweise einer Anlage auf ihre PV-Anlage bleibt bei ihr.
- **Das Stromkreisverzeichnis** (`circuitChartJob`, quer, ein Blatt je Verteiler) liegt in `platform-server` bei den Druckhelfern. Die Anwendung gibt hinein, was im Kopf steht: wer das Verzeichnis führt und wie man ihn erreicht, woran die Verteiler hängen und wo. Route und Recht bleiben bei ihr.
- **In `platform-web`** unter einem neuen Einstieg `/electrical`: die Formulare (`CircuitForm`, `PvForm`, die Felder von Verteiler, Feld und Betriebsmittel), das Lesen eines Werts mit Einheit (`readFigure`), die Reihenfolge der Teile, die Gruppen und die Zeilen, die einen Teil beschreiben. Die Bildschirme selbst mit ihren Adressen, Rechten und ihrer Navigation bleiben bei der Anwendung, wie bei Lager und Qualifikationen, und bauen aus diesen Teilen.
- **Die Wörter des Änderungsprotokolls** für die sieben Tabellen und ihre Spalten kommen aus dem Fundament, weil beide Anwendungen dieselben Tabellen führen (`structureAuditTables` mit den Teilen, Verweisen und Titeln daneben). Eine Anwendung nimmt sie in ihr Vokabular; unter den Tabellen, die das Protokoll jedes Mandanten hält, stehen sie nicht, weil eine Anwendung die Struktur erst anlegt, wenn sie sie braucht. Wie der Verweis auf die Anlage heißt, sagt die Anwendung.
- **Abgleich, Rechte und was ein Gerät bekommt** bleiben Register der Anwendung (ADR 0010, Punkt 3): welche Felder abgleichen, mit welchem Recht, und welche Geräte die Struktur mitnehmen.
- **Die Handwerkersoftware bindet den Baustein im selben Pull Request** und führt danach keine eigene Fassung mehr. Ihre Tabellen bleiben unverändert; dass `drizzle-kit generate` keinen Unterschied findet, ist die Prüfung, dass der Umzug keine Migration ist.
- **Die Haustechnik bindet ihn mit opengewerk-haustechnik#349** unter der Niederspannungsanlage, mit einer eigenen Migration und dem Stromkreisverzeichnis. Was die Formulare mit Stromkreis brauchen (die Wiederholgruppe je Stromkreis und die Rechner der Grenzwerte, heute `forms/circuits.ts` der Handwerkersoftware), zieht mit opengewerk-haustechnik#350 nach, wenn die Haustechnik es zum ersten Mal bindet.

### Konsequenzen

- Gut: eine Fassung der Struktur. Was die Handwerkersoftware an echten Verteilern geprüft hat, gilt in der Haustechnik vom ersten Tag an.
- Gut: keine Migration in einer Instanz der Handwerkersoftware.
- Gut: die Haustechnik hängt die Struktur an ihre Anlage mit Liegenschaft und Bereich, ohne dass das Fundament davon weiß.
- Schlecht: wer an der Struktur etwas ändert, ändert das Fundament, und jede Anwendung braucht dieselbe Änderung als eigene Migration (die zwei Schritte aus ADR 0010).
- Schlecht: die Bildschirme stehen in jeder Anwendung. Zeigt sich mit opengewerk-haustechnik#349, dass sie fast gleich sind, holt ein Nachtrag sie hierher.
- **Nachtrag vom 19.10.2026, die Formulare mit Stromkreis ziehen nach.** Für opengewerk-haustechnik#350, wie unter Entscheidung angekündigt. Was ein Formular über die Stromkreise einer Anlage weiß, steht jetzt in `platform-domain` (`forms/circuits.ts`): was ein Block von seinem Stromkreis hält (`CircuitFacts`, `BlockCircuit`, `isBlockCircuit`), die Liste, über die eine Gruppe je Stromkreis wiederholt (`circuitList`), und die beiden Rechner der Grenzwerte (`loopImpedance`, `residualTripCurrent`). Die Rechner gelten für die Begriffe jeder Anwendung und lesen ihre Regeln über die Schlüssel `elektro.loop.factor_b`, `_c`, `_d`, `elektro.loop.nominal_voltage` und `elektro.rcd.trip_current_maximum`. In `platform-web` gibt `useBlockCircuitsOf` unter `/electrical` die Stromkreise eines Datensatzes in der Reihenfolge des Stromkreisverzeichnisses, gefragt wie bei `useBoardsOf` über das Feld, das ihn am Verteiler nennt. Die Handwerkersoftware bindet beides mit `installationId` und führt keine eigene Fassung mehr, ihre Protokolle rechnen und ordnen wie bisher. Die Haustechnik bindet es mit opengewerk-haustechnik#350 an die Formulare ihres Pakets Elektro.

## Bestätigung

- Die Tests von Regeln und Texten liegen in `platform-domain`, die der Fabriken, der Prüfungen des Abgleichs und des Stromkreisverzeichnisses in `platform-server`, die der Formulare und Teile in `platform-web`; sie ziehen mit ihren Dateien aus der Handwerkersoftware um.
- Die Tests der Handwerkersoftware an Struktur, PV-Struktur und Stromkreisverzeichnis bleiben, wo sie sind, und laufen gegen den Baustein; `drizzle-kit generate` findet keinen Unterschied.
- Der Pakettest des Fundaments findet keinen Namen einer Anwendung und keines der Wörter, die die Regel "Das Fundament kennt keine Anwendung" ausschließt.

## Vor- und Nachteile der Optionen

### Option 1: die Haustechnik baut nach

- Gut: kein Umzug in der Handwerkersoftware.
- Schlecht: zwei Fassungen, die auseinanderlaufen; genau das schließt ADR 0010 aus, und Moritz hat es am 08.10.2026 verworfen.

### Option 2: die Tabellen unverändert ins Fundament

- Gut: der kleinste Umzug.
- Schlecht: das Fundament nennt die Anlage der Handwerkersoftware (`installation_id`, die Tabelle `installations`), und die Haustechnik könnte Liegenschaft und Bereich nicht anhängen.

### Option 3: Regeln, Fabriken und Teile, die Anlage als eigene Spalte

- Gut: ein Modell, das keine Anwendung kennt; jede gibt hinein, woran es bei ihr hängt.
- Gut: die Handwerkersoftware behält ihre Tabellen, ihre Instanzen merken nichts.
- Schlecht: der Umzug ist groß (rund 4.500 Zeilen Code und 2.000 Zeilen Tests) und fasst Bildschirme an, die in Betrieb sind.

## Weitere Informationen

- opengewerk-haustechnik#180 (dieser Umzug), #349 (die Haustechnik bindet die Struktur), #350 (Formulare und Messwerte je Stromkreis).
- opengewerk#70 (die Elektro-Struktur), opengewerk#300 (die PV-Struktur).
- Das Muster der Fabrik: die Ansprechpartner (Nachtrag in ADR 0010), ADR 0011, ADR 0012.
- Der Nachtrag vom 19.10.2026 in ADR 0010 hält die Regel fest, nach der ein Fachmodell einer Anwendung ins Fundament zieht.
