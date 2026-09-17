# OpenGewerk

**Self-hosted CRM & ERP für Handwerksbetriebe**

## Was ist OpenGewerk?

OpenGewerk führt CRM und ERP in einem einzigen Datenmodell zusammen: Kunde, Objekt, Anlage, Auftrag, Beleg, Buchung. Es gibt keine Duplikate und keine Schnittstellen zwischen Modulen, weil es keine getrennten Module gibt. Kernmodul ist Elektro und PV, alle weiteren Gewerke entstehen als Plugins auf derselben Formular- und Fristen-Engine. Die Baustellen-App arbeitet offline-first, denn im Keller, am Zählerschrank und auf dem Dachboden liegt kein Netz. GoBD ist Bauprinzip statt Nachrüstung: Belege werden festgeschrieben und nie gelöscht, sondern storniert. Die Buchhaltung wächst gestaffelt von Belegen über das Journal bis zu EÜR, USt-Voranmeldung, Anlagenbuchhaltung und Bilanz, und KI-Funktionen bleiben optional über selbst gehostete Modelle.

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

Die vollständige Tabelle steht in [`docs/konzept/Feature-Gliederung.md`](docs/konzept/Feature-Gliederung.md), Abschnitt 11.

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

OpenGewerk ist in der **Planungsphase**. Es gibt noch keinen lauffähigen Code, nur das ausgearbeitete Konzept und dieses Repository-Gerüst.

Das vollständige Konzept liegt unter [`docs/konzept/`](docs/konzept/). Wer mitreden will, fängt am besten dort an. Architekturentscheidungen werden unter [`docs/adr/`](docs/adr/) festgehalten.

## Roadmap

| Phase | Inhalt | Ergebnis |
| --- | --- | --- |
| 0: Fundament | Datenmodell-Kern, Mandanten, Rechte, Fristen-Engine, Formular-Engine, Nummernkreise/Festschreibung, Offline-Sync, Betrieb (Docker, Backup, Update) | Lauffähiges Gerüst ohne Fachlogik |
| 1: Operativer Kern | Kunden/Objekte/Anlagen, Angebot → AB → Regiebericht → Rechnung (inkl. Storno, Abschläge kumuliert), Zeiterfassung, Plantafel, Serviceaufträge, E-Rechnung aus- und eingehend | Betrieb kann damit arbeiten |
| 2: Elektro/PV-Kernmodul | Prüfprotokolle, Messgeräte-Import, PV-Dokumentation, Wartungsverträge, Anlagenakte mit QR | Alleinstellungsmerkmal |
| 3: Finance | Journal, OP/Mahnwesen, Bank, EÜR/USt-VA, DATEV, Steuerberater-Rolle, Kanzlei-Connector (`opengewerk-api-spec` v1, Einladung/Scopes, Read-Endpunkte, Zugriffslog) | Buchhaltung ersetzt sevdesk/Lexware; Kanzlei-Hub kann anbinden |
| 3b: Kanzlei-Zusammenarbeit | Webhooks, Rückfragen-Postfach, Vorschlags-Freigabe, Kontenrahmen-Profile | Monatsabschluss läuft ohne E-Mail/Telefon |
| 4: Projekt-Tiefe | Bautagebuch, Kalkulation/Nachkalkulation, Nachträge, Subunternehmer, Material/Lager/Einkauf, Fuhrpark | Baustellenbetriebe |
| 5: Kundenportal | Angebote, Rechnungen, Zahlung, Termine, Störungsmeldung, Hilfeseite | Selbstbedienung |
| 6: Bilanz & Erweiterung | Anlagenbuchhaltung, Bilanz/GuV, Report-Builder, Anlagen-Monitoring, Plugin-Gewerke, lokale KI | Vollausbau |

## Projektfamilie

- [`opengewerk`](https://github.com/opengewerk/opengewerk): diese Handwerkersoftware, das CRM und ERP für den Betrieb.
- [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei): der Kanzlei-Hub, mit dem ein Steuerberater alle seine OpenGewerk-Mandanten aus einer Anwendung heraus bearbeitet, ohne dass die Daten den Betrieb verlassen.
- [`opengewerk-api-spec`](https://github.com/opengewerk/opengewerk-api-spec): der gemeinsame API-Vertrag zwischen beiden, versioniert nach SemVer, damit Hub und Handwerkersoftware unabhängig releasen können.

## Mitmachen

Das Projekt steht noch am Anfang, gerade jetzt zählt jede fachliche Rückmeldung aus dem Betriebsalltag mehr als Code.

- Fragen, Ideen und alles ohne konkreten Vorschlag gehören in die [Discussions](https://github.com/opengewerk/opengewerk/discussions).
- Konkrete Fehler und Wünsche laufen über die [Issue-Vorlagen](https://github.com/opengewerk/opengewerk/issues/new/choose).
- Die Beitragsregeln stehen in [CONTRIBUTING.md](https://github.com/opengewerk/.github/blob/main/CONTRIBUTING.md), der Verhaltenskodex in [CODE_OF_CONDUCT.md](https://github.com/opengewerk/.github/blob/main/CODE_OF_CONDUCT.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer OpenGewerk als Dienst für andere betreibt, gibt seine Änderungen zurück.
