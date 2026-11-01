---
status: angenommen
date: 2026-11-01
decision-makers: Projektleitung OpenGewerk
consulted: Feature-Gliederung v2.24 (4.9), Issue #287 mit den Entscheidungen vom 27.09.2026 und 01.11.2026, ADR 0010, ADR 0011, ADR 0012
informed: Mitwirkende der Organisation opengewerk
---

# Personen im Fundament

## Kontext und Problemstellung

Die Handwerkersoftware baut in Phase 2 die Mitarbeiterakte (#287): je Person Eintritt und Austritt, die vereinbarte Arbeitszeit mit Gültigkeit ab einem Tag und die Qualifikationen mit Ablauf. Am 27.09.2026 ist entschieden, dass es eine Akte auch für jemanden ohne Zugang gibt, etwa einen Helfer ohne Telefon, der trotzdem auf der Plantafel steht, und dass jede Person ihre eigene Akte liest.

ADR 0012 hängt eine Qualifikation an ein Konto des Mandanten (`qualifications.user_id`). Eine Person ohne Zugang hat kein Konto und könnte damit keine Qualifikation halten, obwohl gerade ein Helfer eine Unterweisung oder einen Führerschein nachweisen muss. Urlaub (#288), Zeitkonto (#289) und Plantafel (#290) lesen aus der Akte und brauchen ebenfalls Personen, nicht Konten.

Daraus folgt die Frage: Woran hängen Akte, Arbeitszeit und Qualifikationen, und wo entstehen sie?

## Entscheidungstreiber

- Eine Person, die für den Mandanten arbeitet, ist nicht dasselbe wie ein Zugang: der Zugang ist die Anmeldung, die Akte das Arbeitsverhältnis.
- Ein Modell in der Organisation, nicht zwei (ADR 0010): OpenGewerk Haustechnik hält die Qualifikationen schon über den Baustein aus ADR 0012.
- Das Fundament kennt keine Anwendung: keinen Katalog von Arten, kein Recht, keine Frist.
- Die Akte trägt Beschäftigtendaten; wer sie liest, entscheidet ein eigenes Recht, und die eigene Akte liest jede Person ohne ein solches.
- Eine geänderte Arbeitszeit gilt ab ihrem Tag; was für die Zeit davor galt, bleibt lesbar, wie bei einem Regelpaket.

## Betrachtete Optionen

1. Die Akte entsteht in der Handwerkersoftware, die Qualifikationen bleiben am Konto.
2. Die Person entsteht im Fundament als Tabelle und Regel; Routen und Oberfläche baut jede Anwendung selbst.
3. Die Person entsteht im Fundament mit Arbeitszeit, Routen und Oberfläche der Akte, wie Zugänge, Kontakte und Lager.

## Entscheidung

Gewählt: **Option 3**. Dass die Akte eine Person im Fundament ist, mit Konto oder ohne, und dass die Qualifikationen an der Person statt am Konto hängen, hat Moritz am 01.11.2026 entschieden (Kommentar an #287). Routen und Oberfläche folgen dem letzten Satz von ADR 0012, nach dem gemeinsame Routen entstehen, wenn die Handwerkersoftware den Baustein für die Mitarbeiterakte bindet.

- **In `platform-domain`** (`model/person.ts`): die Person mit Name, Eintritt und Austritt, ihre Grenzen und Prüfungen und wie sie an einem Tag steht (noch nicht eingetreten, beschäftigt, ausgetreten); die vereinbarte Arbeitszeit als Minuten je Wochentag ab einem Tag, ihre Prüfung und welche an einem Tag gilt (`workingTimeOn`).
- **In `platform-server`**: die Fabrik `peopleSchema()` mit zwei Tabellen. `people` hält je Person den Namen, Eintritt, Austritt und höchstens ein Konto dieses Mandanten; ein Konto gehört höchstens zu einer Person. `working_times` hält je Person und Tag eine vereinbarte Arbeitszeit. Beide tragen die Spalten des Abgleichs und werden markiert statt gelöscht.
- **Eine Arbeitszeit gilt ab ihrem Tag bis zum Tag vor der nächsten.** Hat ihr Tag begonnen, bleibt sie, wie sie ist; eine Änderung ist eine neue Arbeitszeit ab einem späteren Tag. So rechnet ein vergangener Monat nach der Zeit, die damals galt.
- **Die Qualifikationen hängen an der Person** (`qualifications.person_id`), `qualificationSchema()` bekommt dafür die Tabelle der Personen. Alles andere aus ADR 0012 bleibt: genau eine Art je Qualifikation, der Nachweis an ihr.
- **Routen und Bildschirme der Akte stehen im Fundament**: die Liste der Personen, die Akte mit Arbeitszeit und Qualifikationen, die eigenen Arten des Mandanten und die eigene Akte unter "Konto". Die Anwendung gibt das Recht, das Akten liest und pflegt, den Katalog ihrer Arten, das Vokabular des Änderungsprotokolls und die Frist des Ablaufs. Die eigene Akte liest eine Person über ihr Konto, ohne ein Recht der Akte.
- **Die Haustechnik zieht beim nächsten Anheben des Submoduls nach**: eine Migration legt je Konto, das eine Qualifikation hält, eine Person an und hängt die Qualifikationen an sie. Ob sie dabei ihre eigenen Routen der Qualifikationen behält oder die gemeinsamen bindet, entscheidet sie dort.

### Konsequenzen

- Gut: ein Helfer ohne Zugang hat eine Akte und hält Qualifikationen; Urlaub, Zeitkonto und Plantafel lesen Personen.
- Gut: eine Akte für beide Anwendungen, mit einer Oberfläche, wie bei Zugängen und Lager.
- Schlecht: der Baustein aus ADR 0012 ändert sich, und die Haustechnik braucht beim Anheben eine Migration, die bestehende Zeilen umhängt.
- Schlecht: Name und Konto stehen nebeneinander; wer den Namen am Konto ändert, ändert nicht den in der Akte.

## Bestätigung

- `packages/platform/domain/src/model/person.test.ts` hält die Regeln der Person und der Arbeitszeit, `packages/platform/server/src/database/schema/people.test.ts` die Fabrik.
- `packages/server/src/api/people.test.ts` hält Rechte je Rolle, die eigene Akte, die Arbeitszeit ab einem Tag und die Mandantentrennung.

## Vor- und Nachteile der Optionen

### Option 1: die Akte in der Handwerkersoftware, Qualifikationen am Konto

- Gut: der Baustein aus ADR 0012 bleibt, wie er ist.
- Schlecht: eine Person ohne Zugang hält keine Qualifikation, und die Haustechnik bekäme für ihre Mitarbeiter ein zweites Modell, sobald sie eines braucht.

### Option 2: Tabelle und Regel im Fundament, Routen je Anwendung

- Gut: das Fundament wächst weniger.
- Schlecht: zwei Fassungen derselben Routen und Bildschirme, und genau die schließt ADR 0010 aus; ADR 0012 hat gemeinsame Routen angekündigt.

### Option 3: Person, Arbeitszeit, Routen und Oberfläche im Fundament

- Gut: eine Akte, die keine Anwendung kennt; Recht, Katalog und Frist bleiben bei der Anwendung.
- Schlecht: mehr Bausteine, die jede Anwendung mit einer eigenen Migration bindet.

## Weitere Informationen

- #287 (Mitarbeiterakte), #288 (Urlaub), #289 (Zeitkonto), #290 (Plantafel); opengewerk-haustechnik#337 (Qualifikationen).
- ADR 0012 trägt `amended-by: 0016`; sein Text bleibt.
