---
status: angenommen
date: 2026-10-30
decision-makers: Projektleitung OpenGewerk
consulted: Messung vom 30.10.2026 an 700.000 Artikeln, Issue #461, ADR 0003 und 0006
informed: Mitwirkende der Organisation opengewerk
---

# Eine Suchtabelle für Artikel außerhalb von FORCE

## Kontext und Problemstellung

Mit dem Sortiment eines Großhändlers liegen 700.000 Artikel und mehr im Katalog eines Betriebs (#297). Die Suche über Nummer, Bezeichnung, EAN und die Nummern der Lieferanten ist dieselbe in der Artikelliste des Büros, bei „Position aus Artikel“ und bei „Material eintragen“ auf der Baustelle. Sie las bei jeder Eingabe den ganzen Katalog: gemessen am 30.10.2026 auf der Testdatenbank als Anwendungsrolle 1,35 s je Suche (#461).

Der naheliegende Weg ist ein Trigramm-Index (`pg_trgm`). Unter Row-Level Security nutzt PostgreSQL einen Index aber nur für einen Vergleich, den es als „leakproof“ kennt: Eine Bedingung der Abfrage darf keine Zeile sehen, bevor die Policy über sie entschieden hat, sonst könnte sie über eine Fehlermeldung oder die Laufzeit verraten, was in einer fremden Zeile steht. `LIKE`, `ILIKE` und die Operatoren von `pg_trgm` sind nicht so markiert. Markieren darf das nur ein Superuser, und die Migrationen laufen als Eigentümer der Tabellen, nicht als Superuser. Ein Trigramm-Index auf `articles` bleibt deshalb ungenutzt, geprüft an 300.000 und an 700.000 Zeilen: PostgreSQL liest die Tabelle ganz.

Seit 0004 gilt: Jede Tabelle hat Row-Level Security an und erzwungen (FORCE), eine Policy und ein Recht für die Anwendung, und die Prüfung des Fundaments hält das bei jedem Testlauf fest. Ein Index für die Suche geht nur mit einer Ausnahme davon.

## Entscheidungstreiber

- Eine Suche antwortet bei 700.000 Artikeln unter 300 ms und wird mit einem zweiten Lieferanten nicht doppelt so langsam.
- Kein Betrieb sieht je einen Artikel eines anderen.
- Die Ausnahme ist so klein, dass sie sich mit einem Test vollständig festhalten lässt, und die Prüfung des Fundaments nennt sie, statt sie zu übersehen.

## Betrachtete Optionen

1. Eine abgeleitete Suchtabelle ohne FORCE, die die Anwendung nicht lesen darf, gelesen nur über eine Funktion, die selbst nach dem Betrieb fragt.
2. Ohne Ausnahme: die Abfrage umbauen und weiter jede Zeile lesen.
3. Die Operatoren als leakproof markieren, von Hand als Superuser auf jeder Instanz.

## Entscheidung

Gewählt: Option 1, entschieden von Moritz am 30.10.2026.

- `article_search` hält je Artikel eine Zeile mit Nummer, Bezeichnung und EAN und je Nummer eines Lieferanten eine weitere, klein geschrieben, unter einem Trigramm-Index. Neues steht darin nicht: Jede Zeile wiederholt, was ihr Artikel oder ihre Verbindung zum Lieferanten sagt.
- Row-Level Security ist an, die Policy des Betriebs steht, aber erzwungen ist sie nicht, und die Anwendung hat kein Recht an der Tabelle. Der Eigentümer liest sie deshalb ohne Policy und mit dem Index.
- Geschrieben wird sie nur von den Triggern auf `articles` und `supplier_articles`, einmal je Anweisung, aus den Zeilen, die die Anweisung geschrieben hat. Entfernt wird mit der Zeile, die sie wiederholt, über den Fremdschlüssel.
- Gelesen wird sie nur über `article_search_hits(pattern)`. Die Funktion läuft als Eigentümer, fragt selbst nach dem Betrieb der Transaktion und findet ohne Betrieb nichts. Sie gibt nur Kennungen von Artikeln zurück; was die Liste zeigt, liest die Route weiter unter der Policy aus `articles`.
- Der Name eines Lieferanten steht nicht in der Tabelle. Ihn umzubenennen hieße, jede Zeile seines Sortiments neu zu schreiben; die Route fragt stattdessen die wenigen Lieferanten.

### Konsequenzen

- Gut, weil eine Suche an der Route gemessen 10 bis 110 ms braucht statt 1,35 s und mit dem Katalog kaum wächst. Langsam bleibt nur, was sehr viele Artikel trifft: ein Begriff in einem Achtel des Katalogs (87.500 Treffer) 0,4 bis 0,8 s, der Name eines Lieferanten mit allen 700.000 Artikeln 1,7 s.
- Gut, weil die Ausnahme genau eine Tabelle betrifft, die nichts Eigenes hält: Ginge sie verloren, ließe sie sich aus `articles` und `supplier_articles` neu füllen.
- Schlecht, weil die Trennung der Betriebe an dieser Stelle nicht von der Datenbank erzwungen wird, sondern von einer Funktion, die richtig fragen muss. Das hält ein Test mit zwei Betrieben fest.
- Schlecht, weil jede Änderung an Artikeln und Lieferantennummern eine Anweisung mehr kostet. Der Trigger schreibt eine Änderung an einem Artikel nur durch, wenn sich Nummer, Bezeichnung, EAN oder die Löschmarke geändert haben, weil der Abgleich und das Ende eines Imports jede ihrer Zeilen anfassen.
- Neutral: `pg_trgm` kommt als Erweiterung in die Datenbank. Sie ist eine „trusted extension“, die der Eigentümer selbst anlegen darf, auch beim Wiederherstellen einer Sicherung.

### Bestätigung

- Die Prüfung des Fundaments nennt `article_search` als einzige Tabelle ohne FORCE und ohne Recht für die Anwendung, und zwar genau in diesem Zustand: Row-Level Security an, eine Policy, nicht erzwungen, kein Recht. Wer der Anwendung ein Recht gibt oder die Policy entfernt, macht den Test rot.
- Ein Test mit zwei Betrieben und demselben Text: Jeder findet nur seine Artikel, ohne Betrieb findet die Funktion nichts, und die Anwendung kann die Tabelle nicht lesen.
- Die drei Funktionen stehen auf der Liste der Funktionen, die als Eigentümer laufen, jede mit ihrem Grund.
- Ein Test mit einem erzeugten Katalog prüft, dass die Suche den Index nimmt.

## Vor- und Nachteile der Optionen

### Option 1: Suchtabelle außerhalb von FORCE

- Gut, weil der Index wirkt und die Suche mit dem Katalog kaum langsamer wird.
- Gut, weil die Ausnahme auf eine abgeleitete Tabelle und eine Funktion begrenzt ist.
- Schlecht, weil die Trennung dort an einer Funktion hängt statt an der Policy.

### Option 2: Umbau ohne Ausnahme

- Gut, weil alles unter FORCE bleibt.
- Schlecht, weil eine Suche weiter jede Zeile liest: gemessen 250 bis 400 ms bei 700.000 Artikeln, mit einem zweiten Lieferanten doppelt so viel. Die Abnahme von #461 wäre knapp oder verfehlt.

### Option 3: Operatoren als leakproof markieren

- Gut, weil der Index auf `articles` selbst wirken würde.
- Schlecht, weil das ein Superuser auf jeder Instanz von Hand tun müsste und ein Wechsel der Hauptversion von PostgreSQL die Markierung stillschweigend verliert.
- Schlecht, weil die Markierung für jede Tabelle jeder Anwendung gilt, nicht nur für diese eine Suche.

## Weitere Informationen

Migration `0103_article_search`, Schema `packages/server/src/database/schema/article-search.ts`, Route `GET /articles`.
