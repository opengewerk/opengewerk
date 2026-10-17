---
status: angenommen
date: 2026-10-17
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.40 (Abschnitte 2.1, 4.3 und 5), Entscheidungen vom 15.10.2026 an opengewerk-haustechnik#337, ADR 0010, ADR 0011
informed: Mitwirkende der Organisation opengewerk
---

# Qualifikationen der Mitarbeiter im Fundament

## Kontext und Problemstellung

OpenGewerk Haustechnik braucht in Phase 2 die Qualifikationen der Mitarbeiter mit Ablaufdatum: Elektrofachkraft, zur Prüfung befähigte Person für ein Arbeitsmittel, Hygieneschulung, Sachkunde (opengewerk-haustechnik#337). Wird ein Vorgang jemandem zugeteilt, dem die geforderte Qualifikation fehlt oder abgelaufen ist, weist die Oberfläche darauf hin. Die Handwerkersoftware plant dieselben Angaben für ihre Mitarbeiterakte.

Daraus folgt die Frage: Wo entsteht das Modell der Qualifikationen, ohne dass zwei Fassungen davon in der Organisation auseinanderlaufen?

## Entscheidungstreiber

- Ein Modell der Qualifikationen in der Organisation, nicht zwei (ADR 0010).
- Das Fundament kennt keine Anwendung: keinen Katalog von Paketen, keine Pflichtart, keinen Vorgang.
- Woher die Arten kommen, sagt die Anwendung: die Haustechnik aus ihren Paketen, ergänzt um eigene Arten des Mandanten.
- Eine Qualifikation ist eine personenbezogene Angabe; ihr Nachweis darf nicht in einer Ablage landen, die jede Rolle liest.
- Die eigenen Qualifikationen braucht eine Person auch ohne Netz, für den Hinweis beim Beginn eines Vorgangs vor Ort.

## Betrachtete Optionen

1. Die Haustechnik führt die Qualifikationen allein.
2. Regeln und eine Tabellenfabrik im Fundament, wie beim Lager (ADR 0011).

## Entscheidung

Gewählt: **Option 2**, entschieden von Moritz am 15.10.2026 ("Qualifikationen entstehen im Fundament wie das Lager").

- **In `platform-domain`** (`model/qualification.ts`): die Stufen, die eine Person hält (`personLevels`: unterwiesene Person, Fachkraft, zur Prüfung befähigte Person; eine Überwachungsstelle, ein Sachverständiger und ein Labor sind Firmen und halten keine), die Grenzen (`qualificationLimits`), die Prüfungen einer eigenen Art und einer Qualifikation (`qualificationKindProblems`, `qualificationProblems`), wie eine Qualifikation an einem Tag steht (`qualificationStanding`: gültig, läuft bald ab, abgelaufen) und ob eine Person die Art hält, die eine Arbeit fordert (`qualificationCheck`: gehalten, abgelaufen, fehlt).
- **Eine Qualifikation nennt genau eine Art**: den Schlüssel einer Art aus dem Katalog der Anwendung (`kind_key`, etwa `elektro.skilled_person`) oder eine eigene Art des Mandanten (`own_kind_id`). Die Datenbank hält, dass es genau eine ist.
- **In `platform-server`** (`database/schema/qualifications.ts`): die Fabrik `qualificationSchema()` mit zwei Tabellen, `qualification_kinds` (eigene Arten mit Bezeichnung und Stufe) und `qualifications` (je Person eine Art, gültig bis, Notiz, Nachweis). Beide tragen die Spalten des Abgleichs und werden markiert statt gelöscht. Die Person ist ein Konto dieses Mandanten, der Nachweis eine Datei seines Speichers.
- **Der Nachweis bleibt an der Qualifikation** (`certificate_sha256`) und geht nicht in die Ablage: wer ihn liest, entscheidet das Recht der Qualifikationen, nicht das der Dokumente.
- **Routen, Rechte, Vokabular des Änderungsprotokolls, die Frist des Ablaufs und die Oberfläche bleiben bei der Anwendung**, wie beim Lager. Die Haustechnik bindet den Baustein mit #337; gemeinsame Routen entstehen, wenn die Handwerkersoftware ihn für die Mitarbeiterakte bindet.

### Konsequenzen

- Gut: ein Modell für beide Anwendungen; die Regel, ob jemand eine geforderte Art hält, steht an einer Stelle.
- Gut: der Katalog und was eine Arbeit fordert bleiben bei der Anwendung, die sie kennt.
- Schlecht: bis die Handwerkersoftware den Baustein bindet, stehen Routen und Oberfläche nur in der Haustechnik.

## Bestätigung

- `packages/platform/domain/src/model/qualification.test.ts` hält Regeln, Stand und Prüfung, `packages/platform/server/src/database/schema/qualifications.test.ts` die Fabrik.
- Die Haustechnik bindet den Baustein mit opengewerk-haustechnik#337 und prüft die Tabellen in ihrer Datenbank.

## Vor- und Nachteile der Optionen

### Option 1: die Haustechnik allein

- Gut: schnell, keine Rücksicht auf die Handwerkersoftware.
- Schlecht: die Mitarbeiterakte der Handwerkersoftware bekäme ein zweites Modell; genau das schließt ADR 0010 aus.

### Option 2: Regeln und Tabellenfabrik im Fundament

- Gut: ein Modell, das keine Anwendung kennt; Katalog und Arbeit bleiben bei der Anwendung.
- Schlecht: eine Fabrik mehr, die jede Anwendung mit einer eigenen Migration bindet.

## Weitere Informationen

- opengewerk-haustechnik#337 (Qualifikationen), das Muster der Fabrik aus ADR 0011.
