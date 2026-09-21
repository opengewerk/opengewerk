# Schemas der E-Rechnung

Die vier Dateien unter `cii-d16b/` sind das XML-Schema der UN/CEFACT Cross Industry Invoice in der Fassung D16B, auf der XRechnung und ZUGFeRD beide aufbauen. OpenGewerk hält jede E-Rechnung gegen dieses Schema, bevor sie gespeichert und ausgeliefert wird (`src/documents/cii-schema.ts`). Gelesen wird nur aus diesem Ordner, nichts kommt zur Laufzeit aus dem Netz: eine selbst betriebene Installation muss eine Rechnung auch dann schreiben können, wenn die Leitung weg ist.

## Herkunft

Die Dateien stammen aus der Validator-Konfiguration XRechnung der KoSIT, Release `v2026-08-31` (Ordner `resources/cii/16b/xsd/`), die sie unverändert von UN/CEFACT übernimmt. Die Zeilenenden sind auf LF umgestellt, wie bei jeder Textdatei in diesem Repository; sonst sind die Dateien unverändert.

## Rechte

Copyright UN/CEFACT. Der Hinweis im Kopf jeder Datei erlaubt Kopie und Weitergabe ohne Einschränkung, solange er erhalten bleibt, und untersagt Änderungen am Inhalt. Deshalb werden die Dateien hier nie bearbeitet, sondern nur als Ganzes ausgetauscht.

## Was hier nicht liegt

Die Geschäftsregeln von EN 16931 und XRechnung sind Schematron und brauchen einen XSLT-2-Prozessor, also Java. Sie laufen nicht in der Anwendung, sondern in der CI: der Job "E-Rechnung gegen den KoSIT-Validator" prüft die Musterrechnungen aus `src/documents/cii.test.ts` mit dem Validator der KoSIT, in einer festgenagelten Fassung. Was von den Angaben eines Betriebs abhängt, prüft die Anwendung vor dem Festschreiben selbst (`eInvoiceGaps` in `domain`).

## Austausch

Wer eine neuere Fassung einspielt, nimmt sie aus einer neuen Konfiguration der KoSIT, stellt die Zeilenenden auf LF um, hebt die Fassungen im CI-Job mit an und lässt danach die Tests unter `src/documents/` und den CI-Job laufen.
