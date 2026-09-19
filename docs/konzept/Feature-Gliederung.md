# OpenGewerk: Feature-Gliederung Handwerkersoftware (CRM & ERP) · v2.5

2026-09-17 · Überarbeitung nach Konzept-Review; v2.1 ergänzt die Kanzlei-Anbindung (siehe separates Konzept *OpenGewerk Kanzlei*); v2.2 trägt den Projektnamen ein; v2.3 (18.09.2026) ergänzt Regel-Engine, Stromkreismodell, Messgeräte-Realität, Finance-Absicherung und schneidet die Roadmap auf ein MVP; v2.4 (18.09.2026) trägt die Positionierung als Leitentscheidung 9 ein; v2.5 präzisiert Leitentscheidung 7 um die Reihenfolge Abfrage vor KI (Vergleich mit openHandwerk, plancraft, HERO, TAIFUN/STREIT, sevdesk/Lexware, Odoo/SAP FSM/Dynamics)

Vollständige Feature-Liste für ein eigenständiges Open-Source-System (self-hosted), orientiert an den Stärken der Vergleichssysteme und gezielt um deren Schwächen ergänzt.

**Legende**
- ★ = geht über das hinaus, was Vergleichssysteme bieten (eigene Idee)
- ⚖ = rechtlich/regulatorisch erforderlich (Deutschland)
- ⏳ = im Plan, aber bewusst später umsetzen

---

## 0. Leitentscheidungen

1. **Elektro/PV ist das Kernmodul.** Alle anderen Gewerke (SHK, Dach, Maler, …) sind Plugins auf derselben Formular- und Fristen-Engine und werden nach dem Kern gebaut, idealerweise durch die Community.
2. **Ein Datenmodell für CRM und ERP.** Kunde → Objekt/Anlage → Auftrag/Projekt → Belege → Journal. Keine Duplikate, keine Schnittstellen zwischen "Modulen".
3. **Offline-first.** Die Baustellen-App (PWA) muss ohne Netz vollständig erfassen können (Keller, Zählerschrank, Dachboden). Sync mit Konflikt-Log.
4. **GoBD by design.** Belege werden festgeschrieben, nie gelöscht, sondern nur storniert. Lückenlose Nummernkreise, Audit-Log, Verfahrensdokumentation automatisch generiert.
5. **Vollständige Buchhaltung, gestaffelt:** Belege → Journal → EÜR/USt-VA → Anlagenbuchhaltung → Bilanz/GuV. ELSTER-Direktübermittlung bleibt ⏳ (nur Anzeige/Export).
6. **Mandantenfähig und betriebsfähig:** mehrere Firmen pro Instanz, Backup/Restore, Update-/Migrationspfad sind Teil des Produkts, nicht der Doku.
7. **Keine Cloud-KI-Pflicht, und Abfrage vor KI.** KI-Funktionen laufen optional über selbst gehostete Modelle (Ollama-Anbindung) ★. Zwei Regeln halten das zusammen: **Fragen über Zusammenhänge werden zuerst als Abfrage gebaut**, nicht als KI-Funktion. Was zum Monatsabschluss noch fehlt, an welcher Anlage eine Prüfung ansteht, welche Eingangsrechnung zu welcher Bestellung gehört: das beantworten Datenmodell, Regel-Engine und Fristen-Engine deterministisch, nachvollziehbar und ohne Netz. KI bleibt für den Rest, etwa eine Konfidenz zu den Zuordnungen, die unsicher sind. Und **KI schreibt nie direkt**, sondern erzeugt Vorschläge, die ein Mensch freigibt; die Trennung von Vorschlag und Festschreibung ist ohnehin vorhanden (4.8, Kanzlei-Connector), eine zweite Tür daneben gibt es nicht.
8. **Projektname und Repositories.** Das Projekt heißt **OpenGewerk** (GitHub-Organisation `opengewerk`, Domain opengewerk.de). Drei Repositories: (a) `opengewerk` für diese Handwerkersoftware, (b) `opengewerk-kanzlei` für den Kanzlei-Hub „OpenGewerk Kanzlei“ für Steuerberater (eigenes Konzept), (c) `opengewerk-api-spec` für ein kleines, gemeinsam genutztes Paket mit OpenAPI-Definition, JSON-Schemas und Konformitätstests. Hub und Handwerkersoftware deklarieren jeweils die unterstützte Spec-Version und können unabhängig releasen, ohne sich gegenseitig zu brechen ★.
9. **Keine künstlich beschränkten Funktionen.** OpenGewerk ist nicht „die kostenlose Alternative“, sondern die Software, in der niemand eine Funktion zurückhält, um einen höheren Tarif zu verkaufen. Es gibt keine Tarifstufen, keine Nutzerlimits, keine Schnittstelle, die erst ab einem Paket freigeschaltet wird, und keine Funktion, die nur in einer kommerziellen Fassung existiert. Der vollständige Funktionsumfang ist der, der im Repository liegt. Daraus folgen drei Festlegungen ★:
   - **Einnahmen entstehen neben der Software, nicht in ihr:** Hosting für Betriebe, die nicht selbst hosten wollen, Installation und Migration, Support und Wartungsverträge, Backups und Managed Updates, Schulungen, Messgeräte- und Fremdsystem-Anbindungen als Auftragsarbeit, Dienstleistungen rund um den Kanzlei-Hub. Jede dieser Leistungen ist ein Angebot, keine Voraussetzung: Ein Betrieb muss OpenGewerk ohne fremde Hilfe betreiben können, sonst ist die Beschränkung nur an eine andere Stelle gewandert.
   - **Keine proprietären Erweiterungen, auch nicht durch das Projekt selbst.** Ein bezahltes Gewerke-Paket oder ein bezahlter Importadapter wäre dasselbe Feature-Gate, nur an der Modulgrenze statt am Preisschild. Das deckt sich mit ADR 0008: Gewerke sind Datenpakete plus Compile-Time-Module, für Fremdcode mit eigener Lizenz ist darin kein Platz.
   - **Kein Contributor License Agreement.** Beiträge kommen unter der Lizenz des Repositories herein, mehr wird nicht verlangt. Ein CLA wäre nur nötig, um später doppelt zu lizenzieren, also um genau die geschlossene Fassung zu ermöglichen, die es nicht geben soll. Diese Festlegung ist praktisch nur jetzt umkehrbar, solange das Projekt einen einzigen Autor hat; sie wird bewusst so getroffen.

---

## 1. Architektur-Grundbausteine

Diese Bausteine werden zuerst gebaut, weil fast jedes Modul darauf aufsetzt.

### 1.1 Datenmodell-Kern

- **Kunde** (Privat/Gewerbe/Hausverwaltung/Generalunternehmer) mit mehreren Ansprechpartnern (Bauleiter, Buchhaltung, Mieter)
- **Objekt** (Gebäude, Liegenschaft, Standort), ein Kunde kann viele Objekte haben (Hausverwaltung mit 40 Liegenschaften)
- **Anlage** (PV-Anlage, Zählerschrank, Wallbox, Heizung, Wechselrichter), gehört zu einem Objekt, trägt Prüfhistorie, Gewährleistung, Wartungsvertrag
- **Auftrag** in zwei Ausprägungen: **Projekt** (Baustelle, Teilprojekte/Gewerke) und **Serviceauftrag** (Kundendienst, Störung, Notdienst, Wartungseinsatz)
- **Beleg** (siehe Dokumentenkette 4.2), jeder Beleg referenziert Auftrag, Kunde, Objekt/Anlage
- **Buchung**: jede Zahlung/Rechnung erzeugt Journal-Einträge (siehe Finance)

### 1.2 Fristen-Engine ★

Eine generische Deadline-Entität (Typ, Quelle, Fälligkeit, Vorlauf, Verantwortlicher, Aktion bei Fälligkeit). Alle Module speisen dieselbe Engine:

- Wartungsverträge (Intervall → automatischer Serviceauftrag)
- Prüffristen (E-Check, VDE 0105, DGUV V3, TÜV, TRGI, Legionellen)
- Gewährleistungsfristen (Trigger: Abnahmedatum)
- Zertifikate/Qualifikationen von Mitarbeitern
- Zahlungsziele, Skontofristen, Mahnstufen
- Kündigungsfristen (Wartungsverträge, Lieferantenverträge)
- Aufbewahrungs-/Löschfristen (DSGVO, GoBD)
- Angebots-Wiedervorlagen

Aktionen: Erinnerung (Push/E-Mail), Aufgabe anlegen, Serviceauftrag anlegen, Statuswechsel.

### 1.3 Formular-/Protokoll-Engine ★

- Prüfprotokolle, Abnahmeprotokolle, Regieberichte, Checklisten sind **datengetriebene Formulare** (JSON-Schema-Definition), nicht hartkodiert
- Felder: Text, Zahl mit Einheit, Messwert mit Grenzwert-Prüfung, Foto, Unterschrift, Auswahl, Wiederholgruppe (z. B. Stromkreise)
- Versionierung der Formulardefinitionen (altes Protokoll bleibt mit alter Definition lesbar)
- PDF-Rendering mit Vorlage, Signatur eingebettet
- Community kann Gewerke-Formulare per Pull Request beisteuern

### 1.4 Dokumentenkette

Eine Positionsliste läuft durch alle Belege: **Angebot → Auftragsbestätigung → Lieferschein / Regiebericht → (Abschlags-/Teil-)Rechnung → Schlussrechnung → Storno/Gutschrift**. Jeder Beleg kennt seinen Vorgänger; Mengenabgleich (angeboten, geliefert, abgerechnet) ist jederzeit sichtbar.

### 1.5 Nummernkreise & Festschreibung ⚖

- Lückenlose, mandantenbezogene Nummernkreise je Belegtyp (konfigurierbares Muster)
- Festschreibung mit Zeitstempel beim Versand/Buchung; danach nur Storno oder Korrekturbeleg
- Audit-Log auf Feldebene

### 1.6 Offline-Sync ★

- Lokale Datenbank im Client (IndexedDB), Schreibqueue, Service Worker
- Sichtbares Sync-Status-Panel: unsynchronisierte Einträge, Konflikte, Entscheidung durch Nutzer
- Fotos werden komprimiert lokal gehalten und nachgeladen

---

### 1.7 Regel-Engine für Rechtsvorschriften ★ ⚖

Gesetzliche Parameter stehen **nicht im Code**, sondern in versionierten Regeldatensätzen mit Gültigkeitszeitraum (gültig ab / bis), Quelle (Paragraf, Fundstelle) und Mandantenbezug, wo nötig:

- Umsatzsteuer: Steuersätze, Kleinunternehmergrenze §19, Kleinbetragsgrenze §33 UStDV, Ausstellungspflicht E-Rechnung (Umsatzschwelle, Stichtag), §13b-Regeln
- Bau: Bauabzugsteuer-Satz, Sicherheitseinbehalt-Standards, Gewährleistungsfristen BGB/VOB
- Arbeit: ArbZG-Höchstarbeitszeit, Pausenregeln, MiLoG-Aufbewahrung
- Aufbewahrung: GoBD-Fristen je Belegart, DSGVO-Löschfristen
- Mahnwesen: Verzugszinssätze (Basiszins), Mahnpauschale

Ein Gesetzesupdate ist ein neuer Regeldatensatz mit Gültigkeitsbeginn, kein Release. Regeln werden historisch angewendet: Ein Beleg von 2027 wird auch 2030 nach den Regeln von 2027 beurteilt. Regelpakete sind Teil des Repos (versioniert, community-pflegbar) und werden mit Updates ausgeliefert; ein Mandant kann Regeln nicht überschreiben, nur mandantenbezogene Parameter setzen (z. B. „ist Kleinunternehmer“).

---

## 2. Querschnittsfunktionen (systemweit)

- Benutzer- und Rechteverwaltung: rollenbasiert (Buchhaltung, Techniker, Bauleiter, Büro, Admin, **Steuerberater read-only** ★, Kunde im Portal)
- Mandantenfähigkeit: mehrere Firmen auf einer Instanz, getrennte Nummernkreise, Kontenrahmen, Briefpapier
- Audit-Log/Änderungsprotokoll über alle Module
- **Aufgabenverwaltung** (aus CRM hierher verschoben): To-Dos mit Fälligkeit, Verantwortlichem, Status; optional an Kunde/Objekt/Auftrag gebunden; automatisch erzeugt durch Fristen-Engine
- Benachrichtigungssystem: E-Mail/Push (Web-Push), gespeist ausschließlich durch die Fristen-Engine und Statuswechsel (keine modulspezifischen Erinnerungs-Implementierungen)
- Dubletten-Prüfung (Kunden, Objekte, Artikel) beim Anlegen und Importieren
- Datenimport/-export (CSV/Excel); Importassistenten für Migration aus plancraft/HERO/sevdesk-Exporten
- Globale Volltextsuche (Kunden, Objekte, Anlagen, Belege, Dokumente, Protokolle)
- Offene REST-API + Webhooks; OpenAPI-Spezifikation
- Textbausteine/Vorlagen (Positionen, Mails, Belegtexte, Rechtstexte)
- DSGVO-Funktionen ⚖: Löschkonzept mit Aufbewahrungsfristen, Auskunft/Datenexport, Verarbeitungsverzeichnis (Art. 30) als generiertes Dokument, AV-Vertragsvorlage für Hoster/Zahlungsdienstleister
- Betrieb: Backup/Restore (inkl. Dokumentenspeicher), Update-Mechanismus mit DB-Migrationen, Health-Check, Docker-Compose-Referenzinstallation

---

## 3. CRM

### 3.1 Stammdaten & Kontakte

- Kunden (Privat/Gewerbe/Hausverwaltung/GU) mit vollständigen Adress- und Kontaktdaten
- Steuerliche Attribute ⚖: USt-ID, Kunde ist Unternehmer (→ E-Rechnungspflicht), Bauleistungsempfänger (→ §13b), Freistellungsbescheinigung §48 EStG mit Ablaufdatum (→ Fristen-Engine)
- Mehrere Ansprechpartner pro Kunde; Ansprechpartner pro Objekt (Mieter, Hausmeister)
- Kommunikationshistorie (Anrufe, Mails, Notizen) zentral am Kunden **und** am Objekt
- Lead-Erfassung und Qualifizierung vor Kundenanlage
- Segmentierung/Tags (Gewerk, Region, Kundentyp, Bestandskunde/Neukunde)
- Kundenpreise, Rabattgruppen, Zahlungsbedingungen je Kunde

### 3.2 Objekt- & Anlagenakte

- Objekte mit Adresse, Zugang (Schlüssel, Codes, verschlüsselt gespeichert), Ansprechpartnern, Fotos
- Anlagen mit Typ, Hersteller, Seriennummer, Inbetriebnahme, Gewährleistungsende, zugeordneten Prüfprotokollen, Wartungsverträgen, Serviceaufträgen
- **Anlagenstruktur (Elektro) ★**: Anlage → Verteiler (NSHV, UV) → Feld → Stromkreis → Betriebsmittel. Je Stromkreis: Bezeichnung, Sicherung (Typ, Nennstrom, Charakteristik), RCD (Typ, IΔn), Leitung (Typ, Querschnitt, Länge, Verlegeart), Verbraucher; je Betriebsmittel: Typ, Hersteller, Seriennummer. Diese Struktur ist zugleich das Gerüst der Prüfprotokolle nach VDE 0100-600 / 0105-100 (Messwerte werden je Stromkreis erfasst) und das Stromkreisverzeichnis für den Verteilerausdruck. Für PV analog: Anlage → Wechselrichter → String → Module, plus Speicher, Zähler, Wallbox.
- **QR-Etikett je Anlage ★**: Aufkleber im Zählerschrank/am Wechselrichter → Scan öffnet Anlagenakte (Techniker) oder eine loginfreie Kundenseite mit nächster Prüfung und Störungsmeldung mit Foto (Kunde)
- Komplette Historie pro Anlage, auch für den nächsten Handwerker nachvollziehbar

### 3.3 Vertriebspipeline

- Pipeline-Status: Lead → Angebot → Auftrag → Abgeschlossen
- Wiedervorlagen für offene Angebote (Fristen-Engine)
- Konvertierungs-Tracking (Angebotsquote, Umsatz je Quelle)
- Verknüpfung Angebot ↔ Kunde ↔ Objekt ↔ Projekt in einem Datensatz

### 3.4 Kommunikation

- E-Mail-Verknüpfung (IMAP/SMTP): gesendete/empfangene Mails am Kundendatensatz
- Telefonprotokolle und Terminverlauf
- Automatische Bestätigungsmails (Termin, Auftragseingang, Rechnungsversand)

### 3.5 Wartungsverträge

- Vertrag als eigenes Objekt: Kunde, Anlage(n), Laufzeit, Intervall, Kündigungsfrist, Preis/Pauschale, enthaltene Leistungen, Zahlungsrhythmus
- Automatische Auslösung: Fälligkeit → Serviceauftrag + Termin-Vorschlag + Rechnung nach Ausführung
- Dauerrechnung/Abo-Abrechnung (monatlich/jährlich)
- Kündigungsfristen und Verlängerung über die Fristen-Engine

### 3.6 Kundenportal (Selbstbedienung)

- Angebote online einsehen und digital annehmen (E-Signatur)
- Rechnungen einsehen, Zahlungsstatus verfolgen (Status kommt aus dem Bankabgleich)
- Rechnungen online bezahlen (Zahlungsdienstleister, siehe 6.)
- Termine bestätigen; Verschiebung **anfragen** (erzeugt Aufgabe im Büro, greift nicht direkt in die Plantafel)
- Abnahmeprotokolle digital unterschreiben
- Störung melden (mit Foto) → erzeugt Serviceauftrag
- Eigene Anlagen mit nächsten Prüf-/Wartungsterminen sehen
- Dokumente (Prüfprotokolle, Inbetriebnahmeprotokoll, Rechnungen) herunterladen

### 3.7 Marketing & Bindung

- Serien-/Infomails an Kundengruppen (Double-Opt-in, Abmeldelink ⚖)
- Jubiläen/Geburtstage als Erinnerung
- Wartungs- und Prüferinnerungen an Kunden (aus der Fristen-Engine)

### 3.8 CRM-Auswertungen

- Kundenwert / Umsatz je Kunde und je Objekt über Zeit
- Lead-Quellen-Analyse, Angebots-Erfolgsquote
- Wartungsvertrags-Bestand und wiederkehrender Umsatz

---

## 4. ERP

### 4.1 Auftrags- & Projektmanagement

**Projekte**
- Auftragsmappe: Status, Historie, alle verknüpften Belege/Dokumente/Protokolle an einem Ort
- Aufteilung großer Baustellen in Teilprojekte/Gewerke
- **Bautagebuch**: tägliches Protokoll mit Wetter, anwesenden Mitarbeitern/Subunternehmern, Geräten, Ereignissen, Fotos, rechtssicher archiviert
- Aufmaß mobil erfassen (mit Foto), automatische Übernahme in Kalkulation und Rechnung
- Baubesprechungsprotokolle

**Serviceaufträge / Kundendienst**
- Schnellerfassung (Anruf → Auftrag in 30 Sekunden), Dispatch an Techniker, Auftragszettel in der App
- Störungs-/Notdienst mit Rufbereitschaftsplan und Notdienstzuschlägen
- Sofortabrechnung vor Ort (Regiebericht → Rechnung)

**Kalkulation**
- Zuschlagskalkulation: getrennte Aufschläge auf Material, Lohn, Fremdleistung, Geräte
- **Stundenverrechnungssatz-Rechner ★** nach ZDH-Kalkulationsschema (Betriebskosten, produktive Stunden, Gemeinkostenzuschlag); Änderungen heben Kalkulationsvorlagen automatisch an
- Vor- und Nachkalkulation, Soll-Ist-Vergleich pro Projekt (Stunden, Material, Fremdleistung)
- Staffel- und Kundenpreise, Preislisten mit Gültigkeit

**Nachträge**
- Nachtragsangebot aus Regiebericht: Positionen im unterschriebenen Regiebericht, die nicht im Auftrag sind, erzeugen automatisch einen Nachtrags-Entwurf ★
- Nachtragsverfolgung (angezeigt → beauftragt → abgerechnet)

**Subunternehmer**
- Stammdaten mit Nachweisen (Freistellungsbescheinigung §48 EStG, Unbedenklichkeitsbescheinigung, Versicherung), Ablauf über die Fristen-Engine ⚖
- Beauftragung (Sub-Auftrag mit Leistungsverzeichnis), Leistungsnachweis, Eingangsrechnung mit Bauabzugsteuer-Prüfung
- Zugang für Subunternehmer zu Bautagebuch/Zeiterfassung ihres Auftrags

### 4.2 Belegwesen (Angebote & Rechnungen)

**Belegtypen**
- Kostenvoranschlag (§650 BGB) und Angebot, getrennte Dokumente mit unterschiedlicher Rechtsfolge ⚖
- Angebot mit Positionsgliederung, Titeln, Alternativ-/Eventual-/Bedarfspositionen, optionalen Positionen, Textbausteinen
- Auftragsbestätigung
- Lieferschein
- Regiebericht / Stundenlohnzettel mit Kundenunterschrift (mobil)
- Abschlagsrechnung **kumuliert** (Leistungsstand gesamt, abzüglich bisher gestellt und bisher gezahlt), Teilrechnung, Schlussrechnung
- Sicherheitseinbehalt (VOB/B §17, prozentual, Auszahlungsdatum über Fristen-Engine)
- Stornorechnung und Gutschrift (Rechnungskorrektur), nie Löschung ⚖
- Dauerrechnung (Wartungsverträge)

**Steuerliche Logik ⚖**
- E-Rechnung ausgehend: XRechnung/ZUGFeRD; automatische Formatwahl je Empfänger (B2B-Inland → E-Rechnung, Verbraucher → PDF); Umsatzgrenze 800.000 € (2027) und Vollpflicht ab 2028 als Mandanteneinstellung
- Kleinbetragsrechnung bis 250 €, Kleinunternehmerregelung §19 UStG (Mandanteneinstellung, Pflichthinweis)
- §13b UStG Reverse Charge für Bauleistungen an Bauunternehmer (Pflichthinweis, Nettoausweis, korrekte Verbuchung)
- Bauabzugsteuer §48 EStG auf Eingangsseite (Einbehalt, Anmeldung vorbereiten)
- Pflichtangaben-Prüfung nach §14 UStG vor Festschreibung
- Widerrufsbelehrung bei Verträgen außerhalb von Geschäftsräumen (§312g BGB) als Angebotsanhang, Verbraucherbauvertrag §650i BGB mit Baubeschreibung

**Zahlung**
- Automatisierte Zahlungsbedingungen, Skonto, Zahlungsziele (Fristen-Engine)
- GAEB-Import/Export (DA81-86, X83-X86) ohne Tarif-Beschränkung
- **Mahnwesen** (einmalig hier definiert, Finance nutzt es): Mahnstufen, Mahngebühren, Verzugszinsen; manuell oder automatisch je Kunde

### 4.3 Termin- & Ressourcenplanung

- Plantafel (Drag & Drop) für Mitarbeiter, Fahrzeuge, Geräte, Subunternehmer
- Serientermine (täglich/wöchentlich/monatlich/jährlich, mit Ausnahmen)
- Terminbestätigung per Push an die Mitarbeiter-App
- Urlaubs-/Krankheitsverwaltung (Datenquelle: HR, Anzeige hier) mit direkter Auswirkung auf die Planung
- Fahrtroutenvorschlag für Kundendienst-Touren
- Rufbereitschaftsplan (Notdienst)

### 4.4 Zeiterfassung

- Mobile Zeiterfassung mit Projekt-/Serviceauftrags-Zuordnung, Start/Stopp und Nachtrag
- Fahrzeiten, Pausen, Überstunden, Zuschläge (Nacht, Sonntag, Notdienst)
- Auslöse/Verpflegungsmehraufwand bei Auswärtstätigkeit
- ArbZG-Prüfung ⚖: Pausenregeln, Höchstarbeitszeit, Ruhezeiten mit Warnung
- MiLoG-Aufzeichnung ⚖: Beginn, Ende, Dauer; 2 Jahre unveränderbar aufbewahrt
- Optional SOKA-BAU-Meldung (Bauhauptgewerbe) ⏳
- Export für Lohnabrechnung (DATEV Lodas/Lohn & Gehalt, CSV)
- Standortdaten nur bei Start/Stopp und nur mit Mitarbeiter-Einwilligung ⚖

### 4.5 Material & Lager

- Artikelstammdaten (Lieferantenartikel, EAN, Einheiten, Preise mit Gültigkeit), Lagerbestand, Mindestbestand mit Nachbestell-Hinweis
- Wareneingang/-ausgang je Projekt; Materialentnahme per Barcode/QR in der App
- Fahrzeuglager (Bestand je Servicefahrzeug)
- Lieferantenverwaltung, DATANORM-Import (V4/V5), IDS-Connect-Preisabfrage

### 4.6 Fuhrpark- & Werkzeugverwaltung

- Fahrzeug-, Maschinen- und Messgerätestammdaten, Standort/Zuordnung zu Mitarbeitern
- TÜV/HU, DGUV-Prüfungen, **Kalibrierfristen für Messgeräte** (Fristen-Engine)
- Kilometerstände/Betriebsstunden, Fahrtenbuch
- Wartungshistorie je Fahrzeug/Gerät

### 4.7 Einkauf & Eingangsrechnungen

- Bestellwesen, Lieferantenvergleich (IDS-Preise)
- Wareneingangsprüfung, Abgleich Bestellung ↔ Lieferschein ↔ Rechnung
- Eingangsrechnungs-Workflow: Erfassung (Scan/OCR, E-Mail-Postfach, **E-Rechnungs-Empfang mit XML-Validierung ⚖**), Zuordnung zu Projekt, Freigabe, Zahlungsvorschlag
- Bauabzugsteuer-Prüfung bei Subunternehmer-Rechnungen ⚖

### 4.8 Finance / Buchhaltung

Ausbau in dieser Reihenfolge: **Belege → Journal → EÜR/USt-VA → Bank → Anlagen → Bilanz/GuV**

- Kontenrahmen SKR03/SKR04, konfigurierbar, je Mandant
- Doppelte Buchführung als unveränderbares Journal, GoBD-konform (Festschreibung, Storno statt Löschen)
- Automatische Verbuchung aus Ausgangs-/Eingangsrechnungen und Zahlungen
- Offene-Posten-Verwaltung (nutzt Mahnwesen aus 4.2)
- Bankanbindung FinTS/EBICS, automatischer Zahlungsabgleich (Bank, PayPal, Stripe) mit Vorschlagslogik
- Kassenbuch (ohne TSE; Barzahlung mit Registrierkasse ist ausgeschlossen, siehe 12.)
- Anlagenbuchhaltung: Anlagenverzeichnis, AfA-Läufe, GWG
- EÜR, USt-Voranmeldung, BWA, Bilanz/GuV als Auswertungen über das Journal
- Jahresabschluss-Unterstützung (Abgrenzungen, Rückstellungen, Saldovortrag)
- Datenzugriff für Betriebsprüfung ⚖: Z1/Z2/Z3, GDPdU/IDEA-Export
- **Absicherung des Finance-Moduls** (größtes fachliches Risiko des Projekts): Journal technisch append-only (kein UPDATE/DELETE auf Buchungszeilen, Storno als Gegenbuchung); Buchungslogik als reine Funktionen mit Property-based Tests (Summenprobe, Soll = Haben, Steuerverprobung); Referenzfälle aus Lehrbuch-/IHK-Buchungssätzen als Testdaten; **Parallelbetrieb**: der Pilotbetrieb führt mindestens ein Geschäftsjahr parallel in der bisherigen Buchhaltung und vergleicht monatlich; die Auswertungen EÜR/USt-VA/Bilanz tragen bis zur Prüfung durch einen Steuerberater das Label „Vorschau, nicht abgabefertig“
- DATEV-Exportschnittstelle (Buchungsstapel, Belegbilder)
- **Steuerberater-Rolle ★**: Read-only-Mandantenzugang mit Belegbild, Journal, Kommentarfunktion, Fallback für Kanzleien ohne Kanzlei-Hub; die eigentliche Anbindung läuft über den Kanzlei-Connector (4.13)
- ELSTER ⏳: nur Anzeige/Export der USt-VA-Werte; Direktübermittlung bewusst nicht umgesetzt

### 4.9 Personal / HR

- Mitarbeiterakte inkl. Stundensätze (Kosten- und Verrechnungssatz)
- Qualifikationen/Zertifikate mit Ablauffristen (Elektrofachkraft, PV-Zertifizierung, Höhenarbeit, Führerschein) → Fristen-Engine
- Urlaubsverwaltung (Datenquelle; Plantafel zeigt an)
- Lohn-Vorbereitung / Export an externe Lohnbuchhaltung
- Zugang für Subunternehmer (eingeschränkt)

### 4.10 Dokumentenmanagement

- Zentrale, GoBD-konforme Belegablage, verknüpft mit Kunde/Objekt/Anlage/Projekt
- E-Signatur (einfache elektronische Signatur mit Zeitstempel und Geräteinfo) für Angebote, Abnahmen, Regieberichte, Protokolle
- Verfahrensdokumentation als Pflichtbestandteil, **automatisch generiert ★** aus Rollen, Einstellungen, Belegflüssen und Aufbewahrungsregeln
- Versionierung, Volltextindex (inkl. OCR auf PDFs)

### 4.11 Abnahme, Mängel & Gewährleistung

- Abnahmeprotokoll (§640 BGB) mit Vorbehalten, Unterschrift, Foto; **das Abnahmedatum ist Trigger der Gewährleistungsfrist** ⚖
- Gewährleistungsfrist automatisch: BGB 5 Jahre (Bauwerk) / 2 Jahre (sonst), VOB/B 4 Jahre (nur wenn VOB vollständig vereinbart, Kennzeichen am Auftrag); Erinnerung vor Fristablauf
- Mängel/Reklamationen mit Foto mobil erfassen; Statusverfolgung (gemeldet → in Bearbeitung → behoben → abgenommen)
- Mängelanzeige/Mängelrüge auch für eigene Lieferanten/Subunternehmer
- Mängelbericht als PDF-Export
- Bürgschafts-/Sicherheitseinbehaltsverwaltung (Ablauf über Fristen-Engine)

### 4.12 Reporting / BI

- Dashboard: Auslastung, offene Posten, Cashflow, Projektrentabilität, Wartungsvertragsbestand
- Report-Builder (Felder, Filter, Gruppierung, Export) ohne Tarif-Limits
- Lesender SQL-/API-Zugang für Metabase/Grafana

---

### 4.13 Kanzlei-Anbindung (Steuerberater-Connector) ★

Gegenstück zum separaten **Kanzlei-Hub**: Die Kanzlei arbeitet aus ihrem eigenen self-hosted System heraus mit allen Mandanten; die Daten bleiben in dieser Instanz. Der Connector setzt die `opengewerk-api-spec` um.

**Einstellungsseite "Steuerberater"**
- Einladungscode erzeugen (einmalig, 24 h gültig); Verbindung wird immer vom Mandanten aus initiiert, nie von der Kanzlei
- Scope-Auswahl beim Einladen (lesen: Journal, Belege, Stammdaten, Perioden; schreiben: Kommentare/Rückfragen, Buchungsvorschläge, Kontenrahmen-Profil, Abschlussbuchungen; Audit-Export), jeder Scope einzeln, jederzeit änderbar
- Übersicht verbundener Kanzleien mit Scopes, letztem Zugriff und **Trennen**-Button (sofortige Token-Sperre)
- Zugriffslog: jeder Kanzleizugriff (wer, wann, welcher Beleg/Report) wird hier protokolliert und ist für den Mandanten einsehbar ⚖

**API-Endpunkte (`opengewerk-api-spec`)**
- `/periods`, `/journal`, `/accounts`, `/balances`, `/open-items`, `/documents/{id}` (Belegbild + E-Rechnungs-XML), `/inquiries`, `/proposals`, `/coa-profile`, `/audit-export` (Z1-Z3), `/access-log`
- Token rotierbar, Ablauf bei Inaktivität; kryptografische Bindung an die Hub-Instanz (mTLS oder DPoP) nach der ersten Fassung, siehe ADR 0006 ⚖
- ETags/Paginierung für effizienten Sync, Idempotenz-Keys bei schreibenden Aufrufen; Beträge als Integer-Cent, Steuerschlüssel nach DATEV-Konvention

**Webhooks an die Kanzlei**
- Neuer Beleg, Beleg geändert, Rückfrage beantwortet, Vorschlag entschieden, Periode festgeschrieben, Bankumsatz ohne Beleg
- Signierte Payloads, Retry mit Backoff, Zustellprotokoll

**Rückfragen-Postfach**
- Rückfragen der Kanzlei erscheinen am Beleg und in einem eigenen Postfach (Web + Mitarbeiter-App)
- Antwort mit Text, Foto oder nachgereichtem Beleg direkt vom Smartphone; Fälligkeit aus der Fristen-Engine, Erinnerung bei Überfälligkeit
- Status: offen → beantwortet → durch Kanzlei erledigt

**Vorschlags-Freigabe**
- Buchungs- und Kontierungsvorschläge der Kanzlei werden als Vorschlagsliste angezeigt; Bestätigung mit einem Klick erzeugt die Buchung im Journal (mit Kennzeichen "Vorschlag Kanzlei, freigegeben von …")
- Kontenrahmen-Profile der Kanzlei (Automatikkonten, Steuerschlüssel) können mit Scope `write:coa` übernommen werden, Vorschau vor Übernahme
- Direktbuchung durch die Kanzlei nur mit explizitem Scope `write:closing`; erscheint im Audit-Log als Kanzleibuchung

**GoBD/Datenschutz**
- Festgeschriebene Belege bleiben unveränderbar; die Kanzlei arbeitet nur mit Vorschlag, Storno oder Korrekturbeleg ⚖
- Belegbilder verlassen die Instanz nur zur Anzeige, nicht zur Speicherung im Hub; AV-Vertrag nur nötig, wenn der Hub bei einem externen Hoster liegt

---

## 5. Gewerke-Module

### 5.1 Kernmodul: Elektro/PV

- Prüfprotokolle als Formulardefinitionen: E-Check, VDE 0100-600 (Erstprüfung), VDE 0105-100 (Wiederholungsprüfung), DGUV V3 (ortsveränderliche/ortsfeste Betriebsmittel), VDE-AR-N 4105 Inbetriebnahmeprotokoll
- **Messgeräte-Import ★**: Messwerte aus Installationstestern per Datei-Import direkt ins Protokoll; Grenzwertprüfung automatisch. **Realität:** Die Geräte selbst liefern selten brauchbare Rohdaten; importiert werden die Exporte der Hersteller-PC-Software (IZYTRONIQ/ETC bei Gossen Metrawatt, Metrel ES Manager, Fluke DMS, Benning PC-Win), die teils proprietär oder nur als CSV/XML/PDF vorliegen. Deshalb: ein Adapter je Hersteller-Software, beginnend mit dem Gerät des Pilotbetriebs; ein **Proof-of-Concept „Messdatei → Prüfprotokoll“ wird vor Phase 2 gebaut** (Roadmap 10), um Aufwand und Formatzugang realistisch zu bewerten. Fallback ist immer die manuelle Erfassung mit Grenzwertprüfung.
- Stromkreisverzeichnis je Anlage aus der Anlagenstruktur (3.2), wiederverwendbar bei der nächsten Prüfung; Ausdruck für die Verteilertür
- PV-Anlagendokumentation: Inbetriebnahmeprotokoll, Stringplan, Komponentenliste (Module, WR, Speicher, Zähler) mit Seriennummern, Ertragsprognose
- Marktstammdatenregister: **Vorbereitung der Betreiber-Meldung** (Datenexport/Ausfüllhilfe); Direktmeldung nur mit MaStR-Webdienst ⏳; meldepflichtig ist der Betreiber, nicht der Installateur
- Netzbetreiber-Anmeldung: Formular-Vorausfüllung (Anmeldung, Fertigmeldung, E-Installateur-Nachweis)
- **Anlagen-Monitoring als Servicetrigger ★**: Wechselrichter-APIs (SMA, Fronius, SolarEdge, Huawei) auslesen; Ertragsabfall oder Fehlercode erzeugt Serviceauftrag-Vorschlag
- Wallbox/Speicher: Inbetriebnahme, Förderunterlagen, Prüfintervalle
- Automatische Fristenüberwachung für Wartungsverträge und Wiederholungsprüfungen

### 5.2 Plugin-Gewerke (nach dem Kern, Community)

**SHK**
- Wartungsprotokolle für Heizungsanlagen inkl. Legionellenprüfung
- Störungsdienst-/Notdienst-Einsatzprotokolle
- Gasanlagen-Prüfungen (TRGI), Schornsteinfeger-Bescheinigungen

**Dachdecker**
- Dachflächen-Aufmaß (Fläche, Neigung, Material)
- Wetterabhängige Terminplanung (Wetter-API in der Plantafel)

**Maler**
- Farbton- und Materialverwaltung (RAL/NCS, Verbrauch je m²)
- Flächenaufmaß für Anstricharbeiten
- Vorher/Nachher-Fotodokumentation

Gewährleistungs- und Fristenthemen dieser Gewerke laufen über die zentrale Fristen-Engine, nicht als Einzel-Features.

---

## 6. Schnittstellen

- Formate: DATEV (Buchungsstapel, Belegbilder, Lohn), GAEB, DATANORM, IDS-Connect, XRechnung/ZUGFeRD (aus- und eingehend), UGL (Lieferschein-/Bestellaustausch mit Großhandel)
- Bank: FinTS/HBCI, EBICS; Zahlungsabgleich PayPal, Stripe
- Zahlungsdienstleister für Kunden (Portal): Stripe, PayPal, SEPA-Lastschrift; Wero ⏳ sobald Händlerzahlungen allgemein verfügbar sind
- Kalender: CalDAV-Sync; E-Mail: IMAP/SMTP
- Messgeräte: Import-Adapter je Hersteller (siehe 5.1)
- Wechselrichter-/Monitoring-APIs (siehe 5.1)
- Wetter-API (Bautagebuch, Plantafel)
- KI optional ★: Ollama-Anbindung für Belegerkennung, Textbaustein-Vorschläge, Sprachnotiz → Aufmaß; Cloud-KI nicht erforderlich. Auswertungen über Zusammenhänge entstehen zuerst als Abfrage, siehe Leitentscheidung 7
- REST-API + Webhooks für Drittanbieter. Das wird ein eigener Vertrag und nicht der gedehnte Kanzlei-Vertrag: `opengewerk-api-spec` ist auf genau einen Konsumenten zugeschnitten, bis in die Namen von Token und Scopes hinein
- **Kanzlei-Connector** nach `opengewerk-api-spec` (eigenes Repo, SemVer) mit signierten Webhooks, siehe 4.13 und Konzept *Kanzlei-Hub*

---

## 7. Rechtliche Anforderungen im Überblick ⚖

| Thema | Anforderung | Umsetzung im System |
| --- | --- | --- |
| E-Rechnung Empfang | Seit 1.1.2025 Pflicht (B2B Inland) | Eingangsrechnungs-Workflow mit XML-Validierung, Archivierung des Originals |
| E-Rechnung Ausstellung | Ab 2027 bei > 800.000 € Vorjahresumsatz, ab 2028 für alle | Automatische Formatwahl je Empfänger, Mandanteneinstellung |
| Ausnahmen | Verbraucher, Kleinbetrag ≤ 250 €, Kleinunternehmer §19 | Kundentyp + Mandanteneinstellung steuern Format |
| GoBD | Unveränderbarkeit, Nummernkreise, Verfahrensdoku, Datenzugriff | Festschreibung, Storno statt Löschen, Audit-Log, Z1-Z3-Export, generierte Verfahrensdoku |
| Aufbewahrung | Buchungsbelege 8 Jahre (seit 2025), Handelsbücher 10 Jahre | Fristen im Löschkonzept getrennt hinterlegt |
| §13b UStG | Reverse Charge bei Bauleistungen an Bauunternehmer | Kundenattribut, Belegtext, Verbuchung |
| §48 EStG | Bauabzugsteuer 15 % ohne Freistellung | Subunternehmer-Nachweise, Eingangsrechnungsprüfung |
| §14 UStG | Pflichtangaben auf Rechnungen | Prüfung vor Festschreibung |
| §312g BGB | Widerruf bei Haustürgeschäften (Verbraucher) | Widerrufsbelehrung als Angebotsanhang |
| §650 / §650i BGB | Kostenvoranschlag; Verbraucherbauvertrag mit Baubeschreibung | Getrennte Belegtypen, Vorlage Baubeschreibung |
| §640 BGB / VOB/B §12 | Abnahme als Fristbeginn | Abnahmeprotokoll triggert Gewährleistung |
| Gewährleistung | BGB 5/2 Jahre, VOB/B 4 Jahre | Automatik + VOB-Kennzeichen am Auftrag |
| VOB/B §17 | Sicherheitseinbehalt | Belegfunktion + Fristen-Engine |
| ArbZG / MiLoG | Arbeitszeiterfassung, Pausen, 2 Jahre Aufbewahrung | Prüfregeln in Zeiterfassung, unveränderbare Aufzeichnung |
| DSGVO | Löschkonzept, Auskunft, Art.-30-Verzeichnis, Mitarbeiterdaten (Standort, Leistungsauswertung) | DSGVO-Modul; Standort nur mit Einwilligung; Leistungsauswertungen rollenbeschränkt |
| KassenSichV | TSE bei elektronischen Kassen | Bewusst ausgeschlossen (siehe 12.) |
| MaStR | Meldepflicht des Betreibers | Vorbereitung/Export, keine Übernahme der Pflicht |

---

## 8. Hilfe & Dokumentation

### Internes Hilfesystem (Mitarbeiter/Admin)

- Kontextsensitive Hilfe an jedem Einstellungsdialog/Modul (z. B. "?" neben Kontenrahmen erklärt SKR03 vs. SKR04)
- Zentrale Wissensdatenbank pro Modul, Suchfunktion
- Kurzanleitungen zu Kernabläufen (Angebot erstellen, Regiebericht → Rechnung, Buchungssatz, Plantafel, Prüfprotokoll)
- Versionshinweise/Changelog für Endanwender
- Administrator-Handbuch: Installation, Backup, Update, Mandanten

### Separate Hilfeseite für das Kundenportal

- Öffentlicher Hilfebereich nur für Portalfunktionen, aus Kundensicht, einfache Sprache
- FAQ; kontextbezogene Verlinkung direkt aus dem Portal

---

## 9. Plattform-Strategie

### Phase 1: Webanwendung (PWA, offline-first)

- Reine Webanwendung für Desktop und Mobilgeräte
- Als PWA installierbar, Installations-Hinweis auf Mobilgeräten
- Offline-Erfassung für Zeiten, Regieberichte, Protokolle, Fotos, Aufmaß, Mängel; Sync-Status sichtbar
- Kamera-, Barcode-/QR-Scan über Browser-APIs

### Phase 2: Native Apps (später)

- Android und iOS (z. B. Capacitor-Wrapper der PWA), wenn Push-Zuverlässigkeit oder Hardwarezugriff (Bluetooth-Messgeräte) es erfordern

---

## 10. Roadmap

Leitgedanke: **So früh wie möglich einen echten Betrieb damit abwickeln.** Pilotbetrieb ist der Elektro-/PV-Betrieb des Maintainers; Version 1 ist erreicht, wenn dessen Aufträge vollständig in OpenGewerk laufen, von der Anfrage bis zur bezahlten Rechnung. Was dafür nicht nötig ist, kommt später. Ausnahme: Was sich nicht nachrüsten lässt (Datenmodell, Offline-Datenschicht, Festschreibung, Mandantentrennung), gehört ins Fundament, auch wenn die Oberfläche dafür später kommt.

| Phase | Inhalt | Ergebnis |
| --- | --- | --- |
| 0: Fundament (schlank) | Tech-Stack-Entscheidungen (ADR 0002-0008), Datenmodell-Kern (Kunde → Objekt → Anlage → Auftrag → Beleg), Mandanten + Rechte, Nummernkreise/Festschreibung, Audit-Log, **Offline-Datenschicht** (IDs, Sync-Queue, Konfliktregeln, ohne Baustellen-UI), Regel-Engine (1.7) mit den Regeln für Phase 1, Docker-Compose, Backup/Restore, Update | Gerüst, auf dem Phase 1 ohne Umbau aufsetzt |
| 1: MVP Pilotbetrieb | Kunden/Objekte/Anlagen (inkl. Anlagenstruktur Elektro), Angebot → AB → Regiebericht (mobil, Unterschrift) → Rechnung (Storno, Abschlag kumuliert), E-Rechnung ausgehend, Zeiterfassung (mobil, offline), Dokumentenablage, **ein** Prüfprotokoll (VDE 0100-600) über die Formular-Engine, Aufgaben, Benachrichtigung per E-Mail | Pilotbetrieb arbeitet produktiv damit; Parallelbetrieb der alten Buchhaltung beginnt |
| 1b: Messgeräte-PoC | Import einer echten Messdatei des Pilotbetriebs ins VDE-Protokoll | Go/No-Go für den Umfang des Messgeräte-Imports in Phase 2 |
| 2: Elektro/PV-Kern | Alle Prüfprotokolle (0105-100, DGUV V3, VDE-AR-N 4105), Messgeräte-Adapter laut PoC, PV-Dokumentation, Wartungsverträge, Fristen-Engine vollständig, QR-Etikett, Plantafel, Serviceaufträge/Dispatch, Material/Fahrzeuglager | Alleinstellungsmerkmal; Betrieb mit mehreren Monteuren |
| 3: Finance | E-Rechnungs-Empfang/Eingangsrechnungen, Journal, OP/Mahnwesen, Bank (FinTS), EÜR/USt-VA, DATEV-Export, Steuerberater-Rolle, Kanzlei-Connector (`opengewerk-api-spec` v1, Read-Endpunkte, Zugriffslog); Absicherung laut 4.8 | Buchhaltung ersetzt sevdesk/Lexware nach bestandenem Parallelbetrieb; Kanzlei-Hub kann anbinden |
| 3b: Kanzlei-Zusammenarbeit | Webhooks, Rückfragen-Postfach, Vorschlags-Freigabe, Kontenrahmen-Profile | Monatsabschluss läuft ohne E-Mail/Telefon |
| 4: Projekt-Tiefe | Bautagebuch, Kalkulation/Nachkalkulation, Stundenverrechnungssatz-Rechner, Nachträge, Subunternehmer, Einkauf, Fuhrpark/Werkzeug | Baustellenbetriebe |
| 5: Kundenportal | Angebote, Rechnungen, Zahlung, Termine, Störungsmeldung, Hilfeseite | Selbstbedienung |
| 6: Bilanz & Erweiterung | Anlagenbuchhaltung, Bilanz/GuV, Report-Builder, Anlagen-Monitoring, Plugin-Gewerke, lokale KI | Vollausbau |

---

## 11. Schwächen der Vergleichssysteme & unser Ansatz

Die ersten beiden Zeilen und die letzte sind keine Einzelentscheidungen, sondern derselbe Grundsatz an drei Stellen: Es gibt keine Funktion, die hinter einem Tarif liegt. Ausformuliert in Leitentscheidung 9.

| Schwäche in Vergleichssystemen | Unser Ansatz |
| --- | --- |
| plancraft: keine vollständige Buchhaltung (EÜR/USt-VA fehlen, nur DATEV-Export) | Volles Finance-Modul mit eigenem Journal, EÜR/USt-VA/Bilanz, gestaffelt ausgebaut |
| GAEB und Stammdaten nur in höheren Tarifen (openHandwerk, plancraft) | Alle Schnittstellen und Funktionen ohne Feature-Gates |
| Laufende Nutzer-/Monatskosten (z. B. 25-75 €/Nutzer/Monat) | Self-hosted, kein Abo und keine Nutzerlimits. Hosting, Wartung und Support sind buchbare Leistungen, aber keine Voraussetzung für den Betrieb |
| Daten beim Drittanbieter | Volle Datenkontrolle, Mandantenfähigkeit |
| Generischer Gewerke-Fokus, keine Elektro/PV-Tiefe | Elektro/PV als Kernmodul mit Messgeräte-Import, Anlagenakte, PV-Doku |
| Kundenzentriertes CRM ohne Objekt-/Anlagenmodell | Kunde → Objekt → Anlage als Kern |
| Erinnerungen als Einzelfeatures verstreut | Zentrale Fristen-Engine |
| Prüfprotokolle hartkodiert oder gar nicht vorhanden | Formular-Engine, Community-erweiterbar |
| KI nur als Cloud-Dienst | Optionale lokale KI |
| Steuerberater nur per Export oder Einzel-Login angebunden | Read-only-Rolle als Fallback; Kanzlei-Connector mit Scopes, Rückfragen und Vorschlags-Freigabe, Kanzlei-Hub bündelt alle Mandanten |
| Reporting nach Tarif limitiert | Report-Builder + SQL-Zugang |

---

## 12. Bewusst ausgeklammert / später

- **ELSTER-Direktübermittlung**: ERiC-Integration aufwändig, lizenzrechtlich in Open Source heikel; nur Anzeige/Export
- **Registrierkasse/TSE (KassenSichV)**: keine Kassenfunktion; Barzahlungen nur über Kassenbuch ohne elektronische Kasse
- **Wero als Händlerzahlung**: bis zur allgemeinen Verfügbarkeit
- **MaStR-Direktmeldung**: nur Vorbereitung
- **SOKA-BAU-Meldungen**: nur bei Bedarf des Bauhauptgewerbes
- **Mehrsprachigkeit**: Deutsch zuerst; i18n-Struktur von Anfang an, Übersetzungen später
- **Native Apps**: Phase 2 der Plattform-Strategie

---

## Änderungsprotokoll v2.4 → v2.5

- Präzisiert: Leitentscheidung 7 nennt die Reihenfolge. Fragen über Zusammenhänge werden zuerst als Abfrage über Datenmodell, Regel-Engine und Fristen-Engine gebaut, KI übernimmt nur den Rest, und KI schreibt nie direkt, sondern schlägt vor
- Präzisiert: Die REST-API für Drittanbieter in Abschnitt 6 wird ein eigener Vertrag. `opengewerk-api-spec` ist auf den Kanzlei-Hub zugeschnitten und soll dafür nicht gedehnt werden

## Änderungsprotokoll v2.3 → v2.4

- Neu: Leitentscheidung 9 zur Positionierung. OpenGewerk ist nicht die kostenlose Alternative, sondern die Software ohne künstlich beschränkte Funktionen. Dazu die drei Festlegungen, die das tragen: Einnahmen aus Dienstleistungen neben der Software, keine proprietären Erweiterungen auch durch das Projekt selbst, kein Contributor License Agreement
- Abschnitt 11 bezieht die Zeilen zu Feature-Gates und Tarifgrenzen auf diese Leitentscheidung; die Zeile zu laufenden Kosten sagt jetzt ausdrücklich, dass Dienstleistungen ein Angebot und keine Betriebsvoraussetzung sind

## Änderungsprotokoll v2.2 → v2.3

- Neu: 1.7 Regel-Engine für Rechtsvorschriften, gesetzliche Parameter als versionierte Regeldatensätze mit Gültigkeitszeitraum statt im Code
- Neu: Anlagenstruktur Elektro (Anlage → Verteiler → Feld → Stromkreis → Betriebsmittel) und PV (Wechselrichter → String → Module) in 3.2; Stromkreisverzeichnis und VDE-Protokolle bauen darauf auf
- Präzisiert: Messgeräte-Import in 5.1, Importquelle ist die Hersteller-PC-Software, Adapter je Hersteller, PoC vor Phase 2
- Neu: Absicherung des Finance-Moduls in 4.8 mit append-only-Journal, Property-based Tests, Parallelbetrieb und „Vorschau“-Label bis zur Steuerberater-Prüfung
- Roadmap (10) umgeschnitten: schlankes Fundament mit Offline-Datenschicht, Phase 1 als MVP für den Pilotbetrieb, neue Phase 1b Messgeräte-PoC; Plantafel, Serviceauftrag-Dispatch, Material und E-Rechnungs-Empfang nach hinten verschoben; Tech-Stack-Entscheidungen als ADR 0002-0008 referenziert

## Änderungsprotokoll v2.1 → v2.2

- Projektname **OpenGewerk** festgelegt (Orga `opengewerk`, Domain opengewerk.de); Repo-Namen `opengewerk`, `opengewerk-kanzlei`, `opengewerk-api-spec` in Leitentscheidung 8 eingetragen
- Paketname `kanzlei-api-spec` überall durch `opengewerk-api-spec` ersetzt

## Änderungsprotokoll v2 → v2.1

- Neu: Leitentscheidung 8, drei Repositories (Handwerkersoftware, Kanzlei-Hub, `opengewerk-api-spec`)
- Neu: Abschnitt 4.13 Kanzlei-Anbindung, Einstellungsseite Steuerberater (Einladungscode, Scopes, Zugriffslog), API-Endpunkte, Webhooks, Rückfragen-Postfach, Vorschlags-Freigabe, Kontenrahmen-Profile
- Ergänzt: Steuerberater-Rolle als Fallback ohne Hub (4.8), Schnittstellen (6), Roadmap Phase 3/3b (10), Vergleichstabelle (11)

## Änderungsprotokoll v1 → v2

- Neu: Leitentscheidungen (0), Architektur-Grundbausteine (1) mit Fristen-Engine, Formular-Engine, Dokumentenkette, Offline-Sync
- Neu: Objekt-/Anlagenakte, Wartungsverträge als Objekt, Serviceaufträge/Kundendienst, Bautagebuch, Subunternehmer, Nachtrag-Automatik, Kalkulationstiefe
- Neu: Belegtypen Auftragsbestätigung, Lieferschein, Regiebericht, Storno/Gutschrift, kumulierte Abschläge, Sicherheitseinbehalt, Kostenvoranschlag, Dauerrechnung
- Neu: Steuerlogik (§13b, §48 EStG, §19 UStG, §14 UStG, E-Rechnungs-Empfang), Verbraucherschutz (§312g, §650i BGB), Abnahme als Gewährleistungs-Trigger
- Neu: Eingangsrechnungs-Workflow, Anlagenbuchhaltung, Kassenbuch, Bankanbindung, Betriebsprüfer-Export, Steuerberater-Rolle
- Neu: ArbZG/MiLoG in Zeiterfassung, Mitarbeiter-Datenschutz
- Neu: Messgeräte-Import, Anlagen-Monitoring, QR-Etikett, generierte Verfahrensdoku, lokale KI, Stundenverrechnungssatz-Rechner
- Neu: Betrieb (Backup, Update, Mandanten), Roadmap (10), Rechtsübersicht (7), Ausklammerungen (12)
- Bereinigt: Mahnwesen, Wartungserinnerungen, Urlaubsverwaltung, E-Signatur, Zahlungsdienstleister, Gewährleistung jeweils nur noch an einer Stelle definiert
- Verschoben: Aufgabenverwaltung von CRM zu Querschnitt
- Korrigiert: Wero-Status, "Sofort-Überweisung" → Klarna/Instant Payment (allgemein gefasst), MaStR-Meldepflicht liegt beim Betreiber, Kundenportal-Terminverschiebung nur als Anfrage
- Priorisiert: Elektro/PV als Kernmodul, übrige Gewerke als Plugins
