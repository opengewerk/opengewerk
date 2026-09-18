# ADR 0007 – Dateispeicher, Dokumentenerzeugung und E-Rechnung

- Status: vorgeschlagen
- Datum: 2026-09-18
- Bezug: Feature-Gliederung v2.3, Abschnitte 1.5, 4.2, 4.7, 4.10

## Kontext

Das System speichert Fotos, Belegbilder, E-Rechnungs-XML, PDFs, Messdateien und CAD-/Office-Anhänge – GoBD-konform (unveränderbar, nachvollziehbar), mit Backup und ohne externe Cloud-Pflicht. Es erzeugt PDFs mit Briefpapier (Angebote, Rechnungen, Protokolle) und E-Rechnungen (XRechnung, ZUGFeRD) und muss eingehende E-Rechnungen validieren.

## Optionen Dateispeicher

### A – Lokales Dateisystem (Volume)

- Vorteile: Einfachst, Backup per Dateikopie, keine weiteren Dienste.
- Nachteile: Skaliert nicht über einen Server; Zugriff nur vom App-Prozess.

### B – S3-kompatibler Objektspeicher (MinIO, Garage, Hetzner Object Storage)

- Vorteile: Object-Lock/Versionierung als Unveränderbarkeits-Garantie; Skalierung; Backups ausgelagert.
- Nachteile: Zweiter Dienst für kleine Betriebe.

### C – Blobs in PostgreSQL

- Vorteile: Ein Backup für alles, Transaktionssicherheit.
- Nachteile: Datenbank wächst schnell (Fotos), Backups werden schwerfällig.

## Empfehlung Dateispeicher

**Abstraktion mit zwei Treibern:** lokales Dateisystem als Standard, S3-kompatibel als Option. Dateien werden **inhaltsadressiert** abgelegt (SHA-256 als Schlüssel): dieselbe Datei existiert genau einmal, Änderung ist unmöglich ohne neuen Hash, Prüfung der Unversehrtheit ist ein Hash-Vergleich. Metadaten (Name, Typ, Zuordnung zu Kunde/Objekt/Anlage/Beleg, Hochladender, Zeitpunkt) liegen in PostgreSQL. Festgeschriebene Belege referenzieren ihre PDF- und XML-Datei per Hash; diese Dateien sind nach Festschreibung unlöschbar (bis zur Aufbewahrungsfrist; Löschung als protokollierter Vorgang).

## Optionen Dokumentenerzeugung

### A – HTML/CSS → PDF über headless Chromium (Playwright)

- Vorteile: Layouts mit denselben Mitteln wie die Oberfläche; Briefpapier, Tabellen, Seitenumbrüche gut beherrschbar; eine Vorlage für Bildschirm und Druck.
- Nachteile: Chromium im Container (ca. 300 MB, RAM); Rendering nicht vollständig deterministisch.

### B – Programmatische PDF-Bibliothek (pdf-lib, PDFKit)

- Vorteile: Klein, deterministisch.
- Nachteile: Layout von Hand; Tabellen mit Umbruch mühsam; Vorlagenpflege durch Nicht-Entwickler unrealistisch.

### C – Typst

- Vorteile: Schnell, deterministisch, gute Typografie, Vorlagen als Text.
- Nachteile: Eigene Sprache für Vorlagen; Ökosystem jung; Daten-Übergabe über JSON.

## Empfehlung Dokumentenerzeugung

**Option A** für Phase 1 (Geschwindigkeit der Umsetzung, Vorlagen in HTML/Tailwind pflegbar), mit sauber gekapselter Schnittstelle `renderDocument(template, data) → PDF`, sodass Typst später als leichtgewichtiger Renderer eingesetzt werden kann, wenn Chromium im Betrieb stört.

## E-Rechnung

- **Ausgehend:** XRechnung (UBL oder CII) und ZUGFeRD 2.x (Profil EN 16931) aus demselben Datenmodell; PDF/A-3 mit eingebettetem XML für ZUGFeRD. Bibliothek: TS-Ökosystem (z. B. `@e-invoice-eu/core` oder Factur-X-Pakete) – **Eignung wird vor Phase 1 mit dem KoSIT-Validator und einem Praxistest bei einem Empfänger geprüft.** Fällt der Test durch, läuft die Erzeugung über Mustang (Java) als isolierten Container-Dienst.
- **Eingehend:** XML aus PDF (ZUGFeRD) extrahieren oder XRechnung-XML direkt annehmen; Schematron-Validierung (KoSIT); Original unverändert archivieren (Hash), strukturierte Daten für den Eingangsrechnungs-Workflow.
- **Archivierung:** PDF/A-3 für alle eigenen Belege; eingehende Dateien im Originalformat plus Hash.

## Konsequenzen

- Backup umfasst PostgreSQL-Dump **und** den Dateispeicher; das Backup-Skript prüft nach dem Restore Hashes stichprobenartig.
- Größenlimits und Bildkompression für Fotos (Ziel: unter 1 MB pro Foto, Original optional behalten).
- Virenscan für Uploads aus dem Kundenportal und dem E-Mail-Import (ClamAV optional, standardmäßig aktiv, wenn vorhanden).
