# Funktionsumfang und Stand

Was OpenGewerk können soll, wie weit es ist und wie es weitergeht. Verbindlich für den Funktionsumfang ist das [Konzept](konzept/), hier steht die Übersicht.

## Warum OpenGewerk?

Die wichtigsten Punkte aus dem Vergleich mit openHandwerk, plancraft, HERO, TAIFUN/STREIT, sevdesk/Lexware und Odoo/SAP FSM/Dynamics:

| Schwäche in Vergleichssystemen | Unser Ansatz |
| --- | --- |
| plancraft: keine vollständige Buchhaltung (EÜR/USt-VA fehlen, nur DATEV-Export) | Volles Finance-Modul mit eigenem Journal, EÜR/USt-VA/Bilanz, gestaffelt ausgebaut |
| GAEB und Stammdaten nur in höheren Tarifen (openHandwerk, plancraft) | Alle Schnittstellen und Funktionen ohne Feature-Gates |
| Laufende Nutzer-/Monatskosten (z. B. 25-75 €/Nutzer/Monat) | Self-hosted, einmaliger Aufwand |
| Daten beim Drittanbieter | Volle Datenkontrolle, Mandantenfähigkeit |
| Generischer Gewerke-Fokus, keine Elektro/PV-Tiefe | Elektro/PV als Kernmodul mit Messgeräte-Import, Anlagenakte, PV-Doku |
| Steuerberater nur per Export oder Einzel-Login angebunden | Read-only-Rolle als Fallback; Kanzlei-Connector mit Scopes, Rückfragen und Vorschlags-Freigabe, Kanzlei-Hub bündelt alle Mandanten |

Die vollständige Tabelle steht in [`docs/konzept/Feature-Gliederung.md`](konzept/Feature-Gliederung.md), Abschnitt 11.

## Funktionsumfang (geplant)

| Bereich | Inhalt |
| --- | --- |
| Architektur-Bausteine | Datenmodell-Kern, Fristen-Engine, Formular-/Protokoll-Engine, Dokumentenkette, Nummernkreise mit Festschreibung, Offline-Sync |
| CRM | Kunden mit steuerlichen Attributen, Objekt- und Anlagenakte mit QR-Etikett, Vertriebspipeline, Kommunikationshistorie, Wartungsverträge, Kundenportal |
| Belegwesen | Kostenvoranschlag, Angebot, Auftragsbestätigung, Lieferschein, Regiebericht, kumulierte Abschlagsrechnung, Schlussrechnung, Storno und Gutschrift, E-Rechnung ein- und ausgehend |
| Termin und Zeit | Plantafel mit Drag & Drop, Serientermine, Rufbereitschaftsplan, mobile Zeiterfassung mit ArbZG- und MiLoG-Prüfung |
| Material und Fuhrpark | Artikelstamm, Lager und Fahrzeuglager, DATANORM- und IDS-Connect-Anbindung, Fahrzeuge, Werkzeuge, Kalibrier- und Prüffristen |
| Finance | Journal in doppelter Buchführung, offene Posten und Mahnwesen, Bankanbindung, EÜR und USt-Voranmeldung, Anlagenbuchhaltung, Bilanz und GuV, DATEV-Export, Z1 bis Z3 für die Betriebsprüfung |
| Elektro und PV | Prüfprotokolle (E-Check, VDE 0100-600, VDE 0105-100, DGUV V3, VDE-AR-N 4105), Messgeräte-Import, Stromkreisverzeichnis, PV-Dokumentation, Anlagen-Monitoring als Servicetrigger |
| Kanzlei-Anbindung | Einstellungsseite Steuerberater mit Einladungscode und Scopes, Zugriffslog, API nach `opengewerk-api-spec`, Webhooks, Rückfragen-Postfach, Vorschlags-Freigabe |

## Status

**Phase 0**, das Fundament, ist gebaut: Datenmodell, Mandantentrennung über Row-Level Security, Rollen und Rechte, Nummernkreise mit Festschreibung, Audit-Log mit Hashkette, Offline-Datenschicht, Regel-Engine und der Betrieb über Docker Compose mit Sicherung, Rückspielen und Update-Pfad.

**Phase 1**, das MVP für den Pilotbetrieb, ist gebaut; die neueste Fassung ist [0.6.1](https://github.com/opengewerk/opengewerk/releases). Vor dem produktiven Einsatz stehen noch die fachliche Abnahme der Regelpakete und Grenzwerte (#31) und ein Praxistest der E-Rechnung bei einem echten Empfänger (#133). Eine Installation startet mit `sh docker/start.sh`, aus einem Release-Paket mit signierten Abbildern oder aus dem Quelltext, wird im Browser mit dem Einrichtungscode aus `docker/.env` eingerichtet und sichert sich jede Nacht selbst. Stand 27.09.2026 gibt es:

- **Büro und Baustelle aus einer Anwendung**, die Baustelle ohne Netz: Anmeldung mit zweitem Faktor und Wiederherstellungscodes, weitere Zugänge per Einladungslink, die Rollen Inhaber, Büro und Monteur. Das Gerät eines Monteurs hält nur die Aufträge, auf denen er eingeteilt ist, und was auf ihm entsteht, geht beim nächsten Abgleich hinaus, auch nach einem ganzen Tag ohne Netz.
- **Kunden, Objekte, Anlagen und Aufträge**: Kunden mit Land und Ansprechpartnern, Aufträge mit eigener Nummer, Folgeaufträgen und Notizen von der Baustelle, Aufgaben mit Erinnerung per E-Mail, eine Dokumentenablage mit Fotos von der Baustelle.
- **Belege**: Angebot, Kostenvoranschlag und Auftragsbestätigung mit Titeln, Texten und Textbausteinen. Der Regiebericht, auf der Baustelle geschrieben, mit Feldern, die der Betrieb ihm gibt, und vom Kunden auf dem Gerät unterschrieben. Rechnungen mit kumulierten Abschlägen, einer Schlussrechnung, die abzieht, was eingegangen ist, der Sammelrechnung über die Regieberichte eines Auftrags und Storno. Jeder Beleg wird festgeschrieben, mit Zeitpunkt und Person, als PDF mit dem Briefkopf des Betriebs gedruckt und auf Wunsch direkt per E-Mail verschickt, an ein Unternehmen als E-Rechnung, als XRechnung oder ZUGFeRD-PDF.
- **Recht und Steuern**: die Pflichtangaben nach § 14 UStG vor dem Festschreiben, Kleinunternehmerregelung, Ist-Versteuerung, der Nullsteuersatz für Photovoltaik, das Zahlungsziel mit dem Hinweis nach § 271a BGB, an jedem Angebot an einen Verbraucher Widerrufsbelehrung, Formular und Hinweise zum Erlöschen, bei einer Lieferung von Waren dazu die harmonisierte Mitteilung zur gesetzlichen Gewährleistung, und unter jeder E-Mail die Pflichtangaben auf Geschäftsbriefen. Die Regelpakete warten auf die fachkundige Abnahme in #31.
- **Zeiterfassung** auf der Baustelle, mit der Aufbewahrung nach § 17 MiLoG und Warnungen nach dem Arbeitszeitgesetz.
- **Elektro**: die Struktur einer Anlage mit Verteilern, Feldern, Stromkreisen und Betriebsmitteln, das Stromkreisverzeichnis für die Verteilertür als PDF und das Prüfprotokoll der Erstprüfung nach DIN VDE 0100-600 über die Formular-Engine, je Stromkreis gemessen, mit Grenzwerten und Fundstellen und vom Prüfer auf dem Gerät unterschrieben.
- **Eine Oberfläche nach den Vorlagen im Canvas**: zuerst hell, dunkel als Wahl je Gerät; im Büro Kopfzeile und Navigation, am Telefon hinter "Menü"; auf der Baustelle Reiter unten, ein Menü von unten und auf dem Tablet eine Leiste links. Jeder Bildschirm folgt seiner Tafel, mit eigenen Listen für Kunden, Objekte, Anlagen, Aufträge und Belege, und auf dem Tablet quer stehen Aufträge und Auftrag nebeneinander. Keine Seite ist breiter als ihr Fenster, von 320 bis 3840 Pixel, das prüft die CI bei jedem Pull Request. Was sich nicht zurücknehmen lässt, fragt vorher nach.
- **Einstellungen im Büro** statt in der `.env`: Briefkopf mit dem Namen des Betriebs, Steuern, Nummernkreise, Zahlungsziel, Fristen, Belehrungen, Felder des Regieberichts, Mailserver, Zugänge und die letzte Sicherung.

**Phase 2**, der Kern für Elektro und PV, wird seit dem 27.09.2026 gebaut, Issue für Issue im [Meilenstein Phase 2](https://github.com/opengewerk/opengewerk/milestone/3). Mit 0.5.0 erschienen sind die Fristen-Engine (#283) mit ihrer ersten Art, der Wiedervorlage eines Angebots, dem niemand geantwortet hat, Push-Nachrichten auf die Geräte der Leute im Betrieb (#284), das Änderungsprotokoll für den Inhaber im Büro (#285), ein Bereich für die Betreiber der Instanz (#188) mit weiteren Betrieben auf einer Instanz (#142) und dem Wechsel zwischen ihnen ohne neue Anmeldung (#242), Passkeys (#167), Tags an Kunden und Objekten (#314), der Zugang zum Objekt (#286), dessen Werte seit #447 jeder ohne Netz auf dem Gerät hat, der einem offenen Auftrag dort zugeordnet ist, die PV-Struktur unter einer PV-Anlage (#300), das QR-Etikett je Anlage (#308), Artikel und Lieferanten (#296) mit Preisen ab einem Tag, in Positionen und in den Regiebericht zu übernehmen, und die Preiseinheit an Positionen und Artikelpreisen (#456), damit ein Preis je 100 Stück so ankommt, wie der Großhandel ihn auszeichnet. 0.6.0 bringt vor allem die Korrekturen aus der Sicherheitsprüfung von OpenGewerk Haustechnik, soweit sie das gemeinsame Fundament betreffen, und die Bausteine, die das Fundament seitdem für die Haustechnik bekam. 0.6.1 schließt vier weitere Lücken aus dem zweiten Teil dieser Prüfung.

Wie das im Einzelnen gebaut ist, steht in der [Entwicklung](entwicklung.md). Was noch fehlt, steht in den Meilensteinen, für Phase 1 im [Meilenstein Phase 1](https://github.com/opengewerk/opengewerk/milestone/2) und für Phase 2 im [Meilenstein Phase 2](https://github.com/opengewerk/opengewerk/milestone/3), die Reihenfolge im Fahrplan in Abschnitt 10 der Feature-Gliederung.

Das vollständige Konzept liegt unter [`docs/konzept/`](konzept/). Wer mitreden will, fängt am besten dort an. Architekturentscheidungen werden unter [`docs/adr/`](adr/) festgehalten.

## Roadmap

Der Fahrplan steht in Abschnitt 10 der
[Feature-Gliederung](konzept/Feature-Gliederung.md) und bewusst nur dort.
An dieser Stelle stand bis zum 19.09.2026 eine Abschrift, die beim Umschnitt auf
den MVP-Fahrplan nicht mitgezogen wurde und am Ende zwei Bausteine in Phase 0
nannte, die dort nicht hingehören. Eine Kopie driftet, also gibt es keine mehr.

Leitgedanke ist, so früh wie möglich einen echten Betrieb damit abzuwickeln.
Pilotkunde ist der Elektro- und PV-Betrieb des Maintainers; Version 1 ist
erreicht, wenn dessen Aufträge vollständig in OpenGewerk laufen, von der Anfrage
bis zur bezahlten Rechnung. Was dafür nicht nötig ist, kommt später. Ausgenommen
ist, was sich nicht nachrüsten lässt: Datenmodell, Offline-Datenschicht,
Festschreibung und Mandantentrennung gehören ins Fundament, auch wenn die
Oberfläche dafür erst danach kommt.

Phase 0 (Fundament) und Phase 1, das MVP für den Pilotbetrieb, sind gebaut, an
Phase 2, dem Kern für Elektro und PV, wird gearbeitet. Was davon steht, sagt das
Kapitel Status oben, was noch offen ist, der
[Meilenstein Phase 2](https://github.com/opengewerk/opengewerk/milestone/3).
