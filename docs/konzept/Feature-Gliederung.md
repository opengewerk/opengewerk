# OpenGewerk: Feature-Gliederung Handwerkersoftware (CRM & ERP) · v2.21

2026-09-17 · Überarbeitung nach Konzept-Review; v2.1 ergänzt die Kanzlei-Anbindung (siehe separates Konzept *OpenGewerk Kanzlei*); v2.2 trägt den Projektnamen ein; v2.3 (18.09.2026) ergänzt Regel-Engine, Stromkreismodell, Messgeräte-Realität, Finance-Absicherung und schneidet die Roadmap auf ein MVP; v2.4 (18.09.2026) trägt die Positionierung als Leitentscheidung 9 ein; v2.5 präzisiert Leitentscheidung 7 um die Reihenfolge Abfrage vor KI; v2.6 (21.09.2026) korrigiert die Fundstelle des Kostenanschlags; v2.7 (22.09.2026) ergänzt die Ist-Versteuerung nach §20 UStG; v2.8 (22.09.2026) legt den Mailserver in die Einstellungen jedes Betriebs; v2.9 (22.09.2026) legt das Zahlungsziel als Einstellung des Betriebs fest, je Beleg überschreibbar, und ordnet Zahlungsbedingungen je Kunde und Skonto der Phase 3 zu; v2.10 (22.09.2026) ordnet jeden Punkt der Abschnitte 1 bis 9 einer Phase zu; v2.11 (22.09.2026) macht aus der Widerrufsbelehrung Belehrungen, die der Betrieb pflegt, mit der E-Mail versendet und im Kundenportal zeigt; v2.12 (22.09.2026) präzisiert, wie eine Belehrung mit dem Beleg hinausgeht; v2.13 (22.09.2026) macht die Widerrufsbelehrung an jedem Angebot an einen Verbraucher zur Pflicht, schlägt für den Kostenvoranschlag keine vor und ergänzt die Hinweise nach Art. 246a §1 Abs. 3 EGBGB; v2.14 (22.09.2026) nennt die Aderzahl der Leitung im Stromkreismodell und das Stromkreisverzeichnis als Ausdruck je Verteiler; v2.15 (23.09.2026) lässt die Dokumentenkette sich nicht mehr verzweigen; v2.16 (23.09.2026) ergänzt den Nullsteuersatz für Photovoltaik; v2.17 (23.09.2026) lässt die Sicherung jede Nacht ohne Zutun laufen; v2.18 (24.09.2026) trägt die Entscheidungen vom 24.09.2026 ein: Regiebericht als Beleg mit eigenen Feldern, Abzug der vereinnahmten Abschläge, Sammelrechnung, Folgeauftrag, Auftragsnummer, Auswahl je Gerät, Bereich für den Betreiber und die Phasen der Punkte, die noch keine hatten; v2.19 (24.09.2026) präzisiert das Format der Formulardefinitionen und was ein Prüfprotokoll aus dem letzten übernimmt; v2.20 (25.09.2026) macht die Notizen der Baustelle zu eigenen Einträgen neben der Beschreibung des Auftrags; v2.21 (26.09.2026) ergänzt die Pflichtangaben auf Geschäftsbriefen unter jeder E-Mail des Betriebs (Vergleich mit openHandwerk, plancraft, HERO, TAIFUN/STREIT, sevdesk/Lexware, Odoo/SAP FSM/Dynamics)

Vollständige Feature-Liste für ein eigenständiges Open-Source-System (self-hosted), orientiert an den Stärken der Vergleichssysteme und gezielt um deren Schwächen ergänzt.

**Legende**
- ★ = geht über das hinaus, was Vergleichssysteme bieten (eigene Idee)
- ⚖ = rechtlich/regulatorisch erforderlich (Deutschland)
- ⏳ = im Plan, aber bewusst später umsetzen
- In welcher Phase ein Punkt gebaut wird, steht in Abschnitt 10

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
- **Anlage** (PV-Anlage, Speicher, Zähler, Zählerschrank, Wallbox, Heizung), gehört zu einem Objekt, trägt Prüfhistorie, Gewährleistung, Wartungsvertrag. Der Wechselrichter gehört nicht dazu, er hängt nach 3.2 unter der PV-Anlage
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

- Prüfprotokolle, Abnahmeprotokolle und Checklisten sind **datengetriebene Formulare** (Definition als JSON-Datei in einem eigenen Formularformat), nicht hartkodiert
- Der Regiebericht ist kein Formular, sondern ein Beleg (4.2): er trägt Positionen, wird unterschrieben, festgeschrieben und abgerechnet und steht in der Dokumentenkette. Über die Engine bekommt er Felder, die der Betrieb ihm gibt, etwa Wetter, Anfahrt oder Besonderheiten der Baustelle
- Felder: Text, Zahl mit Einheit, Messwert mit Grenzwert-Prüfung, Foto, Unterschrift, Auswahl, Wiederholgruppe (z. B. Stromkreise)
- Versionierung der Formulardefinitionen (altes Protokoll bleibt mit alter Definition lesbar)
- Das letzte Protokoll einer Anlage ist die Vorlage des nächsten: übernommen wird, was die Definition dafür kennzeichnet, was die Anlage und die Art der Prüfung beschreibt (Prüfer, Messgerät, Netzform); was die letzte Prüfung festgestellt, gemessen und unterschrieben hat, nicht. Die Wiederholgruppe je Stromkreis kommt immer aus dem Stromkreisverzeichnis, wie es heute steht
- PDF-Rendering mit Vorlage, Signatur eingebettet
- Community kann Gewerke-Formulare per Pull Request beisteuern, im Paketformat nach ADR 0008 unter `packages/gewerke/<name>/`; die Formulare und Grenzwerte von Elektro/PV liegen von Anfang an so, die Anlagenstruktur (3.2) gehört zum Datenmodell-Kern

### 1.4 Dokumentenkette

Eine Positionsliste läuft durch alle Belege: **Angebot → Auftragsbestätigung → Lieferschein / Regiebericht → (Abschlags-/Teil-)Rechnung → Schlussrechnung → Storno/Gutschrift**. Jeder Beleg kennt seinen Vorgänger; Mengenabgleich (angeboten, geliefert, abgerechnet) ist jederzeit sichtbar. Die Kette verzweigt sich nicht: ein Beleg hat höchstens einen Folgebeleg, der gilt, und der nächste entsteht aus dem letzten Glied, damit jede Rechnung abzieht, was vor ihr gestellt wurde. Ein stornierter Folgebeleg zählt nicht mehr, sein Vorgänger ist danach frei für den, der ihn ersetzt; Storno und Gutschrift korrigieren ein Glied, statt eines zu sein. Die eine Stelle, an der Glieder zusammenlaufen, ist die Sammelrechnung: eine Rechnung fasst die Regieberichte eines Auftrags zusammen, etwa einen je Arbeitstag, und jeder davon hat damit seinen einen Folgebeleg.

### 1.5 Nummernkreise & Festschreibung ⚖

- Lückenlose, mandantenbezogene Nummernkreise je Belegtyp (konfigurierbares Muster), dazu einer für Aufträge; eine Nummer vergibt der Server, ein ohne Netz angelegter Datensatz bekommt sie beim Abgleich
- Festschreibung mit Zeitstempel beim Versand/Buchung; danach nur Storno oder Korrekturbeleg
- Audit-Log auf Feldebene

### 1.6 Offline-Sync ★

- Lokale Datenbank im Client (IndexedDB), Schreibqueue, Service Worker
- Auswahl je Gerät: ein Monteur hält nur, was zu seinen Aufträgen gehört, also die Aufträge, denen er zugeordnet ist, mit Kunde, Objekt, Anlage, Belegen, Aufgaben, Dateien und Ansprechpartnern, dazu was er selbst angelegt hat; ein abgeschlossener Auftrag bleibt 30 Tage nach dem Abschluss. Inhaber und Büro halten den ganzen Betrieb. Beim Abmelden wird die lokale Datenbank gelöscht ⚖
- Sichtbares Sync-Status-Panel: unsynchronisierte Einträge, Konflikte, Entscheidung durch Nutzer
- Fotos werden komprimiert lokal gehalten und nachgeladen

---

### 1.7 Regel-Engine für Rechtsvorschriften ★ ⚖

Gesetzliche Parameter stehen **nicht im Code**, sondern in versionierten Regeldatensätzen mit Gültigkeitszeitraum (gültig ab / bis), Quelle (Paragraf, Fundstelle) und Mandantenbezug, wo nötig:

- Umsatzsteuer: Steuersätze einschließlich des Nullsteuersatzes für Photovoltaik nach §12 Abs. 3, Kleinunternehmergrenze §19, Umsatzgrenze der Ist-Versteuerung §20, Kleinbetragsgrenze §33 UStDV, Ausstellungspflicht E-Rechnung (Umsatzschwelle, Stichtag), §13b-Regeln
- Bau: Bauabzugsteuer-Satz, Sicherheitseinbehalt-Standards, Gewährleistungsfristen BGB/VOB
- Arbeit: ArbZG-Höchstarbeitszeit, Pausenregeln, MiLoG-Aufbewahrung
- Aufbewahrung: GoBD-Fristen je Belegart, DSGVO-Löschfristen
- Mahnwesen: Verzugszinssätze (Basiszins), Mahnpauschale

Ein Gesetzesupdate ist ein neuer Regeldatensatz mit Gültigkeitsbeginn, kein Release. Regeln werden historisch angewendet: Ein Beleg von 2027 wird auch 2030 nach den Regeln von 2027 beurteilt. Regelpakete sind Teil des Repos (versioniert, community-pflegbar) und werden mit Updates ausgeliefert; ein Mandant kann Regeln nicht überschreiben, nur mandantenbezogene Parameter setzen (z. B. „ist Kleinunternehmer“).

---

## 2. Querschnittsfunktionen (systemweit)

- Benutzer- und Rechteverwaltung: rollenbasiert (Buchhaltung, Techniker, Bauleiter, Büro, Admin, **Steuerberater read-only** ★, Kunde im Portal)
- Anmeldung mit Passwort und zweitem Faktor (TOTP, für Inhaber Pflicht); Passkeys mit Liste, Widerruf und Bestätigung vor der Registrierung, ein Passkey mit Nutzerbestätigung zählt als zweiter Faktor; Anmeldung über einen eigenen Identitätsanbieter (OIDC) für Betriebe, die einen haben
- Mandantenfähigkeit: mehrere Firmen auf einer Instanz, getrennte Nummernkreise, Kontenrahmen, Briefpapier. Einen weiteren Betrieb legt ein Inhaber im Büro für sich an, der Betreiber der Instanz auf der Kommandozeile für andere
- Bereich für den Betreiber der Instanz: was nicht einem Betrieb gehört, sondern der Instanz, etwa ein Mailserver im eigenen Netz, die Uhrzeit der Sicherung und die Betriebe auf ihr. Betreiber ist das Konto aus der Ersteinrichtung, mit Pflicht zum zweiten Faktor; weitere lassen sich dort benennen
- Audit-Log/Änderungsprotokoll über alle Module, für den Inhaber im Büro einsehbar
- **Aufgabenverwaltung** (aus CRM hierher verschoben): To-Dos mit Fälligkeit, Verantwortlichem, Status; optional an Kunde/Objekt/Auftrag gebunden; automatisch erzeugt durch Fristen-Engine
- Benachrichtigungssystem: E-Mail/Push (Web-Push), gespeist ausschließlich durch die Fristen-Engine und Statuswechsel (keine modulspezifischen Erinnerungs-Implementierungen). E-Mails gehen über den Mailserver des Betriebs, eingerichtet in dessen E-Mail-Einstellungen hinter einem eigenen Recht; die Zugangsdaten liegen verschlüsselt, Speichern prüft die Verbindung, und eine Signatur mit Platzhaltern ({benutzer}, {briefkopf}) steht unter jeder Nachricht. {briefkopf} trägt den Briefkopf samt Handelsregister, Vertretung und USt-IdNr., soweit sie dort stehen, und damit die Pflichtangaben auf Geschäftsbriefen ⚖; eine Signatur ohne {briefkopf} trägt sie nicht
- Dubletten-Prüfung (Kunden, Objekte, Artikel) beim Anlegen und Importieren
- Datenimport/-export (CSV/Excel); Importassistenten für Migration aus plancraft/HERO/sevdesk-Exporten
- Globale Volltextsuche (Kunden, Objekte, Anlagen, Belege, Dokumente, Protokolle)
- Offene REST-API + Webhooks; OpenAPI-Spezifikation
- Textbausteine/Vorlagen (Positionen, Mails, Belegtexte, Rechtstexte)
- DSGVO-Funktionen ⚖: Löschkonzept mit Aufbewahrungsfristen, Auskunft/Datenexport, Verarbeitungsverzeichnis (Art. 30) als generiertes Dokument, AV-Vertragsvorlage für Hoster/Zahlungsdienstleister
- Betrieb: Backup/Restore (inkl. Dokumentenspeicher, jede Nacht ohne Zutun, der Zeitpunkt der letzten Sicherung im Büro sichtbar), Update-Mechanismus mit DB-Migrationen, Health-Check, Docker-Compose-Referenzinstallation, Dateispeicher im Dateisystem oder über S3
- Releases mit Versionsnummer und fertigen, signierten Abbildern: ein Update zieht die neue Fassung, statt sie aus dem Quelltext zu bauen, und jede frühere bleibt erreichbar
- Externe Sicherheitsprüfung vor dem ersten Release mit Kanzlei-Connector oder Kundenportal

---

## 3. CRM

### 3.1 Stammdaten & Kontakte

- Kunden (Privat/Gewerbe/Hausverwaltung/GU) mit vollständigen Adress- und Kontaktdaten, das Land eingeschlossen (Vorgabe Deutschland; es entscheidet mit über das Format der E-Rechnung). Was ein Kunde im Ausland darüber hinaus braucht, etwa Lieferungen in die EU, die Prüfung der USt-IdNr. oder eine Ausfuhr, kommt mit der Buchhaltung
- Steuerliche Attribute ⚖: USt-ID, Kunde ist Unternehmer (→ E-Rechnungspflicht), Bauleistungsempfänger (→ §13b), Freistellungsbescheinigung §48 EStG mit Ablaufdatum (→ Fristen-Engine)
- Mehrere Ansprechpartner pro Kunde; Ansprechpartner pro Objekt (Mieter, Hausmeister)
- Kommunikationshistorie (Anrufe, Mails, Notizen) zentral am Kunden **und** am Objekt
- Lead-Erfassung und Qualifizierung vor Kundenanlage
- Segmentierung/Tags (Gewerk, Region, Kundentyp, Bestandskunde/Neukunde)
- Kundenpreise, Rabattgruppen, Zahlungsbedingungen je Kunde (Zahlungsbedingungen mit Phase 3: sie setzen sich zwischen das Zahlungsziel des Betriebs und das eines Belegs, siehe 4.2)

### 3.2 Objekt- & Anlagenakte

- Objekte mit Adresse samt Land, Zugang (Schlüssel, Codes, verschlüsselt gespeichert), Ansprechpartnern, Fotos
- Anlagen mit Typ, Hersteller, Seriennummer, Inbetriebnahme, Gewährleistungsende, zugeordneten Prüfprotokollen, Wartungsverträgen, Serviceaufträgen
- **Anlagenstruktur (Elektro) ★**: Anlage → Verteiler (NSHV, UV) → Feld → Stromkreis → Betriebsmittel. Je Stromkreis: Bezeichnung, Sicherung (Typ, Nennstrom, Charakteristik), RCD (Typ, IΔn), Leitung (Typ, Aderzahl, Querschnitt, Länge, Verlegeart), Verbraucher; je Betriebsmittel: Typ, Hersteller, Seriennummer. Diese Struktur ist zugleich das Gerüst der Prüfprotokolle nach VDE 0100-600 / 0105-100 (Messwerte werden je Stromkreis erfasst) und das Stromkreisverzeichnis für den Verteilerausdruck, ein Blatt je Verteiler für seine Tür. Für PV analog: Anlage → Wechselrichter → String → Module, plus Speicher, Zähler, Wallbox.
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
- Belehrungen, die mit einem Beleg hinausgingen, am Beleg einsehen und herunterladen, im Wortlaut, in dem der Kunde sie bekommen hat
- Widerrufsfunktion nach §356a BGB für Verträge, die im Portal geschlossen werden: eine ständig erreichbare Schaltfläche „Vertrag widerrufen“ mit Bestätigung und Eingangsbestätigung ⚖

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
- Auftragsmappe: Auftragsnummer (1.5), Status, Historie, alle verknüpften Belege/Dokumente/Protokolle an einem Ort
- Zuordnung der Monteure zu einem Auftrag im Büro; sie entscheidet, was auf ihren Geräten liegt (1.6). Auf der Baustelle schließt ein Monteur seinen Auftrag ab und schreibt Notizen daran, jede ein eigener Eintrag mit Person und Uhrzeit, auch ohne Netz, und danach nicht mehr änderbar; das Büro liest sie am Auftrag. Kunde, Objekt, Bezeichnung und die Beschreibung, was zu tun ist, ändert das Büro
- Folgeauftrag zu einem abgeschlossenen Auftrag, etwa die Wallbox nach dem Zählerschrank oder eine Nacharbeit: derselbe Kunde, im Büro angelegt und mit Objekt, Anlage und Art vorbelegt, verknüpft in beide Richtungen; ein Auftrag kann mehrere haben. Eine Erweiterung während der Arbeit ist ein Nachtrag, kein Folgeauftrag
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
- Kostenvoranschlag (§649 BGB) und Angebot, getrennte Dokumente mit unterschiedlicher Rechtsfolge ⚖
- Angebot mit Positionsgliederung, Titeln, Alternativ-/Eventual-/Bedarfspositionen, optionalen Positionen, Textbausteinen
- Auftragsbestätigung
- Lieferschein
- Regiebericht / Stundenlohnzettel mit Kundenunterschrift (mobil)
- Abschlagsrechnung **kumuliert** (Leistungsstand gesamt, abzüglich bisher gestellt und bisher gezahlt), Teilrechnung für getrennt abgenommene Bauabschnitte, Schlussrechnung
- Die Schlussrechnung zieht die vereinnahmten Abschläge ab, nicht die gestellten (§14 Abs. 5 UStG) ⚖: vor dem Festschreiben wird je Abschlagsrechnung eingetragen, was eingegangen ist, voll, zum Teil mit Betrag oder nichts, bis die Offene-Posten-Verwaltung das weiß. Sie heißt „Schlussrechnung“, sobald sie Abschläge abzieht, sonst „Rechnung“
- Sammelrechnung über die Regieberichte eines Auftrags, wenn Regiearbeit über mehrere Tage geht (1.4)
- Sicherheitseinbehalt (VOB/B §17, prozentual, Auszahlungsdatum über Fristen-Engine)
- Stornorechnung und Gutschrift (Rechnungskorrektur), nie Löschung ⚖
- Dauerrechnung (Wartungsverträge)

**Steuerliche Logik ⚖**
- E-Rechnung ausgehend: XRechnung/ZUGFeRD; automatische Formatwahl je Empfänger (B2B-Inland → E-Rechnung, Verbraucher → PDF); Umsatzgrenze 800.000 € (2027) und Vollpflicht ab 2028 als Mandanteneinstellung
- Kleinbetragsrechnung bis 250 €, Kleinunternehmerregelung §19 UStG (Mandanteneinstellung, Pflichthinweis)
- Besteuerung nach vereinnahmten Entgelten §20 UStG (Ist-Versteuerung, auf Antrag vom Finanzamt gestattet): Mandanteneinstellung mit Gültigkeitszeitraum; ab 2028 Pflichtangabe „Versteuerung nach vereinnahmten Entgelten“ auf der Rechnung (§14 Abs. 4 Satz 1 Nr. 6a UStG)
- Nullsteuersatz für Photovoltaik nach §12 Abs. 3 UStG seit 1.1.2023: 0 % auf die Lieferung und Installation von Solarmodulen, der für den Betrieb wesentlichen Komponenten und der Speicher an den Betreiber einer Anlage auf oder bei Wohnungen und Gebäuden, die dem Gemeinwohl dienen; bis 30 kWp laut Marktstammdatenregister gelten die Voraussetzungen als erfüllt. Je Position wählbar wie der ermäßigte Satz, eine eigene Steuergruppe mit Fundstelle auf dem Beleg, in der E-Rechnung Kategorie Z. Ob die Voraussetzungen vorliegen, entscheidet der Betrieb, das Formular nennt sie
- §13b UStG Reverse Charge für Bauleistungen an Bauunternehmer (Pflichthinweis, Nettoausweis, korrekte Verbuchung)
- Bauabzugsteuer §48 EStG auf Eingangsseite (Einbehalt, Anmeldung vorbereiten)
- Pflichtangaben-Prüfung nach §14 UStG vor Festschreibung
- Belehrungen als Anhang eines Belegs: mitgeliefert die Muster-Widerrufsbelehrung mit Muster-Widerrufsformular für Verträge außerhalb von Geschäftsräumen und im Fernabsatz (§312g BGB, Anlagen 1 und 2 zu Art. 246a EGBGB), als Fassung mit Gültigkeitszeitraum und Fundstelle wie ein Regelpaket; dazu eigene Belehrungen des Betriebs. Vorhandene lassen sich ändern und erweitern, ein geändertes Muster verliert aber die Absicherung aus Art. 246a §1 Abs. 2 Satz 2 EGBGB, das sagt der Bildschirm, und der Originalwortlaut bleibt wiederherstellbar. Je Belehrung einstellbar, zu welchen Belegarten und Kunden sie gehört und ob sie mit dem Beleg hinausgeht, im PDF nach dem Beleg und damit in seiner E-Mail, oder als eigenes Blatt am Beleg bereitliegt; eingefroren mit dem Beleg und später im Kundenportal abrufbar (3.6). Ein Vordruck für das ausdrückliche Verlangen des vorzeitigen Beginns (§356 Abs. 5 Nr. 2, §357a Abs. 2 BGB) gehört dazu, ebenso Hinweise, wann kein Widerrufsrecht besteht und unter welchen Umständen es vorzeitig erlischt (Art. 246a §1 Abs. 3 EGBGB). Zu einem Angebot an einen Verbraucher gehören Widerrufsbelehrung, Hinweise und Formular zwingend, denn die Belehrung muss beim Kunden sein, bevor er annimmt (Art. 246a §4 Abs. 1 EGBGB): dort lassen sie sich weder abschalten noch vom Angebot lösen, und sie gehen mit ihm hinaus. Einem Kostenvoranschlag wird keine vorgeschlagen, dazunehmen lässt sie sich von Hand
- Verbraucherbauvertrag §650i BGB mit Baubeschreibung und eigener Widerrufsbelehrung (§650l BGB, Art. 249 §3 EGBGB)

**Zahlung**
- Zahlungsziel in Tagen als Einstellung des Betriebs mit Gültigkeitszeitraum, je Beleg überschreibbar; ein Folgebeleg übernimmt ein eigenes Zahlungsziel. Angebot, Kostenvoranschlag und Auftragsbestätigung nennen die Tage, die Rechnung das Fälligkeitsdatum, auch in der E-Rechnung; eingefroren mit dem Beleg. Liegt das Ziel gegenüber einem Unternehmen über 60 Tagen, weist der Belegkopf darauf hin, dass es ausdrücklich vereinbart sein muss, damit es trägt (§271a BGB) ⚖
- Mit Phase 3: automatisierte Zahlungsbedingungen, Skonto, Zahlungsziele (Fristen-Engine). Ein Zahlungsziel je Kunde (3.1) hat dann Vorrang vor dem des Betriebs, das eines Belegs Vorrang vor ihm; Skonto braucht den Zahlungseingang aus der Offene-Posten-Verwaltung, um zu wissen, ob rechtzeitig gezahlt wurde
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
- EÜR, USt-Voranmeldung, BWA, Bilanz/GuV als Auswertungen über das Journal; die USt-Voranmeldung nach vereinbarten oder vereinnahmten Entgelten, je nach Mandanteneinstellung (§20 UStG)
- Jahresabschluss-Unterstützung (Abgrenzungen, Rückstellungen, Saldovortrag)
- Datenzugriff für Betriebsprüfung ⚖: Z1/Z2/Z3, GDPdU/IDEA-Export
- **Absicherung des Finance-Moduls** (größtes fachliches Risiko des Projekts): Journal technisch append-only (kein UPDATE/DELETE auf Buchungszeilen, Storno als Gegenbuchung); Buchungslogik als reine Funktionen mit Property-based Tests (Summenprobe, Soll = Haben, Steuerverprobung); Referenzfälle aus Lehrbuch-/IHK-Buchungssätzen als Testdaten; **Parallelbetrieb**: der Pilotbetrieb führt mindestens ein Geschäftsjahr parallel in der bisherigen Buchhaltung und vergleicht monatlich; die Auswertungen EÜR/USt-VA/Bilanz tragen bis zur Prüfung durch einen Steuerberater das Label „Vorschau, nicht abgabefertig“
- DATEV-Exportschnittstelle (Buchungsstapel, Belegbilder)
- **Steuerberater-Rolle ★**: Read-only-Mandantenzugang mit Belegbild, Journal, Kommentarfunktion, Fallback für Kanzleien ohne Kanzlei-Hub; die eigentliche Anbindung läuft über den Kanzlei-Connector (4.13)
- ELSTER ⏳: nur Anzeige/Export der USt-VA-Werte; Direktübermittlung bewusst nicht umgesetzt

### 4.9 Personal / HR

- Mitarbeiterakte inkl. Stundensätze (Kosten- und Verrechnungssatz) und vereinbarter Arbeitszeit, aus der die Überstunden der Zeiterfassung folgen (4.4); die acht Stunden aus §3 ArbZG sind eine Grenze und kein Maßstab dafür
- Qualifikationen/Zertifikate mit Ablauffristen (Elektrofachkraft, PV-Zertifizierung, Höhenarbeit, Führerschein) → Fristen-Engine
- Urlaubsverwaltung (Datenquelle; Plantafel zeigt an)
- Lohn-Vorbereitung / Export an externe Lohnbuchhaltung
- Zugang für Subunternehmer (eingeschränkt)

### 4.10 Dokumentenmanagement

- Zentrale, GoBD-konforme Belegablage, verknüpft mit Kunde/Objekt/Anlage/Projekt
- Virenscan für Dateien, die von außen kommen, aus dem E-Mail-Import und dem Kundenportal
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
| §12 Abs. 3 UStG | Nullsteuersatz seit 1.1.2023 für Lieferung und Installation von Photovoltaikanlagen und Speichern an den Betreiber | Steuersatz je Position aus der Regel-Engine, eigene Steuergruppe, E-Rechnung Kategorie Z |
| §48 EStG | Bauabzugsteuer 15 % ohne Freistellung | Subunternehmer-Nachweise, Eingangsrechnungsprüfung |
| §14 UStG | Pflichtangaben auf Rechnungen | Prüfung vor Festschreibung |
| §37a, §125, §177a HGB, §35a GmbHG, §80 AktG, §25a GenG, §7 Abs. 3 PartGG | Pflichtangaben auf Geschäftsbriefen jeder Form, auch E-Mails: je nach Rechtsform Firma, Sitz, Registergericht, Registernummer, Geschäftsführer oder Vorstand; keine für ein Einzelunternehmen ohne Eintrag im Handelsregister | Briefkopf mit Handelsregister und Vertretung, in der Fußzeile jedes Belegs und über {briefkopf} unter jeder E-Mail |
| §20 UStG | Ist-Versteuerung auf Antrag bis 800.000 € Vorjahresumsatz; ab 2028 Angabe auf der Rechnung | Mandanteneinstellung mit Zeitraum, Rechnungsangabe aus der Regel-Engine, USt-VA nach vereinnahmten Entgelten |
| §312g BGB | Widerruf bei Verträgen außerhalb von Geschäftsräumen und im Fernabsatz (Verbraucher) | Belehrungen als Anhang, Muster nach Art. 246a EGBGB und Hinweise nach dessen §1 Abs. 3, Pflicht an jedem Angebot an einen Verbraucher, Versand mit der E-Mail |
| §356a BGB | Widerrufsfunktion bei Fernabsatzverträgen über eine Online-Oberfläche | Schaltfläche „Vertrag widerrufen“ im Kundenportal |
| §649 / §650i BGB | Kostenvoranschlag; Verbraucherbauvertrag mit Baubeschreibung | Getrennte Belegtypen, Vorlage Baubeschreibung |
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
| 1: MVP Pilotbetrieb | Kunden/Objekte/Anlagen (inkl. Anlagenstruktur Elektro), Angebot → AB → Regiebericht (mobil, Unterschrift) → Rechnung (Storno, Abschlag kumuliert), E-Rechnung ausgehend, Zeiterfassung (mobil, offline), Dokumentenablage, **ein** Prüfprotokoll (VDE 0100-600) über die Formular-Engine, Aufgaben, Benachrichtigung per E-Mail, Zahlungsziel, Belehrungen mit Widerrufsbelehrung ⚖ | Pilotbetrieb arbeitet produktiv damit; Parallelbetrieb der alten Buchhaltung beginnt |
| 1b: Messgeräte-PoC | Import einer echten Messdatei des Pilotbetriebs ins VDE-Protokoll | Go/No-Go für den Umfang des Messgeräte-Imports in Phase 2 |
| 2: Elektro/PV-Kern | Alle Prüfprotokolle (E-Check, 0105-100, DGUV V3, VDE-AR-N 4105), Abnahme mit Gewährleistung und Mängeln ⚖, Messgeräte-Adapter laut PoC, PV-Dokumentation, Wartungsverträge, Fristen-Engine vollständig, QR-Etikett, Plantafel, Serviceaufträge/Dispatch, Material/Fahrzeuglager, Personal, DSGVO-Funktionen ⚖ | Alleinstellungsmerkmal; Betrieb mit mehreren Monteuren |
| 3: Finance | E-Rechnungs-Empfang/Eingangsrechnungen, Journal, OP/Mahnwesen, Zahlungsbedingungen je Kunde und Skonto (4.2), Bank (FinTS), EÜR/USt-VA, DATEV-Export, Lohnexport, Verfahrensdokumentation und Datenzugriff für die Betriebsprüfung ⚖, Steuerberater-Rolle, Kanzlei-Connector (`opengewerk-api-spec` v1, Read-Endpunkte, Zugriffslog); Absicherung laut 4.8 | Buchhaltung ersetzt sevdesk/Lexware nach bestandenem Parallelbetrieb; Kanzlei-Hub kann anbinden |
| 3b: Kanzlei-Zusammenarbeit | Webhooks, Rückfragen-Postfach, Vorschlags-Freigabe, Kontenrahmen-Profile | Monatsabschluss läuft ohne E-Mail/Telefon |
| 4: Projekt-Tiefe | Bautagebuch, Kalkulation/Nachkalkulation, Stundenverrechnungssatz-Rechner, Nachträge, Subunternehmer, Einkauf, Fuhrpark/Werkzeug | Baustellenbetriebe |
| 5: Kundenportal | Angebote, Rechnungen, Zahlung, Termine, Störungsmeldung, Abnahme, eigene Anlagen und Dokumente, Hilfeseite | Selbstbedienung |
| 6: Bilanz & Erweiterung | Anlagenbuchhaltung, Bilanz/GuV, Report-Builder, Anlagen-Monitoring, Plugin-Gewerke, lokale KI, Volltextsuche, offene API für Drittanbieter | Vollausbau |

**Zuordnung im Einzelnen.** Die Tabelle nennt die Schwerpunkte. Die übrigen Punkte der Abschnitte 1 bis 9 gehören so zu den Phasen; beides zusammen ist der Fahrplan, und aus beidem werden die Issues einer Phase geschnitten. Was in keiner Phase steht, steht in Abschnitt 12. Wer in 1 bis 9 einen Punkt einträgt, trägt seine Phase im selben Zug hier ein.

- **Phase 1:** das Zahlungsziel des Betriebs, je Beleg überschreibbar (4.2); der Nullsteuersatz für Photovoltaik nach §12 Abs. 3 UStG je Position (1.7, 4.2) ⚖, weil der Pilotbetrieb PV-Anlagen an private Haushalte baut; die Belehrungen als Anhang eines Belegs, mitgeliefert die Widerrufsbelehrung nach §312g BGB, an jedem Angebot an einen Verbraucher Pflicht, dazu eigene des Betriebs, mit der E-Mail versendet und mit dem Beleg eingefroren (4.2) ⚖, weil der Pilotbetrieb Angebote beim Kunden zu Hause schreibt; eigene Felder des Betriebs am Regiebericht über die Formular-Engine (1.3); die Auftragsnummer, die Zuordnung der Monteure mit der Auswahl je Gerät und der Folgeauftrag (1.5, 1.6, 4.1), weil ein verlorenes Telefon sonst den ganzen Kundenstamm trägt ⚖; die Sammelrechnung über Regieberichte, der Abzug der vereinnahmten Abschläge und die Überschrift „Rechnung“ oder „Schlussrechnung“ (1.4, 4.2) ⚖, weil der Pilotbetrieb Regiearbeit über mehrere Tage mit einer Rechnung abrechnet; der Hinweis nach §271a BGB (4.2) ⚖; das Land an Kunde und Objekt (3.1, 3.2); die Pflichtangaben auf Geschäftsbriefen unter jeder E-Mail (2, 7) ⚖; Releases mit fertigen Abbildern (2), damit der Pilotbetrieb einen Stand hat, zu dem er zurückkehren kann
- **Phase 2:** das E-Check-Protokoll (5.1); das Abnahmeprotokoll nach §640 BGB über die Formular-Engine mit der Gewährleistungsfrist ab Abnahme, Mängel mobil mit Statusverfolgung und Mängelbericht (4.11) ⚖; Netzbetreiber-Anmeldung, Vorbereitung der MaStR-Meldung, Wallbox und Speicher mit Inbetriebnahme, Förderunterlagen und Prüfintervallen (5.1); der Zugang zum Objekt (Schlüssel, Codes), versiegelt gespeichert (3.2); Serviceaufträge mit Schnellerfassung und Sofortabrechnung vor Ort, Notdienst mit Rufbereitschaftsplan und Notdienstzuschlägen (4.1, 4.3); zur Plantafel Serientermine, Urlaubs- und Krankheitsverwaltung, Terminbestätigung per Web-Push und CalDAV-Sync (2, 4.3, 6); Mitarbeiterakte und Qualifikationen mit Ablauffristen (4.9); Wartungsverträge mit Dauerrechnung (3.5, 4.2); Lieferantenverwaltung, Lieferschein und DATANORM-Import zum Material (4.2, 4.5); aus der Fristen-Engine Wiedervorlagen für Angebote und Wartungs- und Prüferinnerungen an Kunden (1.2, 3.3, 3.7); Leads und Vertriebspipeline, Kommunikationshistorie mit Notizen und Telefonprotokollen, Tags, Bestätigungsmails zu Termin und Auftragseingang mit Textbausteinen für Mails (2, 3.1, 3.3, 3.4); die DSGVO-Funktionen mit Löschkonzept, Auskunft und Datenexport, Verarbeitungsverzeichnis und AV-Vertragsvorlage (2) ⚖; die Hilfe im Büro und auf der Baustelle mit kontextsensitiver Hilfe, Kurzanleitungen, Versionshinweisen und Administrator-Handbuch (8); Passkeys als Anmeldung und zweiter Faktor (2); ein weiterer Betrieb, vom Inhaber im Büro angelegt, und der Bereich für den Betreiber der Instanz (2); die Einsicht ins Audit-Log im Büro (2); die vereinbarte Arbeitszeit in der Mitarbeiterakte und die Überstunden daraus, angezeigt als Zeitkonto (4.4, 4.9)
- **Phase 3:** der Lohnexport aus der Zeiterfassung (DATEV Lodas und Lohn & Gehalt, CSV) mit Zuschlägen, Auslöse und Verpflegungsmehraufwand (4.4, 4.9); Gutschrift und Rechnungskorrektur (4.2); Kassenbuch und BWA (4.8); der Datenzugriff für die Betriebsprüfung Z1-Z3 mit GDPdU-Export und die generierte Verfahrensdokumentation (4.8, 4.10) ⚖; die Bank auch über EBICS, der Zahlungsabgleich mit PayPal und Stripe (4.8, 6); die Rolle Buchhaltung (2); Datenimport und -export mit Dubletten-Prüfung und die Importassistenten aus plancraft, HERO und sevdesk (2), weil hier der Wechsel des ganzen Betriebs stattfindet; Überstunden ausgezahlt oder übertragen, mit dem Lohnexport (4.4); der Virenscan für Dateien von außen, weil mit dem Empfang von E-Rechnungen der E-Mail-Import kommt (4.10); die externe Sicherheitsprüfung vor dem ersten Release mit Kanzlei-Connector (2); Kunden im Ausland mit Lieferungen in die EU, Prüfung der USt-IdNr. und Ausfuhr (3.1)
- **Phase 4:** Teilprojekte, Aufmaß mobil mit Übernahme in Kalkulation und Rechnung, Baubesprechungsprotokolle (4.1); Angebote mit Alternativ-, Eventual-, Bedarfs- und optionalen Positionen, GAEB-Import und -Export, der Mengenabgleich angeboten, geliefert, abgerechnet (1.4, 4.2); Kundenpreise, Rabattgruppen, Staffelpreise und Preislisten (3.1, 4.1); die Stundensätze der Mitarbeiter (4.9); Sicherheitseinbehalt und Bürgschaften, Mängelanzeige an Lieferanten und Subunternehmer (4.2, 4.11); der Verbraucherbauvertrag nach §650i BGB mit Baubeschreibung (4.2) ⚖; Einkauf mit IDS-Connect und UGL (4.5, 4.7, 6); die Wetter-API für Bautagebuch und Plantafel (6); die Rolle Bauleiter (2); die Teilrechnung für getrennt abgenommene Bauabschnitte (4.2)
- **Phase 5:** Abnahmeprotokolle digital unterschreiben, eigene Anlagen mit den nächsten Prüf- und Wartungsterminen, Dokumente zum Herunterladen, die loginfreie Kundenseite hinter dem QR-Etikett, die Belehrungen zu den Belegen und die Widerrufsfunktion nach §356a BGB (3.2, 3.6) ⚖; Zahlungsdienstleister für Kunden (6); der Kunde im Portal als Rolle (2)
- **Phase 6:** Dashboard, CRM-Auswertungen und lesender SQL-Zugang (3.8, 4.12); Jahresabschluss-Unterstützung (4.8); die globale Volltextsuche mit Volltextindex und OCR (2, 4.10); E-Mail-Verknüpfung über IMAP (3.4); Serienmails und Jubiläen (3.7); Fahrtroutenvorschlag (4.3); die offene REST-API mit Webhooks für Drittanbieter als eigener Vertrag (2, 6); die Anmeldung über einen eigenen Identitätsanbieter (OIDC) und S3 als Dateispeicher (2); Gewerke-Pakete, die beim Start registriert und je Betrieb aktiviert werden (5.2, ADR 0008)

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
- **Mehrsprachigkeit**: Deutsch zuerst; Übersetzungen und die i18n-Struktur dafür erst, wenn eine zweite Sprache gebraucht wird. Oberfläche, Belege, Belehrungen und Rechtstexte gelten ohnehin nur für Deutschland, und eine Struktur ohne zweite Sprache pflegt niemand
- **Native Apps**: Phase 2 der Plattform-Strategie

---

## Änderungsprotokoll v2.20 → v2.21

- Neu: Die Pflichtangaben auf Geschäftsbriefen (2, 7) ⚖. Eine E-Mail an einen bestimmten Empfänger ist ein Geschäftsbrief, und ein eingetragener Betrieb nennt darauf je nach Rechtsform Registergericht, Registernummer, Sitz und seine Geschäftsführer oder seinen Vorstand. Der Briefkopf hielt diese Angaben, und die Fußzeile der Belege druckte sie, der Platzhalter {briefkopf} in der Signatur ließ sie weg (#278). Er trägt sie jetzt mit, dazu die USt-IdNr., die keine Pflicht ist und auf den Belegen ebenfalls steht. Entschieden von Moritz am 26.09.2026: Eine Signatur ohne {briefkopf} trägt die Angaben nicht, ohne Hinweis und ohne dass OpenGewerk sie von selbst anhängt, und als Sitz gilt der Ort der Anschrift, ein eigenes Feld dafür gibt es nicht

## Änderungsprotokoll v2.19 → v2.20

- Präzisiert: Eine Notiz der Baustelle ist ein eigener Eintrag am Auftrag, mit Person und Uhrzeit, und nicht die Beschreibung des Auftrags (4.1). Gebaut war "Notiz schreiben" seit #128 als Änderung der Beschreibung: wer auf der Baustelle eine Notiz schrieb, ersetzte damit, was das Büro als Auftrag hinterlegt hatte, und im Büro stand danach die Notiz als Beschreibung (#220). Eine Notiz wird nach dem Schreiben nicht mehr geändert; eine falsche folgt eine neue

## Änderungsprotokoll v2.18 → v2.19

- Präzisiert: Eine Formulardefinition ist JSON in einem eigenen Format und kein JSON Schema (1.3). JSON Schema beschreibt die Form von Daten; ein Formular braucht Beschriftung, Einheit, den Grenzwert mit seiner Regel, die Wiederholung je Stromkreis und die Unterschrift, die festschreibt. Umgesetzt mit #78, Nachtrag in ADR 0004
- Neu: Was ein Prüfprotokoll aus dem letzten der Anlage übernimmt (1.3). #79 verlangt, dass das letzte Protokoll bei der nächsten Prüfung die Vorlage ist; übernähme sie alles außer den Messwerten, stünden Besichtigung und Ergebnis der letzten Prüfung schon im neuen Protokoll, bevor jemand hingesehen hat

## Änderungsprotokoll v2.17 → v2.18

Alle Punkte dieser Fassung hat Moritz am 24.09.2026 entschieden, auf offene Fragen aus der Prüfung von Phase 0.

- Präzisiert: Der Regiebericht ist ein Beleg und kein Formular (1.3, 4.2). Gebaut war er so seit #73, mit Positionen, Unterschrift, Festschreibung und der Rechnung daraus, und 1.3 zählte ihn weiter zu den Formularen, die #78 bauen sollte. Über die Formular-Engine bekommt er Felder, die der Betrieb ihm gibt (#137)
- Präzisiert: Formulare und Grenzwerte von Elektro/PV liegen im Paketformat nach ADR 0008, die Anlagenstruktur bleibt Datenmodell-Kern (1.3); Nachtrag in ADR 0008 (#136)
- Neu: Die Schlussrechnung zieht die vereinnahmten Abschläge ab (4.2). Sie zog ab, was gestellt wurde; ist ein Abschlag offen, war sie um genau diesen Betrag zu niedrig, und nach der Schlussrechnung lässt er sich nicht mehr gesondert fordern. Bis die Offene-Posten-Verwaltung in Phase 3 die Zahlungen kennt, wird je Abschlagsrechnung eingetragen, was eingegangen ist (#31, Befund 1 der Vorprüfung vom 22.09.2026; umgesetzt mit #189). Dazu heißt sie nur noch „Schlussrechnung“, wenn sie Abschläge abzieht (#132)
- Neu: Die Sammelrechnung über die Regieberichte eines Auftrags in Phase 1 (1.4, 4.2), weil der Pilotbetrieb Regiearbeit über mehrere Tage mit einer Rechnung abrechnet; die Teilrechnung für getrennt abgenommene Bauabschnitte in Phase 4 (#135)
- Neu: Der Folgeauftrag zu einem abgeschlossenen Auftrag (4.1, Phase 1, #170), die Auftragsnummer aus einem eigenen Nummernkreis (1.5, 4.1, Phase 1, #145) und das Land an Kunde und Objekt (3.1, 3.2, Phase 1, #144)
- Neu: Die Zuordnung der Monteure zu Aufträgen und die Auswahl je Gerät (1.6, 4.1, Phase 1). ADR 0005 sah von Anfang an nur die Daten des Geräts vor, gebaut war der ganze Betrieb auf jedem Telefon (#140). Auf der Baustelle schließt der Monteur seinen Auftrag ab und schreibt Notizen daran, ohne Kunde, Objekt und Bezeichnung ändern zu können (#128)
- Neu: Der Hinweis nach §271a BGB bei einem Zahlungsziel über 60 Tagen gegenüber einem Unternehmen (4.2, Phase 1, #149)
- Neu: Releases mit fertigen, signierten Abbildern (2, Phase 1, #155); bis dahin baut ein Update aus dem Quelltext
- Neu in Abschnitt 2, weil sie bisher nur in ADRs standen und damit in keiner Phase (#141): Passkeys, die als zweiter Faktor zählen (Phase 2, #167), die Anmeldung über OIDC und S3 als Dateispeicher (Phase 6), die externe Sicherheitsprüfung (Phase 3), der Virenscan in 4.10 (Phase 3) und die Einsicht ins Audit-Log im Büro (Phase 2)
- Neu: Der Bereich für den Betreiber der Instanz und ein weiterer Betrieb, vom Inhaber im Büro angelegt (2, Phase 2, #142, #188). Ein Mailserver im eigenen Netz und die Uhrzeit der Sicherung sind Einstellungen der Instanz und keines Betriebs; bis dahin bleiben sie in der `.env` und fest auf 02:30
- Neu: Die vereinbarte Arbeitszeit in der Mitarbeiterakte und die Überstunden daraus als Zeitkonto in Phase 2 (4.9); ausgezahlt oder übertragen werden sie mit dem Lohnexport in Phase 3 (#141)
- Präzisiert: Die i18n-Struktur kommt erst mit einer zweiten Sprache, nicht „von Anfang an“ (12, #143)

## Änderungsprotokoll v2.16 → v2.17

- Präzisiert: Die Sicherung läuft jede Nacht ohne Zutun, und das Büro sieht, wann die letzte fertig wurde, mit einer Warnung nach zwei Tagen (2). Leitentscheidung 6 macht Backup/Restore zum Teil des Produkts; eine Sicherung, die nur auf Zuruf läuft, fehlt genau an dem Tag, an dem sie gebraucht wird. Umgesetzt mit #130

## Änderungsprotokoll v2.15 → v2.16

- Neu: Der Nullsteuersatz für Photovoltaik nach §12 Abs. 3 UStG in 1.7, 4.2, der Rechtsübersicht (7) und in Phase 1 (10). Seit dem 01.01.2023 gilt 0 % für die Lieferung und Installation von Solarmodulen, wesentlichen Komponenten und Speichern an den Betreiber einer Anlage auf oder bei Wohnungen. Die Gliederung kannte nur 19 und 7 %, und der Pilotbetrieb baut PV-Anlagen: jede solche Rechnung an einen privaten Haushalt wäre mit 19 % entstanden. Umgesetzt mit #127

## Änderungsprotokoll v2.14 → v2.15

- Präzisiert: Die Dokumentenkette verzweigt sich nicht (1.4). Aus einem Beleg ließen sich beliebig viele Folgebelege anlegen, und eine Schlussrechnung aus dem Angebot neben einer Abschlagsrechnung aus demselben Angebot zog nichts von ihr ab, weil die Abzüge nur der eigenen Kette nach oben folgen. Ein Beleg hat jetzt höchstens einen Folgebeleg, der gilt, und der nächste entsteht aus dem letzten Glied. Umgesetzt mit #129

## Änderungsprotokoll v2.13 → v2.14

- Präzisiert: Die Leitung eines Stromkreises nennt neben Typ, Querschnitt, Länge und Verlegeart die Aderzahl (3.2). Ohne sie steht im Stromkreisverzeichnis „NYM-J 2,5 mm²“, wo „NYM-J 3 × 2,5 mm²“ gemeint ist, und das Prüfprotokoll unterscheidet damit Wechsel- von Drehstromkreisen
- Präzisiert: Das Stromkreisverzeichnis ist ein Blatt je Verteiler, denn jeder Verteiler hat seine eigene Tür (3.2, 5.1). Umgesetzt mit #70

## Änderungsprotokoll v2.12 → v2.13

- Präzisiert: Zu einem Angebot an einen Verbraucher gehören Widerrufsbelehrung, Muster-Widerrufsformular und die Hinweise zum Erlöschen des Widerrufsrechts zwingend (4.2). Nimmt der Kunde das Angebot an, ist das seine Vertragserklärung, und die Belehrung muss vorher bei ihm sein (Art. 246a §4 Abs. 1 EGBGB). Am Beleg lassen sich die drei deshalb nicht abschalten, unter „Einstellungen“ nicht vom Angebot lösen, und sie gehen mit ihm hinaus. Der Vordruck für den vorzeitigen Beginn bleibt freiwillig, er wird nur gebraucht, wenn der Kunde das will
- Präzisiert: Einem Kostenvoranschlag wird keine Belehrung vorgeschlagen, bis v2.12 waren es dieselben wie für das Angebot. Am einzelnen Beleg lässt sie sich weiterhin von Hand dazunehmen
- Neu: Die Hinweise, wann kein Widerrufsrecht besteht und unter welchen Umständen es vorzeitig erlischt (Art. 246a §1 Abs. 3 EGBGB), als vierte mitgelieferte Belehrung. Das Gesetz hat dafür kein Muster; ihr Wortlaut und der neue des Vordrucks kommen aus der Widerrufsbelehrung eines Handwerksbetriebs. Berichtigt ist er, wo er vom Gesetz abwich: an der Nummerierung von §356 BGB, die sich am 19.06.2026 geändert hat, an der Bestätigung, die der Kunde für das Erlöschen abgeben muss, und um den Fall der Reparatur auf Anforderung des Kunden (§356 Abs. 5 Nr. 3 BGB). Beides steht mit den Mustern zur fachkundigen Prüfung

## Änderungsprotokoll v2.11 → v2.12

- Präzisiert: Eine Belehrung, die mit dem Beleg hinausgeht, steht im PDF nach dem Beleg, jede auf einer eigenen Seite; das PDF ist dasselbe auf Papier, in der E-Mail und im Archiv, so kann keine vergessen werden. Eine, die nicht mit hinausgeht, liegt am Beleg als eigenes Blatt bereit. Das ist der Fall des Vordrucks für den Beginn vor Ablauf der Widerrufsfrist, der nur gebraucht wird, wenn der Kunde das will, und unterschrieben zurückkommt (4.2). Umgesetzt mit #109

## Änderungsprotokoll v2.10 → v2.11

- Erweitert: Aus der Widerrufsbelehrung als Angebotsanhang werden Belehrungen, die der Betrieb pflegt (4.2). Mitgeliefert ist die Muster-Widerrufsbelehrung mit dem Muster-Widerrufsformular, als Fassung mit Gültigkeitszeitraum wie ein Regelpaket; eigene Belehrungen lassen sich anlegen und vorhandene ändern und erweitern, wobei ein geändertes Muster die gesetzliche Absicherung verliert. Je Belehrung ist einstellbar, ob sie mit der E-Mail des Belegs hinausgeht. Sie wird mit dem Beleg eingefroren und ist später im Kundenportal abrufbar (3.6)
- Neu: Die Widerrufsfunktion nach §356a BGB für Verträge, die über eine Online-Oberfläche geschlossen werden, im Kundenportal (3.6), in der Rechtsübersicht (7) und in Phase 5. Die Vorschrift verlangt eine ständig erreichbare Schaltfläche „Vertrag widerrufen“; die Annahme eines Angebots im Portal ist genau so ein Vertrag
- Präzisiert: Der Verbraucherbauvertrag hat ein eigenes Widerrufsrecht mit eigener Belehrung (§650l BGB, Art. 249 §3 EGBGB) und bleibt in Phase 4; die Zeile zu §312g in der Rechtsübersicht nennt jetzt auch den Fernabsatz

## Änderungsprotokoll v2.9 → v2.10

- Präzisiert: Abschnitt 10 ordnet jetzt jeden Punkt der Abschnitte 1 bis 9 einer Phase zu, in der Tabelle als Schwerpunkt oder in der Zuordnung im Einzelnen darunter. Bisher stand ein großer Teil in keiner Phase, darunter rechtlich erforderliche Punkte: Widerrufsbelehrung, Abnahme mit Gewährleistung, DSGVO-Funktionen, Verfahrensdokumentation und Datenzugriff für die Betriebsprüfung. Die Zeile von Phase 3 war außerdem unvollständig: die Issues der Zeiterfassung und der Dokumentenablage verwiesen Lohnexport und Verfahrensdokumentation schon dorthin, die Zeile nannte beides nicht
- Neu in Phase 1: die Widerrufsbelehrung nach §312g BGB, weil der Pilotbetrieb Angebote an Verbraucher bei ihnen zu Hause schreibt; dazu das bereits gebaute Zahlungsziel
- Neu: die Regel, dass ein neuer Punkt in den Abschnitten 1 bis 9 im selben Zug seine Phase in Abschnitt 10 bekommt, und ein Hinweis darauf in der Legende

## Änderungsprotokoll v2.8 → v2.9

- Neu: Das Zahlungsziel in Abschnitt 4.2. Der Betrieb stellt es einmal ein, als Mandanteneinstellung mit Gültigkeitszeitraum wie die steuerlichen, und jeder Beleg liest das seines eigenen Datums; ein einzelner Beleg kann ein eigenes haben, und die Belege, die aus ihm entstehen, übernehmen es. Die Rechnung macht daraus ein Fälligkeitsdatum, das mit ihr eingefroren wird und das die Fristen-Engine und das Mahnwesen später lesen
- Präzisiert: Die Zahlungsbedingungen je Kunde aus 3.1 und das Skonto aus 4.2 standen bisher in keiner Phase des Fahrplans. Sie gehören zu Phase 3, weil beide am Zahlungseingang hängen, und stehen dort jetzt in Abschnitt 10; das Zahlungsziel je Kunde setzt sich dann zwischen das des Betriebs und das eines Belegs

## Änderungsprotokoll v2.7 → v2.8

- Präzisiert: Das Benachrichtigungssystem in Abschnitt 2 verschickt über den Mailserver des Betriebs, nicht über einen der Instanz. Jeder Betrieb richtet ihn in seinen E-Mail-Einstellungen ein, mit eigenem Postfach und eigener Anmeldung; die Einstellungen stehen hinter einem eigenen Recht, weil die Anmeldung an einem Postfach das Schreiben im Namen des Betriebs erlaubt. Das Passwort liegt verschlüsselt und wird nie wieder angezeigt, Speichern prüft die Verbindung. Unter jeder Nachricht steht eine Signatur des Betriebs; der Platzhalter {benutzer} setzt den Namen dessen ein, der die Nachricht verschickt, und fällt bei automatischen Nachrichten weg

## Änderungsprotokoll v2.6 → v2.7

- Neu: Besteuerung nach vereinnahmten Entgelten (§20 UStG) in 1.7, 4.2, 4.8 und der Rechtsübersicht. Die Ist-Versteuerung ist eine Mandanteneinstellung mit Gültigkeitszeitraum wie die Kleinunternehmerregelung, die Umsatzgrenze steht in der Regel-Engine. Ab 2028 verlangt §14 Abs. 4 Satz 1 Nr. 6a UStG die Angabe „Versteuerung nach vereinnahmten Entgelten“ auf der Rechnung, weil der Kunde die Vorsteuer aus ihr erst nach der Zahlung abziehen darf; die USt-Voranmeldung der Buchhaltung rechnet je nach Einstellung nach vereinbarten oder vereinnahmten Entgelten

## Änderungsprotokoll v2.5 → v2.6

- Korrigiert: Der Kostenanschlag steht seit der Reform des Bauvertragsrechts zum 01.01.2018 in §649 BGB. §650 BGB regelt heute den Werklieferungsvertrag; die Fundstelle in 4.2 und in der Rechtsübersicht nannte noch die alte Nummer

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
