---
status: angenommen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.3, Abschnitte 1.5, 4.2, 4.7, 4.10
informed: Mitwirkende der Organisation opengewerk
---

# Dateispeicher, Dokumentenerzeugung und E-Rechnung

## Kontext und Problemstellung

Das System speichert Fotos, Belegbilder, E-Rechnungs-XML, PDFs, Messdateien und CAD-/Office-Anhänge, GoBD-konform (unveränderbar, nachvollziehbar), mit Backup und ohne externe Cloud-Pflicht. Es erzeugt PDFs mit Briefpapier (Angebote, Rechnungen, Protokolle) und E-Rechnungen (XRechnung, ZUGFeRD) und muss eingehende E-Rechnungen validieren.

## Betrachtete Optionen: Dateispeicher

### A: Lokales Dateisystem (Volume)

- Vorteile: Einfachst, Backup per Dateikopie, keine weiteren Dienste.
- Nachteile: Skaliert nicht über einen Server; Zugriff nur vom App-Prozess.

### B: S3-kompatibler Objektspeicher (MinIO, Garage, Hetzner Object Storage)

- Vorteile: Object-Lock/Versionierung als Unveränderbarkeits-Garantie; Skalierung; Backups ausgelagert.
- Nachteile: Zweiter Dienst für kleine Betriebe.

### C: Blobs in PostgreSQL

- Vorteile: Ein Backup für alles, Transaktionssicherheit.
- Nachteile: Datenbank wächst schnell (Fotos), Backups werden schwerfällig.

## Entscheidung Dateispeicher

Gewählt wurde eine **Abstraktion mit zwei Treibern**: lokales Dateisystem als Standard, S3-kompatibel als Option. Dateien werden **inhaltsadressiert** abgelegt (SHA-256 als Schlüssel): dieselbe Datei existiert genau einmal, Änderung ist unmöglich ohne neuen Hash, Prüfung der Unversehrtheit ist ein Hash-Vergleich. Metadaten (Name, Typ, Zuordnung zu Kunde/Objekt/Anlage/Beleg, Hochladender, Zeitpunkt) liegen in PostgreSQL. Festgeschriebene Belege referenzieren ihre PDF- und XML-Datei per Hash; diese Dateien sind nach Festschreibung unlöschbar (bis zur Aufbewahrungsfrist; Löschung als protokollierter Vorgang).

## Betrachtete Optionen: Dokumentenerzeugung

### A: HTML/CSS → PDF über headless Chromium (Playwright)

- Vorteile: Layouts mit denselben Mitteln wie die Oberfläche; Briefpapier, Tabellen, Seitenumbrüche gut beherrschbar; eine Vorlage für Bildschirm und Druck.
- Nachteile: Chromium im Container (ca. 300 MB, RAM); Rendering nicht vollständig deterministisch.

### B: Programmatische PDF-Bibliothek (pdf-lib, PDFKit)

- Vorteile: Klein, deterministisch.
- Nachteile: Layout von Hand; Tabellen mit Umbruch mühsam; Vorlagenpflege durch Nicht-Entwickler unrealistisch.

### C: Typst

- Vorteile: Schnell, deterministisch, gute Typografie, Vorlagen als Text.
- Nachteile: Eigene Sprache für Vorlagen; Ökosystem jung; Daten-Übergabe über JSON.

## Entscheidung Dokumentenerzeugung

Gewählt wurde **Option A, HTML und CSS über headless Chromium**, weil die Vorlagen damit mit denselben Mitteln gepflegt werden wie die Oberfläche und nicht in einer eigenen Sprache.

**Chromium läuft dabei nicht im Anwendungsprozess, sondern in einem eigenen Container**, der nur beim Rendern hochfährt. Grund ist das Speicherziel aus ADR 0002: Der Anwendungsprozess soll mit 2 GB neben PostgreSQL auskommen, und Chromium im selben Prozess hätte dieses Ziel gekippt. Die Trennung kostet einen Dienst mehr in der Compose-Datei und bringt dafür zwei Dinge: Das Speicherziel bleibt haltbar, und wer kein PDF braucht, lässt den Dienst weg.

Die Schnittstelle bleibt gekapselt als `renderDocument(template, data) → PDF`, damit Typst später als leichtgewichtiger Renderer eintreten kann, ohne dass die Vorlagen-Aufrufe im Code angefasst werden. Typst jetzt schon zu nehmen wurde verworfen: eigene Vorlagensprache, die außer dem Maintainer niemand pflegen könnte.

## E-Rechnung

- **Ausgehend:** XRechnung (UBL oder CII) und ZUGFeRD 2.x (Profil EN 16931) aus demselben Datenmodell; PDF/A-3 mit eingebettetem XML für ZUGFeRD. Bibliothek: TS-Ökosystem (z. B. `@e-invoice-eu/core` oder Factur-X-Pakete). **Eignung wird vor Phase 1 mit dem KoSIT-Validator und einem Praxistest bei einem Empfänger geprüft.** Fällt der Test durch, läuft die Erzeugung über Mustang (Java) als isolierten Container-Dienst.
- **Eingehend:** XML aus PDF (ZUGFeRD) extrahieren oder XRechnung-XML direkt annehmen; Schematron-Validierung (KoSIT); Original unverändert archivieren (Hash), strukturierte Daten für den Eingangsrechnungs-Workflow.
- **Archivierung:** PDF/A-3 für alle eigenen Belege; eingehende Dateien im Originalformat plus Hash.

## Konsequenzen

- Backup umfasst PostgreSQL-Dump **und** den Dateispeicher; das Backup-Skript prüft nach dem Restore Hashes stichprobenartig.
- Die Docker-Compose-Datei enthält den Render-Dienst als eigenen, abschaltbaren Container. Fehlt er, meldet die Anwendung beim PDF-Versuch einen verständlichen Fehler statt eines Absturzes.
- Größenlimits und Bildkompression für Fotos (Ziel: unter 1 MB pro Foto, Original optional behalten).
- Virenscan für Uploads aus dem Kundenportal und dem E-Mail-Import (ClamAV optional, standardmäßig aktiv, wenn vorhanden).
- **Nachtrag vom 21.09.2026, der Inhalt wird beim Festschreiben eingefroren, das PDF entsteht beim ersten Abruf.** Die Entscheidung oben sagt, dass festgeschriebene Belege ihre PDF-Datei per Hash referenzieren, und lässt offen, wann diese Datei entsteht. Beim Festschreiben selbst geht es nicht, ohne dem Renderer die wichtigste Transaktion der Anwendung auszuliefern: fehlt er, dürfte keine Rechnung mehr festgeschrieben werden, und er ist ausdrücklich abschaltbar. Deshalb zwei Schritte. In der Transaktion, die die Nummer vergibt, entsteht `document_snapshots` mit allem, was gedruckt wird, einschließlich der Anschrift des Kunden und des Briefkopfs von diesem Tag. Beim ersten Abruf wird daraus das PDF gesetzt, in den Speicher gelegt und über `document_files` verknüpft, danach kommen nur noch diese Bytes. Beide Tabellen sind für die Anwendung einfügen und lesen, und ein Trigger lehnt Ändern und Löschen für jede Rolle ab. Dieselbe eingefrorene Fassung ist die Quelle, aus der die E-Rechnung ihre Angaben nehmen kann: zwei Verpackungen derselben Angaben brauchen dieselben Angaben.
- **Nachtrag vom 21.09.2026, der Dateispeicher.** Umgesetzt ist der Treiber für das lokale Dateisystem, der S3-Treiber bleibt eine Option für später. Eine Datei liegt unter ihrem SHA-256 in zwei Verzeichnisebenen aus den ersten vier Zeichen, damit kein Verzeichnis nach ein paar Jahren Fotos hunderttausend Einträge hat. Geschrieben wird unter einem vorläufigen Namen, auf die Platte gebracht und dann umbenannt, damit ein Name nie auf eine halbe Datei zeigt; gelesen wird nur nach einem Vergleich mit dem Namen. Die Metadaten liegen in `files` unter derselben Mandantentrennung wie alles andere, und das ist die eigentliche Zugriffsprüfung: der Speicher gehört allen Betrieben einer Instanz gemeinsam und weiß von keinem. Die Bytes gehen vor der Zeile in den Speicher, nie umgekehrt; bricht dazwischen etwas ab, bleibt eine Datei, auf die nichts zeigt, und keine Zeile, die auf nichts zeigt. Die Rückspielprüfung in `restore.sh` erkennt die Dateien an ihrem Namen und prüft jede davon.
- **Nachtrag vom 21.09.2026, die Vorlage.** `renderDocument(template, data)` aus der Entscheidung oben ist in zwei Teile zerfallen: `printJob(content)` macht aus dem eingefrorenen Inhalt HTML, `Renderer` macht daraus ein PDF. Die Vorlage ist eine für alle Belegarten, nach DIN 5008 Form B, als Zeichenketten mit Maskierung und ohne Komponentenbibliothek, weil der Server kein React hat. Die Schrift wird als Daten mitgeschickt, weil das Renderer-Abbild als `latest` gezogen wird und eine Schrift, die mit ihm wechselt, jedes künftige PDF anders umbrechen ließe. Die Fußzeile mit Seitenzahl setzt Chromium als eigenes Dokument. **PDF/A-3 erzeugt Chromium nicht.** Für ZUGFeRD ist es Pflicht und wird mit der E-Rechnung gebaut. Für die übrigen Belege verlangen die GoBD kein bestimmtes Format, sondern Unveränderbarkeit und Lesbarkeit über die Aufbewahrungsfrist, und die Unveränderbarkeit trägt hier der Hash.
