---
status: angenommen
date: 2026-10-15
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.40 (Abschnitt 4.12), Entscheidungen vom 15.10.2026 an opengewerk-haustechnik#325, ADR 0010
informed: Mitwirkende der Organisation opengewerk
---

# Lager, Artikel und Lieferanten im Fundament

## Kontext und Problemstellung

OpenGewerk Haustechnik braucht in Phase 2 ein Lager: Artikel und Lieferanten, mehrere ortsfeste Lager je Betreiber, einen Bestand je Artikel und Lager, einen Mindestbestand und die Entnahme am Auftrag (opengewerk-haustechnik#325, #326). Das Planungskonzept sagt "Artikel und Lieferanten wie in OpenGewerk". In OpenGewerk liegen Artikel und Lieferanten im Server der Handwerkersoftware (`packages/server/src/database/schema/articles.ts`, `suppliers.ts`), mit Preisen in Gültigkeitszeiträumen und dem Import aus DATANORM; ein Lager und einen Bestand gibt es dort nicht.

Daraus folgt die Frage: Woher bezieht die Haustechnik Artikel, Lieferanten und Lager, ohne dass zwei Fassungen desselben Modells entstehen?

## Entscheidungstreiber

- Es gibt ein Modell für Artikel, Lieferanten und Bestand in der Organisation, nicht zwei, die auseinanderlaufen (ADR 0010).
- Das Fundament kennt keine Anwendung: keinen Preis und wie er gerechnet wird, keinen Katalog eines Großhändlers, nichts, woran eine Entnahme hängt.
- Der Bestand wird nie überschrieben. Er steigt mit dem Wareneingang, sinkt mit der Entnahme und wird mit einer Zählung berichtigt, alles als Buchung (Abschnitt 4.12 des Konzepts der Haustechnik).
- Eine Entnahme geschieht auch ohne Netz (#326); die Tabellen müssen reisen können.
- Die Handwerkersoftware soll das Modell später übernehmen können (opengewerk#298), ohne dass das Fundament dafür umgebaut wird.

## Betrachtete Optionen

1. Die Haustechnik führt ein eigenes, kleineres Modell.
2. Die Tabellen der Handwerkersoftware ziehen unverändert ins Fundament.
3. Das Fundament bringt Regeln und eine Tabellenfabrik; jede Anwendung legt die Tabellen mit eigenen Spalten an.

## Entscheidung

Gewählt: **Option 3**, entschieden von Moritz am 15.10.2026 ("alles ins Fundament, wie bei der Elektro-Struktur").

- **In `platform-domain`** (`model/stock.ts`): Artikel, Lieferant, Lager, was ein Lager von einem Artikel hält (den Mindestbestand) und die Buchung, mit ihren Grenzen und Regeln (`stockArticleProblems`, `stockSupplierProblems`, `storeProblems`, `storeArticleProblems`, `stockMovementProblems`), den Einheiten (`stockUnits`, mit den Schlüsseln, die die Positionen der Handwerkersoftware nutzen), der Prüfung einer EAN (`eanProblem`, zieht aus der Handwerkersoftware hierher) und dem Bestand aus seinen Buchungen (`stockLevel`, `belowMinimum`).
- **Mengen in Tausendsteln** der Einheit (`quantityMilli`), damit 85,5 m Leitung 85500 sind und keine Summe rundet.
- **Der Bestand ist die Summe seiner Buchungen**, in der Reihenfolge, in der der Server sie annahm: ein Eingang addiert, eine Entnahme zieht ab, eine Zählung setzt den Bestand auf das Gezählte und nennt ihren Grund. Mehr entnommen als da war, macht den Bestand negativ, und er sagt es.
- **In `platform-server`** (`database/schema/stock.ts`): die Fabrik `stockSchema({ articles, movements })` mit fünf Tabellen, `articles`, `suppliers`, `stores`, `store_articles` und `stock_movements`. Eine Anwendung gibt eigene Spalten an Artikel und Buchung hinein, etwa einen Preis oder woran eine Entnahme hängt, wie bei den Ansprechpartnern. Die Prüfungen der Datenbank halten die Grenzen von `domain`. Alle fünf tragen die Spalten des Abgleichs; Artikel, Lieferant und Lager werden markiert und nie entfernt.
- **Eine Buchung wird einmal geschrieben.** Das hält die Migration der Anwendung mit einem Trigger, wie bei einer Unterschrift; die Anwendungsrolle darf Buchungen lesen und anlegen.
- **Routen, Rechte, Vokabular des Änderungsprotokolls und Oberfläche bleiben vorerst bei der Anwendung.** Die Handwerkersoftware hat eigene Bildschirme für Artikel mit Preisen und DATANORM; gemeinsame Routen entstehen, wenn sie das Modell mit opengewerk#298 bindet. Bis dahin nennt das Fundament die Tabellen des Lagers nicht unter seinen Tabellen des Protokolls, weil die Handwerkersoftware Tabellen gleichen Namens führt.
- **Nachtrag vom 16.10.2026, die Umbuchung (für opengewerk-haustechnik#391).** Ein Artikel, der im falschen Lager angelegt wurde, zieht mit seinem Bestand in ein anderes Lager. Weil Buchungen nicht geändert werden, geschieht das als zwei Buchungen der Arten `transfer_out` (zieht im Lager ab, das er verlässt) und `transfer_in` (addiert im Lager, das er erreicht), jede mit dem anderen Lager in `counterpart_store_id`. Eine Zählung wäre der falsche Weg gewesen: sie sagt, dass gezählt wurde, und eine Auswertung des Lagers läse sie so. Die Datenbank hält, dass genau eine Umbuchung das andere Lager nennt (`stock_movements_transfer_names_its_store`) und dass es ein anderes ist (`stock_movements_transfer_elsewhere`); dass beide Buchungen zusammen geschrieben werden, hält die Anwendung, in einer Transaktion. Eine Anwendung, die den Baustein schon gebunden hat, bringt dafür eine Migration mit: die Spalte, ihren Schlüssel und die geänderte Prüfung `stock_movements_kind_known`.

### Konsequenzen

- Gut: ein Modell für beide Anwendungen; die Haustechnik baut auf Regeln, die die Handwerkersoftware schon gegen echte Artikel geprüft hat (EAN, Nummer je Betrieb unabhängig von der Schreibweise).
- Gut: Preise, Katalogimport und was eine Entnahme meint bleiben bei der Anwendung, die sie kennt.
- Schlecht: bis opengewerk#298 führt die Handwerkersoftware ihre eigenen Tabellen `articles` und `suppliers` neben dem Baustein. #298 legt fest, wie ihre Spalten (Warengruppe, Import, Preise in Gültigkeitszeiträumen) zu eigenen Spalten der Fabrik werden und wie ihre Einheit als Aufzählung zur Liste der Fabrik passt.
- Schlecht: Routen und Oberfläche entstehen zuerst in der Haustechnik; zieht die Handwerkersoftware nach, wandern sie dorthin, wo beide sie binden.

## Bestätigung

- `packages/platform/domain/src/model/stock.test.ts` hält Regeln und Bestand, `packages/platform/server/src/database/schema/stock.test.ts` die Fabrik.
- Die Haustechnik bindet den Baustein mit opengewerk-haustechnik#325 und prüft die Tabellen in ihrer Datenbank.

## Vor- und Nachteile der Optionen

### Option 1: ein eigenes Modell der Haustechnik

- Gut: schnell, keine Rücksicht auf die Handwerkersoftware.
- Schlecht: zwei Fassungen von Artikel und Lieferant, die auseinanderlaufen; genau das schließt ADR 0010 aus.

### Option 2: die Tabellen der Handwerkersoftware unverändert ins Fundament

- Gut: eine Fassung sofort.
- Schlecht: das Fundament bekäme Preise in Gültigkeitszeiträumen, den Import aus DATANORM und Warengruppen, also Wissen der Handwerkersoftware; ein Lager und ein Bestand fehlten trotzdem.

### Option 3: Regeln und Tabellenfabrik im Fundament

- Gut: ein Modell, das keine Anwendung kennt; jede gibt hinein, was nur sie weiß.
- Schlecht: die Handwerkersoftware muss ihre Tabellen bei #298 umziehen.

## Weitere Informationen

- opengewerk-haustechnik#325 (Lager), #326 (Material am Auftrag), opengewerk#298 (die Handwerkersoftware bindet das Lager).
- Das Muster der Fabrik stammt von den Ansprechpartnern (Nachträge in ADR 0010, opengewerk-haustechnik#85).
