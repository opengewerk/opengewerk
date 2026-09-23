# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [Semantischen Versionierung](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- Die Dokumentenablage (#77). Bis dahin gab es für Dateien ein Volume im Container und sonst
  nichts, und neben der Software lag weiter ein Ordner auf dem Dateiserver. Jetzt hängen Dateien
  an Kunde, Objekt, Anlage und Auftrag, im Büro unter "Dateien" und auf der Baustelle unter "Fotos
  und Dateien" mit "Foto aufnehmen"; eine neue Fassung legt sich über die alte, ohne sie zu
  verdrängen. Fotos werden auf dem Gerät auf 2048 Pixel verkleinert und bekommen eine Vorschau, das
  Original auf Wunsch; ohne Netz warten sie auf dem Gerät und gehen beim nächsten Abgleich hoch, die
  Datei vor der Fassung. Hochgeladen wird nach Hash (`PUT /files/:sha256`), ausgeliefert nur nach der
  Fassung und nur an den eigenen Betrieb, angezeigt nur, was an seinen ersten Bytes als Bild oder PDF
  erkannt ist. Neu sind Migration 0035, die Rechte `attachment.read` und `attachment.write` für alle
  Rollen, Version 2 der lokalen Ablage und `blob:` für Bilder in der Content-Security-Policy.
- Ansprechpartner an Kunde und Objekt (#121). Die Tabelle stand seit dem Datenmodell-Kern im
  Abgleich, eine Oberfläche dafür gab es nicht, und beim Schneiden von Phase 1 war für sie kein
  Issue entstanden. Im Büro stehen sie an der Kundenakte und am Objekt, lassen sich anlegen,
  ändern und entfernen; auf der Baustelle zeigt der Auftrag die des Kunden und die des Objekts
  getrennt, Telefon und E-Mail zum Antippen, und anlegen geht dort auch ohne Netz. Ändern und
  Entfernen laufen über die neue Route `/contacts`, die Verweise und die Regel "genau ein
  Elternteil" prüft wie der Abgleich. Auf dem Konfliktbildschirm heißt ein Ansprechpartner jetzt
  mit Vor- und Nachnamen statt "Ansprechpartner ohne Bezeichnung".
- Ein Konflikt an einem inzwischen festgeschriebenen Beleg lässt sich als neuer Entwurf anlegen
  (#139). Bis dahin blieben "Fassung vom Gerät übernehmen", was am festgeschriebenen Beleg ein
  zweites Mal scheitert, und "Stand im System behalten", und wer ohne Netz an einem Regiebericht
  weitergeschrieben hatte, den das Büro inzwischen festgeschrieben hatte, verlor seine Arbeit.
  Jetzt entsteht für denselben Kunden und Auftrag ein Entwurf, dessen Betreff den
  festgeschriebenen Beleg nennt: ein Nachtrag mit den neuen Positionen, wenn das Gerät nur
  welche angelegt hat, sonst der ganze Beleg, wie das Gerät ihn wollte. Alle Konflikte eines
  Belegs landen in einem Entwurf, so wie ADR 0005 es in Punkt 4 vorsieht.
- Die Instanz sichert sich jede Nacht selbst, und das Büro sieht, wann zuletzt (#130). Der neue
  Dienst `backup-schedule` startet mit ihr, sichert um 02:30 Uhr und holt eine versäumte Nacht
  nach, sobald der Rechner wieder läuft; eine Instanz ohne Betrieb sichert er nicht, damit sie
  nach einem Plattenverlust keine Sicherung mit Daten verdrängt. Jede Sicherung hält fest, wann
  sie fertig wurde, und die Anwendung liest nur diesen Eintrag: unter "Einstellungen",
  "Sicherung" und als Warnung oben im Büro, wenn die letzte älter als zwei Tage ist. Bis dahin
  lief eine Sicherung nur, wenn jemand daran dachte. Die README beschreibt `BACKUP_TARGET` auf
  einer anderen Maschine als Regelfall.
- Der Nullsteuersatz für Photovoltaik nach § 12 Abs. 3 UStG (#127). Seit dem 01.01.2023 gilt
  0 % auf Solarmodule, wesentliche Komponenten und Speicher samt Installation an den Betreiber
  einer Anlage auf oder bei Wohnungen; OpenGewerk kannte nur 19 und 7 %, und jede Rechnung über
  eine PV-Anlage an einen privaten Haushalt wäre mit 19 % entstanden. Der Satz steht als
  `vat.zero` ab 2023 im Regelpaket, ist je Position wählbar und nennt beim Wählen die
  Voraussetzungen, bildet eine eigene Steuergruppe mit der Fundstelle auf dem Beleg und geht als
  Kategorie `Z` in XRechnung und ZUGFeRD. Der neue Wert im Enum `vat_rate` kommt mit
  Migration 0034; ihre Rücknahme bricht ab, solange eine Position ihn trägt.
- Eine Erinnerung für Regelpakete, die ablaufen (#150). Der Basiszinssatz endet am
  31.12.2026, weil der nächste Wert erst zum Jahreswechsel feststeht, und danach rechnet die
  Engine keine Verzugszinsen mehr. Ein Paket, das so erneuert wird, sagt es jetzt selbst
  (`renewal`), und der Workflow "Regelpakete erneuern" öffnet jeden Montag, dreißig Tage vor
  einem solchen Ende, ein Issue mit dem, was zu tun ist; einmal, nicht jede Woche.
- Die Anlagenstruktur (#70): unter einer Anlage ihre Verteiler, darin Felder, Stromkreise
  und Betriebsmittel. Im Büro werden sie angelegt, geordnet, geändert und gelöscht, auf der
  Baustelle gelesen und ohne Netz ergänzt, etwa um den Stromkreis, der im Verteiler fehlt.
  Je Stromkreis stehen Verbraucher, Schutzeinrichtung mit Art, Charakteristik und
  Nennstrom, der RCD mit Typ und Bemessungsdifferenzstrom und die Leitung mit Typ,
  Aderzahl, Querschnitt, Länge und Verlegeart; `circuitProblems` aus `domain` prüft sie im
  Formular und im Abgleich mit denselben Sätzen. Die Tabellen gab es seit Phase 0, nur
  füllen ließen sie sich nicht. Sie sind das Gerüst, in dem das Prüfprotokoll nach
  VDE 0100-600 seine Messwerte je Stromkreis erfasst (Migration 0030)
- Das Stromkreisverzeichnis als PDF für die Verteilertür, im Querformat, ein Verteiler je
  Seite, mit dem Betrieb, der es führt, und dem Tag der letzten Änderung
  (`GET /installations/:id/circuit-chart`, mit `?board=` für einen Verteiler). Gedruckt wird
  bei jedem Abruf aus dem Stand des Servers, gespeichert wird es nicht, weil es anders als
  ein Beleg keinen Vorgang festhält

- Belehrungen an Belegen, zuerst die Widerrufsbelehrung nach § 312g BGB (#109). Mitgeliefert
  sind die Muster-Widerrufsbelehrung und das Muster-Widerrufsformular aus den Anlagen 1 und 2
  zu Art. 246a EGBGB, als Fassungen mit Gültigkeitszeitraum und Fundstelle wie ein
  Regelpaket, dazu ein Vordruck für den Beginn vor Ablauf der Widerrufsfrist. Der Inhaber
  pflegt sie unter "Einstellungen", "Belehrungen": eigene anlegen, die mitgelieferten ändern
  und das Original wiederherstellen; ein geändertes Muster ist gekennzeichnet, und der
  Bildschirm sagt, dass die Absicherung aus Art. 246a § 1 Abs. 2 Satz 2 EGBGB damit entfällt.
  Am Beleg werden sie nach Belegart und Kunde vorgeschlagen und je Beleg ein- und
  ausgeschaltet, mit der Wahl zwischen Arbeiten und einer Lieferung mit Montage. Was mit dem
  Beleg hinausgeht, steht im PDF nach dem Beleg und damit in der E-Mail, der Vordruck liegt
  als eigenes Blatt bereit. Eingefroren wird der Wortlaut mit dem Beleg, in Fassung 8 des
  eingefrorenen Stands, so wie das Kundenportal ihn später zeigt. Fehlt im Briefkopf eine
  Angabe, die eine Belehrung nennt, etwa die Telefonnummer, wird der Beleg nicht
  festgeschrieben: nur das zutreffend ausgefüllte Muster sichert die Widerrufsfrist
  (Migrationen 0027 und 0028)

- Das Zahlungsziel: der Inhaber stellt unter "Einstellungen" und dort "Zahlungsziel" ein,
  wie viele Tage ein Kunde zum Bezahlen hat, vorgegeben sind 14, gültig ab einem Tag wie
  die übrigen Einstellungen. Jeder Beleg kann in seinem Kopf ein eigenes haben, und ein
  Folgebeleg übernimmt es (Migration 0026). Angebot, Kostenvoranschlag und
  Auftragsbestätigung drucken die Tage, eine Rechnung den Tag, bis zu dem sie bezahlt sein
  soll; die E-Rechnung trägt beides (BT-20, BT-9). Eingefroren wird es mit dem Beleg, in
  Fassung 7 des eingefrorenen Stands, damit eine spätere Änderung keine Rechnung verschiebt,
  die schon draußen ist
- Die Nummernkreise im Büro: je Kreis das Muster und die nächste Nummer, mit einer Vorschau
  des nächsten Belegs beim Tippen. Ein neues Muster gilt ab dem nächsten Beleg, die nächste
  Nummer lässt sich nur erhöhen, etwa um die Zählung eines bisherigen Programms
  fortzusetzen. Ändern darf der Inhaber. Das Muster lag schon je Betrieb in der Datenbank,
  ließ sich aber nur per SQL ändern (`GET` und `PUT /settings/number-ranges`)
- Ein Eintrag "Einstellungen" im Büro, der Briefkopf, Steuern, Nummernkreise,
  E-Mail-Einstellungen und Zugänge an einer Stelle sammelt. Die Bildschirme liegen jetzt
  unter `/einstellungen/...`

- Ein Befehl zum Starten, beim ersten Mal wie bei jedem Update: `sh docker/start.sh`.
  Beim ersten Start legt er `docker/.env` an und erzeugt jedes Passwort und jeden
  Schlüssel darin selbst, in der Konsole stehen nur die Namen, nie die Werte; gefragt wird
  nur nach der Adresse der Instanz. Danach migriert er und startet in der Reihenfolge, die
  ein Update braucht. `docker/setup.sh` richtet nur die Datei ein
- Eine Instanz mit einem Platzhalter aus der Vorlage startet nicht mehr, sondern nennt die
  Variable und verweist auf das Skript. Vorher lief sie mit einem Datenbankpasswort, das
  jeder kennt, der die Vorlage gelesen hat

- E-Mail-Einstellungen im Büro: jeder Betrieb richtet seinen eigenen Mailserver ein, mit
  Server, Port, Verschlüsselung, Anmeldung und Absenderadresse, statt einen für die ganze
  Instanz in der `.env`. Sehen und ändern dürfen das nur die neuen Rechte `mail.read` und
  `mail.write`, anfangs nur der Inhaber. Speichern prüft die Verbindung und meldet, ob sie
  funktioniert; eine neue Verbindung, die der Server ablehnt, wird nicht gespeichert
  (Migration 0025)
- Das Passwort des Mailservers wird mit AES-256-GCM versiegelt, unter einem Schlüssel aus
  `SESSION_SECRET`, in der Tabelle `secrets`, die das Audit-Log nicht beobachtet. Keine
  Route gibt es zurück
- Eine eigene Signatur unter jeder E-Mail, mit den Platzhaltern `{benutzer}` für den
  Namen dessen, der verschickt, und `{briefkopf}` für den Briefkopf. Bei automatischen
  E-Mails fällt die Zeile mit `{benutzer}` weg

- Ein neuer Zugang lässt sich unter "Zugänge" per E-Mail einladen, statt den Link selbst
  weiterzugeben. Das Token entsteht erst beim Versand und steht nur in der Mail, weder im
  Postausgang noch im Audit-Log; scheitert ein Versuch, gilt nur der Link aus dem nächsten.
  Die offenen Einladungen zeigen, ob die E-Mail angekommen ist (Migration 0024)

- Ein Regiebericht, den der Kunde auf der Baustelle unterschreibt, geht auf Wunsch gleich
  danach per E-Mail an diesen Kunden, als PDF mit der Unterschrift. Ein- und ausgeschaltet
  wird das vom Inhaber auf dem neuen Bildschirm "E-Mail-Einstellungen", ab heute und nie
  rückwirkend (`report.mail_on_signature`, Migration 0023). Der Bildschirm sagt dem Büro
  auch, ob der Betrieb einen Mailserver hat und von welcher Adresse er verschickt
  (`GET /settings/mail`)
- Ein unterschriebener Regiebericht lässt sich über die Karte "Per E-Mail" auch vor seiner
  Nummer verschicken, etwa wenn beim Kunden erst später eine Adresse dazukommt

- Ein festgeschriebener Beleg geht aus dem Büro per E-Mail an den Kunden, mit der Datei, die
  zu ihm passt: ein Unternehmen im Inland bekommt das ZUGFeRD-PDF, alle anderen das PDF.
  Die Karte "Per E-Mail" am Beleg zeigt, was verschickt wurde und ob es ankam, und nimmt
  eine andere Adresse für eine einzelne Nachricht an. Verschicken darf, wer festschreiben
  darf. Fehlt einer E-Rechnung, die schon Pflicht ist, etwas, lehnt der Versand mit der
  Liste der Lücken ab (Migration 0022)
- Die Dateien eines festgeschriebenen Belegs, PDF, XRechnung und ZUGFeRD-PDF, entstehen für
  die Routen und für den Versand an einer Stelle (`DocumentFiles.issued`), damit Download
  und Mail dieselben Bytes tragen

- Versand von E-Mails über SMTP, über den Mailserver, den jeder Betrieb in seinen
  E-Mail-Einstellungen einrichtet. Ein Betrieb ohne Mailserver verschickt nichts, und für
  ihn wird auch nichts geschrieben
- Ein Postausgang für E-Mails (`mail_outbox`, Migration 0021): jede Nachricht wird erst
  geschrieben und dann von einem Job verschickt, der jede Minute läuft. Antwortet der
  Mailserver nicht, wartet sie und wird zwanzigmal über gut zwei Tage erneut versucht,
  denn ein Ausfall von zwei Stunden darf keine Nachricht kosten; gelöscht wird keine
- Eine fällige Aufgabe erreicht die verantwortliche Person am Morgen ihres Tages per
  E-Mail, einmal je Aufgabe und Tag, mit dem Betrieb als Absender
- Nachrichten entstehen nur über `notifications/` und werden nur aus `mail/` verschickt.
  Ein Test hält fest, dass kein anderes Modul selbst verschickt, damit es bei einem
  Absender und einer Stelle für die Vorlagen bleibt

- Auf dem Bildschirm "Steuern" erklärt der Inhaber jetzt auch die Kleinunternehmerregelung
  nach § 19 UStG und die Ist-Versteuerung nach § 20 UStG, jeweils ab einem Tag, den er
  selbst wählt, mit Verlauf und freiwilliger Grundlage. Die Kleinunternehmerregelung ließ
  sich bisher nur über die Schnittstelle setzen, die Ist-Versteuerung gar nicht. Grenzen
  und Fundstellen kommen aus den Regelpaketen
- Ab 2028 trägt eine Rechnung mit ausgewiesener Umsatzsteuer die Angabe „Versteuerung nach
  vereinnahmten Entgelten“, wenn der Betrieb an ihrem Datum die Ist-Versteuerung erklärt
  hat, im PDF und in der E-Rechnung. § 14 Abs. 4 Satz 1 Nr. 6a UStG verlangt sie von da
  an, weil der Kunde die Vorsteuer aus einer solchen Rechnung erst nach der Zahlung
  abziehen darf
- Das Regelpaket `cash-accounting` mit der Umsatzgrenze der Ist-Versteuerung seit 2012,
  im Paket `invoice` der Stichtag der neuen Angabe und die Einstellung
  `cash_accounting.permitted` (Migration 0020). Die Feature-Gliederung kennt die
  Ist-Versteuerung seit v2.7

- Aufgaben mit Fälligkeit, verantwortlicher Person und Status, auf Wunsch an einem Kunden,
  Objekt oder Auftrag. Sie stehen an dem Datensatz, an dem sie hängen, und in einer
  eigenen Liste unter "Aufgaben", weil eine Aufgabe nur am Kunden morgens niemand findet
  und eine nur in der Liste bei der Arbeit am Kunden übersehen wird
- Auf der Baustelle stehen die eigenen offenen Aufgaben über den Aufträgen, und an jedem
  Auftrag lässt sich eine notieren. Aufgaben gehen durch den Postausgang wie alles, was
  vor Ort entsteht, also auch ohne Netz
- Wer eine Aufgabe geschrieben hat, trägt ein Trigger aus der Anfrage ein, und eine
  Aufgabe ohne menschlichen Urheber lässt sich anlegen. Das ist der Weg, den die
  Fristen-Engine aus Phase 2 nehmen wird, damit sie keinen zweiten braucht
- Die verantwortliche Person muss im Betrieb arbeiten und darf nicht gesperrt sein. Der
  Abgleich lehnt sonst den einen Vorgang ab, ein Fremdschlüssel auf die Mitgliedschaft
  hält es zusätzlich in der Datenbank fest
- `GET /tasks/assignees` nennt die Namen der Belegschaft für die Auswahl, an jeden mit
  `task.read` und ohne Adressen oder Rollen, denn die Liste der Zugänge liest nur der
  Inhaber
- Die Vorschau bringt drei Aufgaben mit, eine davon überfällig und eine erledigt

- Der Bildschirm "Steuern" im Büro. Dort erklärt der Betrieb den Übergang von 2027 nach
  § 27 Abs. 38 Satz 1 Nr. 2 UStG und nimmt ihn wieder zurück, mit Verlauf und einer
  freiwilligen Grundlage; Jahr, Grenze und Frist kommen aus dem Regelpaket. Bisher ging
  das nur über die Schnittstelle, und ohne Erklärung hält die Pflicht jede Rechnung für
  Arbeit aus 2027 auf, der für die E-Rechnung eine Angabe fehlt
- Die Karte "E-Rechnung" einer Rechnung für Arbeit aus 2027 verweist auf diese
  Erklärung, weil die Pflicht dort an ihr hängt

- Das ZUGFeRD-PDF einer festgeschriebenen Rechnung über `GET /documents/:id/zugferd`: das
  PDF, das die Rechnung aufbewahrt, mit der E-Rechnung im Profil EN 16931 als
  `factur-x.xml`, umgebaut zu PDF/A-3b. Fehlt das PDF noch, wird es dabei gedruckt und
  mit aufbewahrt, damit ein Kunde, der beide bekommt, zweimal dieselbe Seite sieht
- Das ZUGFeRD-PDF verlangt nur, was die Norm verlangt, und nicht die Zusätze von
  XRechnung. Eine Rechnung ohne Käuferreferenz geht damit als ZUGFeRD-PDF hinaus, auch
  wenn es für sie keine XRechnung gibt
- Die Karte "E-Rechnung" im Büro bietet nach dem Festschreiben beide Dateien an und
  trennt die Lücken: was der Norm fehlt, hält beide auf, was nur XRechnung verlangt, nur
  sie. So ist an jeder Lücke zu sehen, welche Datei an ihr scheitert
- Der CI-Job "E-Rechnung gegen KoSIT und Mustang" druckt Musterrechnungen mit dem echten
  Renderer und prüft die ZUGFeRD-PDFs mit Mustang, als PDF/A-3 und gegen die Regeln von
  Factur-X. Ob ein PDF als PDF/A-3 durchgeht, hängt an dem, was Chromium schreibt, und
  das zeigt nur der echte Renderer

- Eine Rechnung an ein Unternehmen im Inland geht als E-Rechnung hinaus, eine an eine
  Privatperson oder ins Ausland als PDF. Das entscheiden die Stammdaten des Kunden, wie
  die Rechnung ihn festhält, und kein Schalter am Beleg, weil ein Schalter irgendwann
  falsch gesetzt würde. Rechnungen bis 250 Euro und jede Rechnung eines
  Kleinunternehmers gehen nach § 33 Satz 4 und § 34a Satz 4 UStDV weiter als PDF
- `GET /documents/:id/xrechnung` schreibt beim ersten Abruf aus dem eingefrorenen Stand
  eine XRechnung in UN/CEFACT CII nach XRechnung 3.0, hält sie vor dem Speichern gegen
  das XML-Schema und gibt danach nur noch diese Datei heraus. Die Schemadateien liegen im
  Repository, weil eine selbst betriebene Installation eine Rechnung auch ohne Netz
  schreiben können muss
- Das Regelpaket `e-invoice` sagt, ab wann die E-Rechnung Pflicht ist: seit 2025 nach
  § 14 Abs. 2 Satz 2 Nr. 1 UStG, mit den Übergängen nach § 27 Abs. 38 UStG. Den Übergang
  von 2027 erklärt der Betrieb als Einstellung, weil OpenGewerk den dafür maßgeblichen
  Vorjahresumsatz vor der Buchhaltung nicht kennt; ohne Erklärung gilt die Pflicht
- Ist die E-Rechnung Pflicht, wird eine Rechnung, der dafür eine Angabe fehlt, nicht
  festgeschrieben. Vorher wird sie festgeschrieben und die Karte "E-Rechnung" sagt, was
  fehlt, denn erst ab dann ist das PDF allein keine ordnungsgemäße Rechnung mehr
- Die Käuferreferenz, bei einer Behörde die Leitweg-ID, als Feld in den Stammdaten des
  Kunden. Sie steht beim Kunden und nicht an der Rechnung, weil eine Behörde eine
  Leitweg-ID hat und nicht eine je Rechnung
- Ein CI-Job hält neun Musterrechnungen gegen den Validator der KoSIT, in fester Fassung
  und mit SHA-256 geprüft. Die Geschäftsregeln von EN 16931 und XRechnung sind
  Schematron und brauchen Java, das in der Anwendung nicht läuft

- Eine festgeschriebene Rechnung lässt sich stornieren, im Büro über "Stornieren" und
  über `POST /documents/:id/cancellation`. Die Stornorechnung spiegelt den eingefrorenen
  Stand der Rechnung mit umgekehrtem Vorzeichen und bekommt die nächste Nummer aus dem
  Kreis der Rechnungen; neu gerechnet wird nichts, damit sie auf den Cent aufhebt, was
  verschickt wurde
- Die Stornorechnung nennt die aufgehobene Rechnung unter "Zur Rechnung" und in einem
  Satz über den Positionen, und ohne diesen Verweis wird sie nicht festgeschrieben. Er
  ist nach § 31 Abs. 5 UStDV Pflicht, der eingefrorene Stand trägt ihn dafür in Fassung 5
- Hat die Rechnung Abschlagsrechnungen abgezogen, gibt die Stornorechnung sie als
  zurückgenommenen Abzug zurück, damit beide Rechnungsbeträge zusammen null ergeben
- In einer Kette wird die spätere Rechnung zuerst storniert. Baut eine festgeschriebene
  Rechnung auf der zu stornierenden auf, antwortet die Route mit 409 und ihrer Nummer,
  denn die spätere hat die frühere schon abgezogen
- Eine Stornorechnung entsteht nur über ihre Route, Migration 0016 lehnt jeden anderen
  Weg ab, auch direkt an der Datenbank. Nur dort entsteht sie aus dem eingefrorenen Stand
  der Rechnung, die sie aufhebt

- Schlussrechnung und kumulierte Abschlagsrechnung als Glieder der Belegkette: aus
  Angebot, Kostenvoranschlag, Auftragsbestätigung und der vorigen Abschlagsrechnung, aus
  dem Regiebericht nur die Schlussrechnung, weil er fertige Arbeit festhält
- Jede Abschlagsrechnung und die Schlussrechnung ziehen ab, was die Abschlagsrechnungen
  davor in ihrer Kette gestellt haben, netto und Steuer je Satz, aus deren eingefrorenem
  Stand und nie neu gerechnet. So ergeben alle Rechnungen einer Kette zusammen genau die
  ganze Leistung, auch über einen Wechsel des Steuersatzes hinweg; einzeln besteuert tun
  sie das nicht
- Abgezogen wird, was gestellt wurde, und nicht, was gezahlt wurde. Zahlungen kennt die
  Anwendung erst mit Finance in Phase 3, und die Lesart gehört vor die fachkundige
  Abnahme in #31
- Fassung 4 des eingefrorenen Belegstands trägt die Abzüge und den Rechnungsbetrag. PDF
  und Büro zeigen Gesamtleistung, jeden Abzug mit Nummer und Datum und den
  Rechnungsbetrag mit Steuer je Satz, beide aus derselben Funktion, damit sie dieselben
  Zahlen zeigen
- Das Büro trägt den Leistungszeitraum einer Rechnung im Kopf ein, eine Schlussrechnung
  aus dem Regiebericht nimmt dessen Datum als Tag der Leistung. Ohne ihn wird eine
  Schlussrechnung nicht festgeschrieben, weil § 14 Abs. 4 Nr. 6 UStG ihn verlangt

- Der Regiebericht auf der Baustelle: was gemacht wurde, Arbeitszeit und Material, ohne
  Netz geschrieben. Alles geht durch den Postausgang, auch die Unterschrift, denn
  geschrieben wird im Keller
- Der Kunde unterschreibt auf dem Gerät genau die Seite, die er sieht: die Unterschrift
  trägt einen Fingerabdruck über Text und Zeilen, und der Server nimmt sie nur für
  diesen Stand an. Hat das Büro inzwischen etwas ergänzt, wird sie als Konflikt
  abgelehnt und muss neu geleistet werden, statt eine Seite zu bestätigen, die der Kunde
  nie gesehen hat
- Mit der Unterschrift ist der Bericht `signed` und ändert sich nicht mehr: Postausgang,
  Routen und Datenbank lehnen jede Änderung ab, jede mit ihrem Grund. Die Unterschrift
  soll zu dem passen, was unterschrieben wurde
- Ein Regiebericht zeigt keine Preise, im PDF wie im Büro. Er hält fest, was geleistet
  wurde, bepreist wird die Rechnung daraus
- Die Unterschrift ist ein Pfad aus ganzen Zahlen in einem Rahmen von 1000 mal 400, und
  Server wie Datenbank prüfen seine Form. So gelangt über diesen Weg kein Markup in SVG
  oder PDF

- `pnpm run preview` startet eine Vorschau ohne Anmeldung: ein Beispielbetrieb in einer
  eigenen Datenbank `opengewerk_preview`, angelegt über die echten Routen, jede Anfrage
  mit der Rolle Inhaber, der Server auf 127.0.0.1:23700. Damit lässt sich die Oberfläche
  ansehen und durchklicken, ohne ein Konto anzulegen
- Die Vorschau steht in keinem Abbild, startet nicht mit `NODE_ENV=production`, lauscht
  nur auf 127.0.0.1 und nimmt nur eine lokale Datenbank, deren Name auf `_preview`
  endet. Eine Instanz, in der jede Anfrage als Inhaber gilt, darf nirgends sonst laufen

- Angebot und Kostenvoranschlag am Auftrag, als zwei Belegarten über zwei Knöpfe und
  nicht als eine mit Schalter. Ein Kostenvoranschlag ist eine Schätzung ohne Gewähr
  (§ 649 BGB), ein Angebot sagt einen Preis zu, und ein Feld mit Vorgabe verschickt
  irgendwann das Falsche
- Titel als Zeile ohne Betrag, mit einer Summe unter jedem Titel. Die Gliederung rechnet
  `outlineRows` in `domain` für Bildschirm und PDF, damit Position 2.3 auf beiden
  dieselbe ist
- Texte über und unter den Positionen, dazu Textbausteine unter "Textbausteine" im
  Büro. Einsetzen kopiert den Text, eine spätere Änderung am Baustein ändert also keinen
  Beleg
- Die Auftragsbestätigung entsteht aus dem festgeschriebenen Angebot über
  `POST /documents/:id/successors`, mit allen Zeilen in einer Transaktion und dem Verweis
  auf den Vorgänger, und der Belegbildschirm zeigt die Kette in beide Richtungen. So
  beschreibt Abschnitt 1.4 der Feature-Gliederung die Belegkette

- Der Briefkopf im Büro: Anschrift, Kontakt, Steuernummer, USt-IdNr., Bankverbindung,
  Handelsregister, Vertretung und ein Logo als PNG oder JPEG bis 1 MB. Ändern darf ihn
  nur der Inhaber, das Büro liest mit. Aus ihm kommen die Angaben zum Betrieb, die
  § 14 UStG auf jeder Rechnung verlangt
- Vor dem Festschreiben prüft `domain` die Pflichtangaben nach der Liste, die der Beleg
  braucht: § 14 Abs. 4 UStG als Regel, § 33 UStDV für Kleinbeträge bis 250 Euro und
  § 34a UStDV für Kleinunternehmer seit 2025. Fehlt etwas, antwortet die Route mit 422
  und nennt jeden Punkt mit Paragraf, und der Zähler bleibt stehen, damit keine Nummer
  an eine Rechnung geht, die so nicht hinausgehen darf
- Grenze und Stichtag der vereinfachten Rechnungen stehen im Regelpaket `invoice`, und
  der Leistungszeitraum ist ein neues Feld am Beleg, weil § 14 Abs. 4 Nr. 6 UStG ihn
  verlangt und es ihn bisher nicht gab
- Beim Festschreiben hält `document_snapshots` fest, was der Beleg sagt, in derselben
  Transaktion wie die Nummer, und ein Trigger lehnt jede Änderung ab. Zieht der Kunde
  später um, bleibt die Rechnung, wie sie war
- `GET /documents/:id/pdf` druckt einen festgeschriebenen Beleg beim ersten Abruf aus
  diesem Stand, legt das PDF inhaltsadressiert im Dateispeicher ab und gibt danach nur
  noch diese Bytes zurück. Festschreiben braucht den Renderer damit nicht, und fehlt er,
  kommt 503 mit dem Befehl, der ihn startet
- Die Vorlage folgt DIN 5008 Form B, damit die Anschrift im Fenster landet, und bettet
  Barlow ein, damit ein Update des Renderer-Abbilds den Umbruch nicht ändert. Ein
  Entwurf trägt "Entwurf" quer über jeder Seite und wird nie gespeichert, damit ein
  ausgedruckter Entwurf nicht für den Beleg gehalten wird

- Unter "Zugänge" stehen im Büro die Konten des Betriebs mit Rollen, Zustand und letzter
  Anmeldung. Ein Zugang entstand bisher nur über `add-staff` auf der Kommandozeile, und
  ein Betrieb öffnet keine SSH-Sitzung, um jemanden in den Urlaub zu schicken
- Ein neuer Zugang entsteht als Einmal-Link, das Passwort wählt die eingeladene Person
  selbst. Ein Passwort, das ein Kollege kennt und das dann drei Jahre bleibt, ist
  schlechter als eines, das niemand kennt. Gespeichert wird vom Token nur sein SHA-256,
  der Link gilt sieben Tage und wirkt einmal
- Gesperrt wird statt gelöscht, und sofort: die Sitzungen im Betrieb enden gleich und
  nicht erst beim Ablauf, der auf einem registrierten Gerät dreißig Tage beträgt. Die
  Sperre hängt an der Zugehörigkeit, ein Betrieb kann also niemanden aus dem
  Nachbarbetrieb aussperren
- Der letzte Inhaber lässt sich weder sperren noch entmachten, sonst führte der Weg
  zurück nur über psql
- `membership.read` und `membership.write` gehören ausschließlich zur Rolle Inhaber und
  nicht zum Büro: wer Rollen vergeben kann, kann sich selbst die des Inhabers geben

- `add-staff` erzeugt ein Passwort, wenn `OPENGEWERK_PASSWORD` fehlt, und gibt es einmal
  auf der Standardausgabe aus. Bei einer unbeaufsichtigten Installation brach der Befehl
  bisher ab, und dann denkt sich jemand `Test1234!` aus
- Das Passwort besteht aus fünf Fünfergruppen aus 32 Zeichen ohne `i`, `l`, `o` und `u`,
  zusammen 125 Bit. Es wird von einem Terminal abgelesen und einmal von Hand getippt, und
  ein Zeichen, bei dem jemand raten muss, kostet mehr als das Bit, das es trägt
- Gab es das Konto schon, sagt der Befehl das und gibt kein Passwort aus. Ein Konto, das
  es schon gab, behält sein Passwort, und ein ausgegebenes neues funktionierte nicht

- Die Ersteinrichtung im Browser: solange es weder einen Betrieb noch ein Konto gibt,
  zeigt die Anwendung statt der Anmeldung ein Formular für Betrieb und Inhaber und legt
  Betrieb, Konto und Zugehörigkeit in einer Transaktion an. Vorher brauchte eine neue
  Instanz ein `INSERT` über psql und `add-staff`, und der so angelegte Inhaber kam nicht
  über die Betriebswahl hinaus
- Direkt danach wird der zweite Faktor eingerichtet, mit QR-Code und
  Wiederherstellungscodes. Er gilt erst, wenn ein Code aus der App gestimmt hat, sonst
  sperrt ein falsch abgetippter Schlüssel dieselbe Person aus
- Ob die Ersteinrichtung erscheint, entscheidet eine Abfrage an die Datenbank und kein
  Schalter in der `.env`. Einen Schalter stellt irgendwann jemand zurück, und dann legt
  der nächste Besucher einen zweiten Inhaber an; die Abfrage läuft unter einer
  Vorgangssperre, damit zwei gleichzeitig geöffnete Bildschirme einen Betrieb anlegen und
  nicht zwei
- Die schreibende Route der Ersteinrichtung prüft Herkunft und Inhaltstyp selbst und
  lässt nur einen Lauf gleichzeitig zu. Sonst könnte ein Formular auf einer fremden Seite
  eine frische Instanz übernehmen, und Argon2id wäre unangemeldet bestellbar

- Die erste Oberfläche, eine Codebasis mit zwei Einstiegen nach ADR 0004: `/` für das
  Büro mit Kundenliste, Kundenakte, Objekt, Anlage, Aufträgen und der Geräteliste, `/m`
  für die Baustelle mit den offenen Aufträgen und dem Konfliktbildschirm. Eine
  Installation zeigt damit nicht mehr nur eine API, sondern eine Anwendung, mit der sich
  arbeiten lässt
- Der Abgleich-Client im Browser: IndexedDB je Betrieb, Postausgang und Konflikte. Die
  Regeln bleiben in `domain`, so rechnet das Gerät dieselbe Antwort aus wie der Server,
  bevor es etwas schickt
- Der Postausgang wird über den Serverstand gelegt und nicht in die lokale Kopie
  geschrieben. Lehnt der Server einen Vorgang ab, stünde der abgelehnte Wert sonst für
  immer auf dem Bildschirm, ohne irgendwo sonst zu existieren
- Die Geräteerkennung schlägt den passenden Einstieg vor und leitet nicht um. Eine
  Weiterleitung vom Büro ließe ein Telefon erst das eine und dann das andere Bündel laden
- Die Liste auf der Baustelle heißt "Offene Aufträge" und nicht "Meine Aufträge". Eine
  Zuordnung von Personen zu Aufträgen gibt es im Modell noch nicht, und "Meine" wäre ein
  Versprechen, das die Daten nicht halten
- Das Bündelbudget aus ADR 0004 als Prüfung in der CI, gemessen an den gebauten
  HTML-Dateien und nicht an einer Liste, die jemand pflegen müsste

- Zwei Tests halten den Teiler der Verzugszinsrechnung fest: den Betrag selbst und dass
  ein volles Jahr genau den Jahreszins trägt. Die Prüfungen ringsum vergleichen nur
  Ergebnisse miteinander und wären mit jedem Teiler grün gewesen

- Belegpositionen mit Reihenfolge, Einheit, Menge in Tausendsteln, Einzelpreis in Cent
  und dem Steuersatz als Schlüssel in die Regel-Engine. Der Beleg war bis dahin ein Kopf
  ohne Inhalt, eine Rechnung ließ sich nicht stellen
- `GET /documents/:id/totals` rechnet die Summen jedes Mal aus den Zeilen, mit dem
  Belegdatum und nicht mit heute. Eine Summe am Beleg wäre dieselbe Zahl an einem
  zweiten Ort, und zwei Orte laufen auseinander
- Erst je Steuersatz summieren, dann einmal besteuern. Jede Zeile einzeln zu besteuern
  ergibt bei etwa jeder dritten Rechnung einen anderen Betrag, weil jede Zeile für sich
  rundet
- Die Nettosumme der Zeile wird gespeichert, weil die gerundete Zahl die ist, die der
  Kunde gesehen hat, und von einem Check gehalten, der über `numeric` rechnet: nur dort
  rundet PostgreSQL kaufmännisch
- Die Positionen frieren mit ihrem Beleg ein, durchgesetzt von einem eigenen Trigger. Im
  Abgleich hängt die Regel dafür am Status des Belegs (`gateFrom`), weil eine Kopie des
  Status an der Zeile genau dann veraltet wäre, wenn jemand festschreibt
- Ein Beleg nach § 19 oder § 13b UStG trägt den vorgeschriebenen Hinweis statt einer
  Steuer von null, denn "0,00 EUR Umsatzsteuer" sagt etwas anderes und Falsches. Die
  Behandlung wird beim Anlegen abgeleitet und mit dem Festschreiben eingefroren, sonst
  schriebe ein geändertes Kennzeichen am Kunden die Rechnung vom letzten Jahr um

- Der CI-Job "Schreibweise" prüft neben Gedankenstrichen auch umgeschriebene Umlaute,
  gegen eine Wortliste und nicht gegen ein Muster auf Buchstabenpaare, denn die stehen
  in sehr vielen englischen Wörtern. Pfade, Dateinamen, Adressen und Kürzel in
  Großbuchstaben bleiben ASCII

- Anmeldung und Sitzungen nach ADR 0006: better-auth im Kern, Sitzungen als
  HttpOnly-Cookies, Passkeys und TOTP, Argon2id, Ratenbegrenzung mit Zählern in der
  Datenbank und Herkunftsprüfung gegen `TRUSTED_ORIGINS`. Bis dahin lehnte eine Instanz
  jede Anfrage an die Daten mit 401 ab, weil es keine Anmeldung gab
- Die `auth_`-Tabellen tragen die übliche Richtlinie umgedreht: erreichbar nur, solange
  kein Mandant gesetzt ist. Ein Benutzer gehört zur Instanz und nicht zu einem Betrieb,
  und so kann eine Anfrage, die in einem Betrieb arbeitet, die Belegschaft des
  Nachbarbetriebs nicht lesen
- Was ein Betrieb von einer Anmeldung sieht, steht in `tenant_sessions` und damit im
  Audit-Log. Ein Eintrag dort braucht einen Mandanten, und zwischen Passwort und
  Betriebswahl gibt es keinen
- Eine dritte Art von Route, angemeldet und noch ohne Betrieb (`@RequiresSession`), für
  die Betriebswahl. Sie kann kein Recht verlangen, weil Rechte aus einer Mitgliedschaft
  je Betrieb kommen, und öffentlich darf sie nicht sein
- Konten entstehen über `add-staff` auf der Kommandozeile, das Passwort kommt aus einer
  Umgebungsvariablen. Ein Argument stünde in der Prozessliste und im Verlauf der Shell
- Neu in der `.env`: `SESSION_SECRET`, `TRUSTED_ORIGINS` und `CLOSED`. Die erlaubten
  Herkünfte haben keinen Vorgabewert, weil eine Vorgabe den Schutz genau dort abschalten
  würde, wo niemand darüber nachgedacht hat

- Die Bausteine der Oberfläche: Design-Tokens in `packages/web/src/styles/tokens.css`,
  heller und dunkler Grund und acht Komponenten. ADR 0004 verlangt eigene Komponenten
  ohne UI-Kit, damit das Branding trägt, und ließ offen, was das Branding dann ist
- Kupfer hat vier Werte statt einem. Weiße Schrift auf dem reinen Markenkupfer erreicht
  3,88:1 und fällt bei jedem Knopf unter 18,66 px durch, also auch bei "Festschreiben"
- Zwei Dichten für Büro und Baustelle über `data-entry` und nicht über einen
  Umbruchpunkt, weil die beiden Einstiege zwei Eingabegeräte sind und keine zwei
  Bildschirmbreiten
- Barlow kommt aus dem Bündel und nicht von einem Schriftdienst. Eine selbst betriebene
  Instanz darf für ihre eigene Darstellung nicht am offenen Netz hängen
- Ein Kontrasttest rechnet jede Kombination aus Vordergrund und Fläche aus der
  Token-Datei nach, in beiden Grundtönen, und fand beim ersten Lauf drei Werte, die
  durchfielen. Er rechnet nicht im Browser, weil `color-mix()` dort Artefakte liefert

- Alle 26 Datensätze der Regelpakete sind gegen ihre Fundstelle vorgeprüft, die
  Basiszinssätze gegen die Tabelle der Bundesbank, die übrigen gegen die datierten
  Gesetzesfassungen; kein Wert wich ab. Die Befunde stehen als Notizen an den
  Datensätzen, dort wo jemand den Wert prüft, und nicht nur in einem Issue
- Ein Test verlangt von jedem Paket ein Prüfdatum in seiner Notiz. Die Pakete sind die
  eine Stelle, an der ein Wert falsch sein kann, ohne dass Code falsch ist, und ohne
  Datum weiß bei der nächsten Prüfung niemand, wann die letzte war

- Ein eigenes Recht `customer.create` neben `customer.write`, für Monteur, Büro und
  Inhaber: der Monteur legt beim Störungseinsatz offline einen Kunden an, ändern darf er
  bestehende weiterhin nicht. ADR 0005 beschreibt genau diesen Einsatz, und ADR 0006 gab
  dem Monteur bis dahin nur `customer.read`

- Speicher und Zähler sind eigene Anlagenarten. Bis dahin landeten sie auf `other` und
  verloren damit die eine Angabe, die sagt, was sie sind
- Ein Test hält jedes Enum der Datenbank Wert für Wert gegen die Liste im Code. Einen
  Wert in die Liste schreiben und die Migration vergessen besteht sonst Typprüfung,
  Linter und jeden Test und fällt erst an einer laufenden Installation auf

- Die Basiszinssätze bis zum 31.12.2026 sind eingetragen: 2,27 Prozent ab 01.01.2025,
  1,27 ab 01.07.2025, 1,27 ab 01.01.2026 und 1,52 ab 01.07.2026. Vorher gab die Engine
  für jeden Tag ab dem 01.01.2025 einen Fehler statt eines Verzugszinses, was die
  gewollte Reaktion war und das Mahnwesen blockiert hätte

- Zwei Verhaltenstests für `tenants` mit zwei Mandanten in der Datenbank: die Tabelle
  zeigt jedem genau seine eigene Zeile, und Anlegen, Umbenennen und Löschen werden
  abgewiesen. Es ist die einzige Tabelle, auf der die Policy den Primärschlüssel
  vergleicht statt einen Fremdschlüssel, und sie war bis hierher nie durchgespielt
- Der Migrations-Rundlauf prüft auch die Funktionen. Sieben der neun `CREATE FUNCTION`
  kommen ohne `OR REPLACE`, eine vergessene Rücknahme lässt das nächste Vorwärtsspielen
  also mit "function already exists" scheitern, und genau dafür gibt es die down-Dateien.
  Gegengeprüft mit einer entfernten Rücknahme, der Test nennt die Funktion beim Namen

- Die Paketgrenze aus ADR 0002 ist jetzt eine ESLint-Regel. `packages/domain` darf
  weder `@opengewerk/server` noch `@opengewerk/web` importieren, auch nicht über einen
  relativen Pfad. Gescheitert wäre ein solcher Import schon vorher, nur als fehlendes
  Modul und erst im Bau; jetzt steht die Regel im Editor und sagt, dass sie eine ist
- Der Discord-Server ist in der README verlinkt. Er ist für kurze Fragen gedacht und
  nicht als Ersatz für die Discussions: ein Chatverlauf ist nicht durchsuchbar

- Ein Update ist zwei Aufrufe: erst `docker compose run --rm --build migrate`, dann
  `docker compose up -d`. Die Reihenfolge ist keine Vorliebe. `up` allein erzeugt jeden
  Container mit geändertem Abbild neu, bevor es irgendeinen startet, der laufende
  Anwendungscontainer ist also schon weg, wenn die Migration anfängt. Schlägt sie dann
  fehl, steht die Instanz still statt weiterzulaufen. Nachgemessen am 19.09.2026
- Alle ausstehenden Migrationen laufen in einer einzigen Transaktion. Scheitert die
  dritte von drei, steht die Datenbank auf dem Stand davor und nicht irgendwo dazwischen.
  Der Preis ist, dass eine Migration nichts enthalten darf, was außerhalb einer
  Transaktion laufen muss; ein Test hält das fest
- Der Migrationslauf prüft die Hashes der bereits eingespielten Migrationen gegen die
  Dateien im Abbild und lehnt ab, wenn eine geändert wurde. Ohne diese Prüfung passiert
  schlicht nichts: drizzle vergleicht nur Zeitstempel, überspringt die geänderte Datei
  und meldet Erfolg. Gegengeprüft, die Tabelle blieb ungebaut und der Lauf sagte kein Wort
- Nach dem Lauf wird nachgesehen, ob wirklich alles eingespielt wurde. Eine Migration mit
  einem Zeitstempel vor dem der zuletzt eingespielten wird sonst stillschweigend
  übergangen, und das ist genau das, was zwei in der falschen Reihenfolge gemergte
  Branches hinterlassen
- Ein Abbild, das älter ist als die Datenbank, wird abgelehnt statt ausgeführt. Es kennt
  die Spalten nicht, die der neuere Stand angelegt hat
- Acht Tests für den Update-Pfad, darunter der Sprung von einem älteren Stand mit Daten
  über zwei Migrationen hinweg: Bestand, Spaltenvorgaben und Audit-Kette müssen danach
  unverändert sein, und die Kette muss von ihrem alten Kopf aus weiterlaufen
- Ein CI-Job fährt dasselbe mit Containern: ältere Fassung starten, Daten anlegen,
  aktualisieren, vergleichen, danach eine fehlerhafte Migration einsetzen und prüfen, dass
  der Aufruf abbricht, die Instanz weiterläuft und die Datenbank unberührt bleibt

- Sicherung und Rückspielen als Skripte, nicht als Anleitung. Ein Lauf schreibt
  Datenbank, Dateispeicher und die Köpfe der Audit-Ketten in ein Archiv, ein zweiter
  spielt es zurück und prüft danach nach, ob alles zurückgekommen ist
- Die Reihenfolge im Sicherungslauf ist Datenbank zuerst, Dateien danach. Andersherum
  hätte alles, was zwischen beiden Schritten hochgeladen wird, eine Zeile im Dump und
  keine Datei im Archiv, also einen Beleg, der auf nichts zeigt
- Drei Prüfungen nach dem Rückspielen: das Manifest gegen eine beschädigte Sicherung,
  bevor die Datenbank angefasst wird; die Dateinamen gegen den Hash ihres Inhalts, was
  ein inhaltsadressierter Speicher allein beantworten kann; die Audit-Ketten gegen die
  Sicherung
- `verify.sh` hält das Audit-Log einer laufenden Instanz gegen die Köpfe aus einer
  Sicherung, ohne etwas zurückzuspielen. Das ist die eine Prüfung, die die Kette in der
  Datenbank nicht an sich selbst vornehmen kann: wer den Trigger abschalten kann,
  rechnet die Kette nach einer Fälschung neu, und sie geht wieder auf. Gegengeprüft, die
  Prüfung in der Datenbank meldet danach "gebrochen bei: nirgends" und die gegen die
  Sicherung nennt den Mandanten
- Verschlüsselung der Archive über age mit einem öffentlichen Schlüssel. Die Maschine,
  die sichert, kann damit ihre eigenen älteren Sicherungen nicht lesen
- Aufbewahrung über `BACKUP_KEEP`, Ziel über `BACKUP_TARGET`, beides in der `.env`
- Der Dateispeicher aus ADR 0007 als eigenes Volume, und die Anwendung startet nicht,
  wenn sie nicht hineinschreiben kann. Ein falscher Mount sieht sonst genauso aus wie
  eine laufende Instanz, bis das erste Foto verloren geht
- Ein CI-Job, der den ganzen Weg fährt: Daten anlegen, sichern, beide Datenvolumes
  löschen, in die leere Instanz zurückspielen, Bestand und Audit-Ketten vergleichen und
  zuletzt prüfen, dass eine beschädigte Sicherung abgelehnt wird

- Betrieb über Docker Compose: ein Aufruf auf einer leeren Maschine liefert eine
  erreichbare Instanz mit migrierter Datenbank. Drei Dienste, dazu ein Migrationslauf,
  der sich vor jedem Start als Eigentümer der Tabellen anmeldet und danach beendet
- Ein Einstiegspunkt, der den Server startet, mit einer Identitätsquelle, die niemanden
  erkennt. Jede Route hinter dem Guard antwortet damit mit 401, und eine Instanz lässt
  sich betreiben, migrieren und messen, bevor es eine Anmeldung gibt. Der Notbehelf, der
  beim Bau der Rechte verworfen wurde, hätte jeden hereingelassen; dieser lässt keinen
  herein
- Ein Health-Endpunkt, der die Datenbank einbezieht: 200, solange sie antwortet, sonst
  503. Ein Server, dessen Datenbank weg ist, nimmt weiter Verbindungen an und scheitert
  an jeder Anfrage, und das als gesund zu melden machte aus einem lauten Ausfall einen
  leisen
- Eine Prüfung der Verbindungsadresse beim Start, die zwei Fehler abfängt, bevor sie
  teuer werden: eine Anwendung, die sich als Eigentümer der Tabellen oder als Superuser
  anmeldet, bekäme eine Mandantentrennung, die aussieht wie eine und keine ist. Und ein
  Passwort mit `/` oder `@` darin teilt die Adresse an der falschen Stelle, was als
  Namensauflösung für einen Rechner scheitert, den niemand gemeint hat
- Die Anbindung an den Renderer nach ADR 0007, gekapselt als `renderPdf(html)`. Fehlt der
  Dienst oder antwortet er nicht, kommt eine Meldung mit dem Befehl, der ihn startet,
  statt eines Absturzes. Antwortet er mit einer Ablehnung, ist das ein anderer Fehler,
  weil dann das Dokument falsch ist und nicht die Installation
- Ein Build über alle Pakete, damit es etwas zum Ausliefern gibt, und ein Abbild in zwei
  Stufen: gebaut mit allen Werkzeugen, ausgeliefert ohne sie, ohne Zugangsdaten, unter
  einem Benutzer ohne Rechte und mit einer eigenen Gesundheitsprüfung
- Ein CI-Job, der den Stapel so startet, wie eine Installation es tut, und prüft, dass
  die Instanz antwortet, dass sie ohne Anmeldung jede Datenroute ablehnt und dass keine
  einzige Tabelle ohne Row-Level Security dasteht

- Regel-Engine: gesetzliche Parameter als Datensätze in Regelpaketen mit
  Gültigkeitszeitraum und Fundstelle, nicht im Quelltext. Umsatzsteuersätze,
  Kleinunternehmergrenzen, Verzugsregeln und der Basiszinssatz
- Jede Abfrage braucht einen Tag, und es gibt keinen Weg, ohne einen zu fragen. Das
  trägt die historische Anwendung: ein Beleg von 2027 wird auch 2030 nach den Regeln
  von 2027 beurteilt
- Gerechnet wird in Basispunkten und Cent, also in ganzen Zahlen, und gerundet an genau
  einer Stelle, kaufmännisch und von der Null weg
- Wo keine Regel hinterlegt ist, gibt es keine Antwort statt einer erfundenen. Die
  Pakete sagen in sich selbst, bis wann sie reichen
- Mandantenbezogene Parameter davon getrennt, in der Datenbank und ebenfalls mit
  Gültigkeitszeitraum. Sie werden nicht geändert, sondern ab einem Tag abgelöst, und
  kein Schlüssel darin kann eine gesetzliche Größe verschieben
- Eine Strukturprüfung, die die Sync-Spalten gegen die Abgleichregeln in `domain` hält:
  eine Tabelle, die in einem von beiden fehlt, macht sie rot
- Offline-Datenschicht: Vorgänge mit Feld, altem und neuem Wert, die ein Gerät sammelt und
  der Reihe nach schickt. Der Server vergleicht, was das Gerät gesehen hat, mit dem, was
  dasteht, und lässt durch, was niemand sonst angefasst hat
- Konflikte landen in einer Liste mit drei Bildern nebeneinander, statt still aufgelöst zu
  werden. Ein Vorgang wirkt ganz oder gar nicht
- Konfliktregeln je Entität in `domain`: Stammdaten dürfen offline angelegt, aber nicht
  geändert werden, ein Beleg nur solange er Entwurf ist, festgeschrieben wird nur online
- Dieselbe Übertragung zweimal erzeugt keinen zweiten Datensatz. Jeder Vorgang hat eine
  Kennung vom Gerät, und der Server quittiert jede, die er gesehen hat
- Soft-Delete auf allen abgeglichenen Tabellen. Eine entfernte Zeile wäre eine, von der
  ein Gerät, das offline war, nie wieder etwas hört
- Sync-Spalten auf jeder abgeglichenen Tabelle, gepflegt von einem Trigger: Version, wer
  zuletzt geschrieben hat, von welchem Gerät, und die Änderungsnummer, die den Stand für
  den nächsten Abgleich trägt
- Ein Stolperdraht auf die Spalten des Audit-Logs. Gemessen: eine einzige neue Spalte lässt
  die ganze Hashkette ab Eintrag 1 als manipuliert gelten, weil über die ganze Zeile
  gehasht wird
- Hashkette über dem Audit-Log: jeder Eintrag trägt den Hash seines Vorgängers, eine
  nachträgliche Änderung ist damit nicht nur verboten, sondern sichtbar. Eine Prüfung
  läuft die Kette eines Mandanten ab und nennt die erste Stelle, an der es nicht mehr
  aufgeht
- Gehasht wird die ganze Zeile ohne ihren eigenen Hash, eine später hinzugefügte Spalte
  ist damit automatisch abgedeckt. Die Zeitzone steht dabei fest auf UTC, sonst hashte
  derselbe Eintrag in Berlin anders als in Sydney und eine heile Kette sähe unterwegs
  kaputt aus
- Die Testdatenbank läuft unter einem Eigentümer ohne Superuser-Rechte. Vorher galt
  Row-Level Security für den Eigentümer der Tabellen nie, der Teil des Entwurfs, der nur
  für ihn gilt, war damit ungetestet
- Audit-Log auf Feldebene: eine Zeile je geändertem Feld mit altem Wert, neuem Wert,
  Zeitpunkt, Benutzer und Anlass. Geschrieben von einem Trigger an jeder Tabelle, damit
  auch eine Änderung im Log steht, die nicht über die Anwendung kommt. Der Benutzer bleibt
  dann leer, und die Datenbankrolle daneben sagt, woher die Änderung kam
- Das Log wird nur ergänzt. Ändern, Löschen und Leeren sind durch einen eigenen Trigger
  versperrt, auch für den Eigentümer der Tabelle, und die Anwendungsrolle hat darauf nur
  Leserecht
- Ein Test, der für jede Tabelle am Katalog prüft, dass der Trigger hängt. Eine Tabelle aus
  einer späteren Migration ohne Trigger macht ihn rot
- Nummernkreise je Mandant und Belegart, vergeben beim Festschreiben. Der Zähler steht in
  einer Tabellenzeile statt in einer Sequenz, damit ein Abbruch die Nummer wieder mitnimmt
  und keine Lücke bleibt. Alle Rechnungsarten teilen einen Kreis, Storno eingeschlossen
- Ein Trigger, der festgeschriebene Belege unveränderlich macht. Erlaubt bleibt nur der
  Wechsel auf storniert, und auch der nur, wenn sich sonst nichts ändert. Löschen gibt es
  nicht
- Vorschau der nächsten Belegnummer über dieselbe Funktion in `domain`, die auch die
  endgültige Nummer baut
- Rollen und Rechte: Inhaber, Büro und Monteur mit Rechten entlang der Aktion. Getrennt
  sind vor allem `document.write` und `document.issue`, weil ein Monteur den Regiebericht
  schreibt und das Büro ihn festschreibt
- Erste HTTP-Schicht auf NestJS mit den schreibenden Routen für Kunde, Objekt, Anlage,
  Auftrag und Beleg. Die Rechteprüfung läuft über einen global registrierten Guard, eine
  Route ohne Rechteangabe wird abgelehnt statt durchgewunken
- Ein Test, der alle registrierten Routen aufzählt und jede ohne Rechteangabe meldet. Die
  Controller kommen aus dem Modul selbst, ein neuer ist damit automatisch dabei
- Mandantentrennung: Row-Level Security auf allen 14 Tabellen, erzwungen auch gegenüber
  dem Tabelleneigentümer, dazu eine eigene Anwendungsrolle ohne Superuser-Rechte. Der
  Mandant wird an genau einer Stelle gesetzt, in `Database.forTenant()`, und gilt nur
  innerhalb der Transaktion
- Ein Test, der für jede Tabelle prüft, dass Row-Level Security aktiviert und erzwungen
  ist, eine Policy existiert und die Anwendungsrolle Rechte hat. Damit fällt eine Tabelle
  auf, die in einer späteren Migration eines davon vergisst
- Datenmodell-Kern: Mandant, Kunde, Ansprechpartner, Objekt, Anlage, Auftrag und Beleg,
  dazu die Elektro-Struktur unter der Anlage (Verteiler, Feld, Stromkreis, Betriebsmittel)
  und die PV-Struktur (Wechselrichter, String, Module). Schlüssel sind UUIDv7, erzeugt von
  PostgreSQL 18 oder vom Client, damit auf der Baustelle ohne Netz Datensätze entstehen
  können
- Erste Migration als SQL-Datei, dazu eine Rücknahme von Hand unter `migrations/down/`.
  Ein Test fährt beide Richtungen gegen eine echte PostgreSQL 18 und prüft, dass danach
  keine Tabelle und kein Typ übrig bleibt
- Die Typen des Datenmodells liegen in `domain`, die Ablage in `server`, und der Compiler
  hält beide Seiten deckungsgleich: eine Spalte, die nur auf einer Seite auftaucht, lässt
  die Typprüfung scheitern
- Monorepo-Gerüst nach ADR 0009: pnpm Workspaces mit Turborepo, die Pakete `domain`,
  `server` und `web`, ein gemeinsames `tsconfig.base.json`, ESLint mit Flat Config,
  Prettier und Vitest mit fast-check. `domain` ist ohne Node- und DOM-Typen
  konfiguriert, ein Zugriff auf `fs` oder das `document` ist dort ein Typfehler
- Vier CI-Schritte für den Code: installieren, Typprüfung, Lint, Test. Die Prüfungen
  auf Kodierung und Schreibweise laufen unverändert weiter
- Test, der die Dekorator-Metadaten absichert, an denen NestJS seine Abhängigkeiten
  erkennt. TypeScript 7 ist die native Neuimplementierung des Compilers, und ein
  Versionssprung, der die Metadaten verliert, soll die CI rot machen statt den
  Container beim Start
- ADR 0009 zu Werkzeugen und Repo-Struktur: pnpm Workspaces mit Turborepo, Node 24,
  TypeScript 7, Vitest mit fast-check für die Property-based Tests aus 4.8, ESLint mit
  Flat Config und Prettier, PostgreSQL 18. Schließt die drei offenen Enden aus ADR 0002
  (Paketmanager, Node-Version, endgültige Paketliste ohne `mobile-pwa`), ohne dessen
  Text umzuschreiben
- Initiales Repository-Gerüst
- Feature-Gliederung v2.3 mit Regel-Engine, Anlagenstruktur, Finance-Absicherung
  und einer auf ein MVP geschnittenen Roadmap
- ADR 0002 bis 0008 als Entscheidungsvorlagen für den Tech-Stack
- CI-Job "Schreibweise", der Gedankenstriche im gesamten Repository meldet

### Geändert

- `add-staff` fragt das Passwort verdeckt ab, zweimal, wie `passwd`, und erzeugt keines mehr.
  Aus einem Skript heraus kommt es wie bisher aus `OPENGEWERK_PASSWORD`. Ein erzeugtes Passwort
  musste ausgegeben werden und stand danach im Verlauf des Terminals, bis es jemand ersetzte;
  das Code Scanning hat das zu Recht als Passwort im Klartext gemeldet. Für ein Konto, das es
  schon gibt, fragt der Befehl gar nicht erst.
- Die Vorlage für einen Fehlerbericht beginnt nicht mehr mit einem Projekt in der
  Planungsphase ohne lauffähigen Code, sondern fragt, was bei einer laufenden Anwendung
  hilft: Büro oder Baustelle, mit oder ohne Netz, und bei einer eigenen Installation den
  Stand. Die Prüfung "Schreibweise" kennt keine Ausnahme mehr für die zwei Schlüssel der
  Konventionen im API-Vertrag, der sie seit opengewerk-api-spec#19 englisch benennt.
- Ein Titel nimmt beim Verschieben seine Positionen mit und springt über den ganzen Abschnitt
  daneben (#152); eine Position springt weiter über eine Zeile und wechselt so den Abschnitt.
  Bisher wanderte der Titel allein und stand danach über fremden Positionen oder mitten in
  einem Abschnitt. Die Regel steht als `movedInOutline` in `domain` neben `outlineRows`, und
  die Pfeile fragen dieselbe Funktion, ob sie etwas tun können.
- Sechs Abweichungen zwischen Code und ADRs haben jetzt ihren Nachtrag (#138): Push vor Pull
  und IndexedDB ohne Dexie (ADR 0005), Abgleichspalten und markiertes Löschen nur an den
  Tabellen, die zum Gerät reisen (ADR 0005), keine OpenAPI-Datei aus dem Code und der
  Renderer, der dauerhaft läuft (ADR 0002), eigene Komponenten ohne Radix und ohne Icons
  (ADR 0004). Radix und Lucide standen seit #52 in `packages/web/package.json`, benutzt
  wurden sie nie; die beiden Pakete sind entfernt.
- Entschieden, wo Kennungen entstehen (#151): am Rand, im Server und im Abgleich-Client, mit
  derselben Bibliothek `uuidv7` in derselben Fassung, die ein Test zusammenhält; `domain`
  kennt nur den Typ, weil es frei von Zufall bleibt. Ein Kommentar hatte die Entscheidung
  seit Phase 0 angekündigt.
- Die Servertests haben 30 Sekunden je Test statt 5. Der Migrationstest, der alle Migrationen
  hoch und wieder zurück fährt, lief in der CI über die Grenze, obwohl er lokal in zweieinhalb
  Sekunden durch ist; ein Test gegen die echte Datenbank richtet sich nach dem langsamsten
  Rechner, auf dem er läuft.
- Der Katalogtest der Mandantentrennung prüft jetzt, was eine Policy sagt, nicht nur, dass es
  eine gibt (#148). Jede Policy, unter die die Anwendung fällt, muss den Mandanten der Zeile
  mit dem der Transaktion vergleichen, oder eine restriktive Policy deckt die Tabelle; drei
  Ausnahmen für die Auswahl nach der Anmeldung und die Ersteinrichtung stehen mit Grund im
  Test. Eine spätere Policy mit `using (true)` wäre bisher durchgegangen.
- Der Renderer läuft auf einer festen Fassung mit Digest statt auf `latest` (#153), in
  `docker/compose.yaml` und in der CI dieselbe, und ein Schritt in der CI prüft das. Mit
  `latest` zog jede Installation das Chromium des Tages, mit dem die CI nie gedruckt hatte.
  Ein Update kommt jetzt als Pull Request von Dependabot.
- Kommentare in Konfigurationsdateien und einigen Tests sind jetzt englisch (#154):
  `pnpm-workspace.yaml`, `.prettierignore`, `.gitignore`, drei Blöcke in der CI, dazu Tests
  der Rechnung, der Regelpakete, der Belegpositionen und des Abgleichs und die Steuerfälle
  in `document.ts`. Seit dem 18.09.2026 ist Code englisch, Kommentare eingeschlossen; was
  ein Mensch in einer Oberfläche liest, bleibt deutsch.
- Die CI prüft jetzt die Formatierung (#147), als Schritt "Formatierung" im Job
  "Typprüfung, Lint und Tests". ADR 0009 legt Prettier fest, geprüft wurde es bisher
  nirgends, und neun Dateien waren auseinandergelaufen; sie sind in diesem Pull Request
  formatiert, ohne andere Änderung an ihnen.
- Eine Anlage, ein Verteiler, ein Feld oder ein Stromkreis, die als gelöscht markiert
  werden, nehmen alles mit, was darunter hängt, in derselben Anweisung und mit Eintrag im
  Audit-Log. Vorher blieben Stromkreise und Betriebsmittel unter einem gelöschten
  Verteiler stehen, unsichtbar, und gingen weiter an jedes Gerät

- Die Widerrufsbelehrung gehört zu jedem Angebot an einen Verbraucher zwingend, zusammen
  mit dem Formular und den neuen Hinweisen zum Erlöschen des Widerrufsrechts
  (Feature-Gliederung v2.13). Am Angebot lassen sich die drei nicht abschalten, unter
  "Einstellungen" nicht vom Angebot lösen und nicht vom Versand trennen, denn nimmt der
  Kunde an, muss die Belehrung schon bei ihm sein (Art. 246a § 4 Abs. 1 EGBGB). Einem
  Kostenvoranschlag wird keine Belehrung mehr vorgeschlagen, von Hand dazunehmen lässt sie
  sich weiter. Die Hinweise sagen, wann kein Widerrufsrecht besteht und wann es vorzeitig
  erlischt (Art. 246a § 1 Abs. 3 EGBGB); sie und der Vordruck, der jetzt "Verlangen auf
  vorzeitigen Leistungsbeginn" heißt, tragen den Wortlaut aus der Widerrufsbelehrung eines
  Handwerksbetriebs. Berichtigt ist er dort, wo er vom Gesetz abwich: die Nummerierung von
  § 356 BGB, die Bestätigung, die der Kunde für das Erlöschen abgeben muss, und der Fall der
  Reparatur auf Anforderung des Kunden (§ 356 Abs. 5 Nr. 3 BGB), der fehlte. Beides geht wie
  die Muster in die Prüfung in #31 (Migration 0029)

- Aus der Widerrufsbelehrung als Angebotsanhang werden in der Feature-Gliederung
  Belehrungen, die der Betrieb pflegt (v2.11): mitgeliefert das Muster nach Art. 246a
  EGBGB, dazu eigene, vorhandene änderbar und erweiterbar, je Belehrung mit der E-Mail des
  Belegs versendbar, mit dem Beleg eingefroren und später im Kundenportal abrufbar. Neu
  im Kundenportal ist die Widerrufsfunktion nach §356a BGB, weil die Annahme eines
  Angebots dort ein Vertrag über eine Online-Oberfläche ist

- Der Fahrplan in Abschnitt 10 der Feature-Gliederung ordnet jetzt jeden Punkt der
  Abschnitte 1 bis 9 einer Phase zu (v2.10). Ein großer Teil stand in keiner Phase,
  darunter Widerrufsbelehrung, Abnahme und Gewährleistung, DSGVO-Funktionen,
  Verfahrensdokumentation und Datenzugriff für die Betriebsprüfung, und die Zeile von
  Phase 3 nannte Lohnexport und Verfahrensdokumentation nicht, obwohl die Issues der
  Zeiterfassung und der Dokumentenablage sie dorthin verwiesen. Neu in Phase 1 ist die
  Widerrufsbelehrung nach §312g BGB, weil der Pilotbetrieb Angebote an Verbraucher bei
  ihnen zu Hause schreibt

- Der Renderer startet von Haus aus mit der Instanz. Bisher lief er nur mit
  `--profile renderer`, und eine mit `sh docker/start.sh` eingerichtete Instanz gab kein
  einziges PDF heraus: kein Angebot, keine Rechnung, keine Mail mit Beleg. Die Vorlage der
  `.env` trägt dafür `COMPOSE_PROFILES=renderer`, und `setup.sh` ergänzt die Zeile bei
  bestehenden Installationen vor dem nächsten Start. Abgeschaltet wird er mit einem leeren
  Wert, `COMPOSE_PROFILES=`. Die Meldung bei fehlendem Renderer nennt jetzt
  `sh docker/start.sh` und diese Zeile, und die CI holt aus dem Standardstapel ein PDF

- Der Standardport ist 23700 statt 3000, für die Instanz, die Vorschau und den
  Entwicklungsproxy von Vite. Auf 3000 läuft auf den meisten Maschinen, an denen jemand
  entwickelt, schon etwas anderes, und 23700 liegt weit darüber und unter dem Bereich, den
  Linux für ausgehende Verbindungen vergibt

- Der Hinweis auf Belegen eines Kleinunternehmers lautet jetzt "Für diese Leistungen gilt
  die Steuerbefreiung für Kleinunternehmer nach § 19 UStG." Seit 2025 verlangt § 34a
  Satz 1 Nr. 5 UStDV einen Hinweis auf die Steuerbefreiung, der alte Satz nannte nur den
  Paragrafen. Festgeschriebene Belege behalten ihren Satz

- Die Pakete `invoice` und `e-invoice`, die Kommentare an `billedAfter` und
  `eInvoiceDuty` und die README geben das Gesetz genauer wieder: § 14 Abs. 5 UStG setzt
  in der Endrechnung die vereinnahmten Teilentgelte ab, nicht die gestellten, und ein
  Übergang nach § 27 Abs. 38 UStG hängt an der Übermittlung. Kein Rechenergebnis ändert
  sich; was eine Entscheidung braucht, steht im Protokoll der Vorprüfung in #31

- Die Workflows nehmen die neuesten Hauptversionen der Actions: `actions/checkout` und
  `actions/setup-node` in v7, CodeQL in v4. Die alten Fassungen liefen noch auf Node 20,
  dessen Pflege im April 2026 endete, und CodeQL v3 wird im Dezember 2026 abgekündigt

- Die Roadmap in der README sagt, dass an Phase 1 gearbeitet wird, und verweist für das
  Offene auf den Meilenstein. Dort stand noch, Phase 1 komme als Nächstes, ein Satz aus
  der Zeit vor der ersten Oberfläche
- Die Projektfamilie in der README nennt die Website unter opengewerk.de, die seit dem
  21.09.2026 live ist und bis dahin nirgends im Repository vorkam
- `docs/konzept/README.md` nennt die Konzepte nicht mehr nur verbindlich, solange es
  keinen Code gibt. Code gibt es inzwischen, und verbindlich bleiben sie trotzdem: was
  gebaut wird, steht zuerst dort

- Speichern, Verknüpfen und Lesen der Dateien eines Belegs stehen an einer Stelle,
  gemeinsam für PDF, XRechnung und ZUGFeRD-PDF. Die Reihenfolge, erst die Bytes und dann
  die Zeile, darf zwischen den drei Routen nicht auseinanderlaufen

- Fassung 6 des eingefrorenen Belegstands hält vom Kunden E-Mail, USt-IdNr. und
  Käuferreferenz fest. Die E-Rechnung entsteht aus diesem Stand, und was später am Kunden
  nachgetragen wird, erreicht eine festgeschriebene Rechnung nicht mehr

- Eine Änderung an einem festgeschriebenen Beleg bekommt 409 mit dem Grund statt 404,
  und der Satz hängt an der Belegart: eine Rechnung wird storniert, auf ein Angebot folgt
  ein neues. Wer es versucht, soll erfahren, warum es nicht geht und was stattdessen

- Der Bildschirm "Geräte" im Büro heißt "Konto" und trägt den zweiten Faktor mit, damit
  jedes Konto ihn auch nachträglich und freiwillig einrichten kann

- Verzugszinsen werden über 365 Tage gerechnet statt über 360, entschieden am 20.09.2026
  als Teil der Abnahme in #31. Der Teiler war die einzige Zahl der Rechnung ohne
  Fundstelle; auf 10.000 Euro über 90 Tage zum Satz des ersten Halbjahres 2024 sind es
  311,18 statt 315,50 Euro

- Der Kommentar am Teiler der Verzugszinsrechnung behauptet keine Quelle mehr, die sich
  nicht belegen ließ, und nennt stattdessen, was an der Frage hängt. Entschieden wurde
  sie danach mit 365 Tagen

- `POST /customers` verlangt `customer.create`, ändern und entfernen weiterhin
  `customer.write`, und der Abgleich prüft neben der Entität auch, was ein Vorgang mit
  ihr tut. Eine Warteschlange ist ein anderer Weg hinein und keine andere Sache; im
  Audit-Log steht ein neuer Kunde dadurch als Anlage und nicht als Änderung

- Der Zählerschrank ist nur noch eine Anlagenart und keine Art von Verteiler mehr,
  Migration 0008 nimmt den Wert aus dem Enum. Er stand auf zwei Ebenen, ohne dass
  irgendwo stand, welche gemeint ist; nach Abschnitt 3.2 des Konzepts sind die Verteiler
  NSHV und UV und der Schrank die Anlage, in der sie hängen

- Die Webhook-Liste in Abschnitt 4.13 führt "Vorschlag entschieden". Ohne dieses
  Ereignis erfährt die Kanzlei nur durch Nachfragen, ob der Mandant einen
  Buchungsvorschlag übernommen hat
- Die Feature-Gliederung sagt die Bindung des Tokens an die Hub-Instanz nicht mehr für
  die erste Fassung zu. ADR 0006 hat am 18.09.2026 anders entschieden, rotierende
  Bearer-Token in Phase 3 und die kryptografische Bindung danach, und der Vertrag sagt
  dasselbe. Die Zusage stand an einer Stelle mit dem Zeichen für berufsrechtliche
  Relevanz

- Die zehn deutschen Shell-Variablen in `ci.yml` heißen englisch, wie die Job-Kennungen
  und die Kommentare daneben schon. Die Meldungstexte bleiben deutsch, sie stehen in der
  Actions-Oberfläche. Stehengeblieben waren sie bei der Umbenennung von `betrieb` auf
  `operations`

- Die Roadmap steht nur noch in Abschnitt 10 der Feature-Gliederung. Die Abschrift in
  der README war die Fassung aus v2.2: der Umschnitt auf den MVP-Fahrplan in v2.3 kam
  dort nie an, die Zeilen für Phase 0, 1, 2 und 4 waren zeichengleich mit dem
  Archivstand, Phase 1b fehlte ganz. Für Phase 0 nannte sie eine Fristen- und eine
  Formular-Engine, die dort nicht hingehören, und ließ die Regel-Engine weg, die
  dazugehört. An ihrer Stelle steht jetzt ein Verweis, weil eine Kopie driftet

- Der Mountpunkt des Dateispeichers gehört im Abbild dem Benutzer `node`. Docker
  übernimmt Eigentümer und Rechte eines vorhandenen Verzeichnisses in ein neues Volume,
  und ein Volume, das aus dem Nichts entsteht, gehört `root`. Die Anwendung läuft nicht
  als `root`, konnte also nicht hineinschreiben

- Die beiden Compose-Dateien und das Dockerfile folgen der Regel "Code ist immer
  Englisch": Kommentare englisch, deutsch bleibt, was ein Mensch im Betrieb als Meldung
  liest. `compose.test.yaml` sagte außerdem noch, die Datei für den Betrieb komme mit
  einem eigenen Issue, und das stimmt seit diesem Stand nicht mehr
- `@opengewerk/domain` wird gebaut statt aus dem Quelltext geladen. Ein Container kann
  kein TypeScript ausführen, solange NestJS an den Dekorator-Metadaten hängt, und die
  bringt das eingebaute Ausführen von TypeScript in Node nicht mit

- Feature-Gliederung auf v2.5: Leitentscheidung 7 sagt jetzt, dass Fragen über
  Zusammenhänge zuerst als Abfrage über Datenmodell, Regel- und Fristen-Engine gebaut
  werden und KI nur den Rest übernimmt, ohne je direkt zu schreiben. Dazu die
  Klarstellung in Abschnitt 6, dass die REST-API für Drittanbieter ein eigener Vertrag
  wird und nicht der gedehnte Kanzlei-Vertrag
- Feature-Gliederung auf v2.4: neue Leitentscheidung 9 zur Positionierung. OpenGewerk
  ist nicht die kostenlose Alternative, sondern die Software ohne künstlich beschränkte
  Funktionen. Dazu drei Festlegungen, die das tragen müssen: Einnahmen aus
  Dienstleistungen neben der Software, keine proprietären Erweiterungen auch durch das
  Projekt selbst, kein Contributor License Agreement
- Die Workflow-Dateien folgen der Regel "Code ist immer Englisch": Job-Kennungen,
  Variablen und Kommentare in den eingebetteten Skripten sind englisch. Deutsch bleibt,
  was ein Mensch liest, also die Job- und Schrittnamen in der Actions-Oberfläche und die
  Meldungen, die eine Prüfung ausgibt
- CodeQL ermittelt die zu prüfenden Sprachen aus dem Dateibestand, statt sie in einer
  Liste zu führen. Dort stand bisher nur `actions`, mit einer Notiz, sie beim ersten
  Code zu ergänzen. Wer den ersten TypeScript-Code einspielt, denkt aber nicht an diese
  Datei und hätte danach ein Scanning, das nichts scannt
- ADR 0002 bis 0008 entschieden und auf `angenommen` gesetzt. Der Tech-Stack steht:
  TypeScript mit NestJS, PostgreSQL mit Row-Level Security und Drizzle, React mit Vite
  als eine PWA, eigene Outbox für den Offline-Sync, eingebaute Auth über better-auth,
  inhaltsadressierter Dateispeicher mit PDF-Erzeugung in einem eigenen Container,
  Gewerke als Datenpakete

### Behoben

- Ohne Netz geöffnet, zeigt die Baustelle wieder Aufgaben, Dateien und Ansprechpartner (#184). Seit
  #123 öffnete sie mit dem zuletzt angemeldeten Konto, die Rollen dazu kamen aber nur vom Server,
  und ohne Antwort war jedes Recht verneint; die Daten lagen auf dem Gerät, nur die Bildschirme
  blendeten sie aus. Die Rollen werden jetzt neben dem Konto gemerkt und beim Abmelden vergessen.
  Sie erlauben nichts, jede Anfrage entscheidet der Server. Aufgefallen beim Bau der Zeiterfassung,
  die sonst ohne Netz ebenso verschwunden wäre.
- Ein neuer oder geänderter Datensatz springt nach dem Senden nicht mehr kurz zurück (#181). Der
  Postausgang ließ einen Vorgang los, sobald der Server ihn beantwortet hatte, und den Stand des
  Servers brachte erst der Abruf danach: ein gerade angelegter Kunde verschwand für diese Zeit aus
  seiner Liste, ein geänderter Wert zeigte den alten, und ein Knopf, den jemand gerade drückte,
  ging ins Leere. Angewandte Vorgänge bleiben jetzt über dem Stand liegen, bis der Abruf fertig
  ist, und zählen dabei nicht mehr als wartend. Aufgefallen beim Test der Dokumentenablage; ein
  Test zu den Titeln eines Angebots bestand bis dahin nur wegen dieses Fehlers.
- Eine Rechnung an ein Unternehmen geht nach dem Ende eines Übergangs zur E-Rechnung nicht mehr
  ohne Hinweis als PDF hinaus (#134). Der Übergang nach § 27 Abs. 38 UStG gilt nur für eine
  Rechnung, die bis zum Ende seines Zeitraums übermittelt wird, und OpenGewerk nahm dafür das
  Belegdatum: eine Rechnung vom 30.12.2026, die am 04.01.2027 per E-Mail hinausging, fiel durch.
  Jetzt zählt der Tag, an dem der Versand angefordert wird; fehlt der E-Rechnung dann etwas, wird
  er mit dem Grund und der Liste der Lücken abgelehnt. Die Karte "E-Rechnung" und das
  Festschreiben urteilen nach demselben Tag.
- Eine Belegkette verzweigt sich nicht mehr (#129). Aus einem festgeschriebenen Beleg ließen
  sich beliebig viele Folgebelege anlegen, und eine Schlussrechnung aus dem Angebot neben einer
  Abschlagsrechnung aus demselben Angebot zog nichts von ihr ab und stellte den ganzen Betrag
  ein zweites Mal. Jetzt entsteht der nächste Folgebeleg aus dem letzten Glied: die Route lehnt
  einen zweiten ab und nennt den ersten, das Büro zeigt "Weiter bei …", und die Datenbank hält
  dieselbe Regel mit einem eindeutigen Index. Den Vorgänger setzt nur noch der Server. Die
  Vorschau legt ihre Kette entsprechend an: Angebot, Auftragsbestätigung, Abschlagsrechnung,
  Schlussrechnung.
- Die Anwendung setzt die Sicherheits-Header, die ADR 0006 verlangt (#131). Die beiden Hüllen
  tragen eine strikte Content-Security-Policy, nur eigene Herkunft und nichts inline, jede
  Antwort dazu `nosniff`, `no-referrer`, `X-Frame-Options`, HSTS und die beiden
  `Cross-Origin`-Header. Bis dahin setzte der Server außer `Cache-Control` keinen einzigen, und
  die CSP als zweite Linie gegen eingeschleustes Skript fehlte. Die README sagt, dass ein Proxy
  davor sie nicht ein zweites Mal setzt.
- Ein Passwort lässt sich ändern und zurückholen (#126). Unter "Konto" mit dem bisherigen als
  Bestätigung, danach sind die anderen Geräte abgemeldet; über "Passwort vergessen?" auf der
  Anmeldung mit einem Link per Mail, eine Stunde und einmal gültig, verschickt über den
  Mailserver eines Betriebs des Zugangs; und ohne Mail mit `reset-password` auf der
  Kommandozeile, wo der Befehl das neue Passwort verdeckt abfragt. Bisher blieb ein von
  `add-staff` erzeugtes Passwort für immer gültig, und ein vergessenes hieß SQL. better-auth
  verlangt jetzt dieselben zwölf Zeichen wie der Rest.
- Die Wiederherstellungscodes lassen sich einlösen (#125). Die Ersteinrichtung zeigte sie als
  den Weg hinein, wenn das Telefon weg ist, die Anmeldung kannte aber nur den Code aus der
  App; ein Inhaber ohne Telefon kam nur noch über SQL an seinen Betrieb. Der zweite Schritt
  der Anmeldung nimmt jetzt auch einen Wiederherstellungscode und sagt danach, wie viele noch
  übrig sind. Unter "Konto" steht die Zahl, und dort entstehen nach dem Passwort neue. Die
  Ratenbegrenzung gilt für das Einlösen wie für den Code aus der App, fünf Versuche in der
  Minute.
- Ein Gerät bleibt angemeldet, solange es benutzt wird (#124). Das Cookie galt nur zwölf
  Stunden, die Laufzeit des Büros, und so war auch jedes Gerät auf der Baustelle nach zwölf
  Stunden abgemeldet, obwohl seine Sitzung dreißig Tage galt; verlängert wurde keine. Das
  Cookie lebt jetzt dreißig Tage, die Sitzung in der Datenbank entscheidet, und eine
  benutzte Sitzung bekommt ihre volle Laufzeit ab der letzten Benutzung, zwölf Stunden im
  Büro, dreißig Tage auf einem Gerät.
- Die Baustelle öffnet ohne Netz den Betrieb, in dem zuletzt jemand angemeldet war, mit den
  Aufträgen auf dem Gerät (#123). Bisher blieb sie beim Start ohne Verbindung beim Warten
  stehen oder zeigte die Anmeldung. Das Gerät merkt sich dafür, wer zuletzt wo angemeldet war,
  keinen Schlüssel; der Server entscheidet wieder, sobald er antwortet.
- Passkeys sind vorerst abgeschaltet (GHSA-jghx-6wmh-mpcj). Das Plugin war eingeschaltet,
  ohne dass es eine Oberfläche dafür gab: jede Sitzung konnte ohne Bestätigung einen Passkey
  registrieren, die Anmeldung damit umging den zweiten Faktor, und niemand konnte die
  Passkeys eines Kontos sehen oder widerrufen. Das Paket ist entfernt, die Pflicht zum
  zweiten Faktor nennt nur noch die Authenticator-App. Wie sie zurückkommen, steht in #167.
- Der Mailserver eines Betriebs muss im Internet liegen und auf einem Port für E-Mail
  antworten (GHSA-5664-h6fc-v729). Bisher verband sich die Instanz mit jedem Ziel aus den
  E-Mail-Einstellungen, auch mit sich selbst und der eigenen Datenbank, und die Prüfung gab
  die Antwort des Gegenübers wörtlich zurück. Der Name wird einmal aufgelöst, die Verbindung
  geht an die geprüfte Adresse, beim Prüfen wie beim Versand. Ein Mailserver im eigenen Netz
  braucht die neue Variable `MAIL_INTERNAL_HOSTS`; die Prüfung nennt nur noch die Art des
  Fehlers und ist auf dreißig Versuche in zehn Minuten je Betrieb begrenzt.
- Jede Route, die etwas ändert, prüft jetzt die Herkunft der Anfrage und nimmt nur JSON an
  (GHSA-r7rq-234g-3jx8). Bisher taten das nur die Anmeldung, die Ersteinrichtung und die
  Einladung; der Rest verließ sich auf `SameSite=Lax`, und das hält eine Seite auf einer
  anderen Subdomain derselben Domain nicht ab. Der Parser für Formulare ist aus, das Logo
  nennt seine Bildtypen selbst. Wer die Oberfläche mit Vite gegen einen eigenen Server
  entwickelt, trägt die Adresse von Vite in `TRUSTED_ORIGINS` ein.
- Eine Rechnung, die am 1. Januar zwischen 0 und 1 Uhr festgeschrieben wurde, bekam das alte
  Jahr in die Nummer (#146). Das Jahr kam aus der Zeitzone des Prozesses, und ein Container
  läuft in UTC. Es kommt jetzt aus dem Tag in Deutschland, wie das Belegdatum; ebenso die
  Vorschau der nächsten Nummer unter "Nummernkreise".
- Ein Vorgang, den der Server ablehnte, hielt den Postausgang eines Geräts für immer fest
  (#120). Die 400 sagte nicht, welcher es war, das Gerät schickte bei jedem Abgleich
  denselben Stapel und bekam dieselbe Antwort, und weil es erst hochlädt und dann abholt,
  kamen auch keine neuen Aufträge mehr an. Die Antwort nennt den Vorgang jetzt, bei einem
  Fehler des Clients, bei einem fehlenden Recht und bei einer Prüfung der Datenbank, die
  vorher niemand gefragt hat. Das Gerät holt trotzdem ab, die Leiste sagt, dass eine
  Änderung nicht angenommen wird, und der Konfliktbildschirm zeigt sie mit dem Satz des
  Servers: verwerfen, dann geht der Rest hinaus, oder erneut senden, wenn der Grund
  inzwischen behoben ist. Ein verworfenes Anlegen nimmt die späteren Änderungen an
  demselben Eintrag mit, weil keine davon ohne es landen kann
- Ein Leistungszeitraum, dessen letzter Tag vor dem ersten lag, ließ im Büro die ganze
  Übertragung scheitern und mit ihr alles, was danach in den Postausgang kam (#118); ein
  Name über 200 Zeichen tat dasselbe mit einer Unterschrift auf der Baustelle. Beide
  Formulare fragen die Regel jetzt vor dem Einreihen, mit dem Satz, der sagt, was falsch
  ist. Der Abgleich fragt sie ebenfalls, zusammen mit den übrigen Checks an seinen Tabellen,
  die er bisher der Datenbank überließ: Position ab 1, ein Titel ohne Menge und Preis, die
  Angabe zum Gerät. Ändern zwei Leute je einen Tag des Leistungszeitraums so, dass jede
  Änderung für sich passt und beide zusammen nicht, wird die zweite ein Konflikt für diesen
  einen Vorgang, und der Rest der Übertragung landet
- Ein Kontakt, den ein Gerät ohne Kunde und ohne Objekt anlegte, ließ die ganze Übertragung
  scheitern (#116): die Datenbank lehnte ihn mit "Die Angaben passen nicht zum Datenmodell."
  ab und mit ihm alles, was im selben Stapel stand, und beim nächsten Abgleich kam derselbe
  Stapel wieder. Der Abgleich fragt die Regel jetzt vorher (`contactParentProblem` in
  `domain`). Ohne Kunde und Objekt ist es ein Konflikt für diesen einen Vorgang, wie bei
  jedem Datensatz ohne den Elternteil, den er haben muss; mit beidem lehnt er die Übertragung
  mit einem Satz ab, der sagt, was falsch ist, weil so etwas nur ein fehlerhafter Client
  schickt. Eine Oberfläche, die Kontakte anlegt, gibt es noch nicht
- Die Korrekturen aus Migration 0029 an den mitgelieferten Belehrungen sind auf keiner
  Installation angekommen, die ihre Belehrungen schon vorher hatte. Widerrufsbelehrung,
  Formular und Vordruck blieben dort auch dem Kostenvoranschlag vorgeschlagen, und das
  Formular stand vor den neuen Hinweisen zum Erlöschen statt dahinter. Migrationen laufen
  als Eigentümer der Tabellen und sehen unter `FORCE ROW LEVEL SECURITY` keine Zeile eines
  Betriebs, die vier `UPDATE`s liefen also ins Leere und meldeten trotzdem Erfolg.
  Migration 0032 wiederholt sie mit aufgehobenem `FORCE` und nennt im Audit-Log
  `migration` als Grund
- Auch außerhalb der Anlagenstruktur ließ sich ein Datensatz an den eines anderen Betriebs
  hängen, wenn dessen Kennung bekannt war: ein Objekt an einen fremden Kunden, ein Auftrag
  an eine fremde Anlage, eine Aufgabe an einen fremden Auftrag, insgesamt 29 Verweise
  (#113). Sie laufen jetzt alle über Betrieb und Kennung zusammen (Migration 0031). Die
  Routen lehnen so einen Verweis vorher mit 422 und dem Feld im Satz ab, der Abgleich als
  Konflikt für den einen Vorgang, und beide nehmen auch einen gelöschten Datensatz nicht
  mehr an, den der Schlüssel noch nähme. Zeigt auf einer Installation schon eine Zeile über
  die Grenze, bricht das Update mit Tabelle, Spalte und Anzahl ab, statt daran etwas
  umzubiegen, denn wem die Zeile gehört, kann keine Migration wissen
- Ein Betrieb konnte über den Abgleich einen Verteiler, ein Feld, einen Stromkreis oder ein
  Betriebsmittel an den Datensatz eines anderen Betriebs hängen, wenn er dessen Kennung
  kannte, denn PostgreSQL prüft einen Fremdschlüssel an der Row-Level Security vorbei. Die
  Schlüssel der Anlagenstruktur laufen jetzt über Betrieb und Kennung zusammen, und der
  Abgleich lehnt so einen Vorgang vorher als Konflikt ab, statt dass die Datenbank die ganze
  Übertragung scheitern lässt
- Ein Feld mit Stromkreisen ließ sich nicht endgültig entfernen, und damit auch kein
  Verteiler und keine Anlage darüber: der Schlüssel vom Stromkreis zum Feld leerte beim
  Entfernen beide Spalten, den Verteiler eingeschlossen, und der ist Pflicht. Die Anwendung
  entfernt nichts endgültig, darum fiel es nicht auf; jetzt wird nur das Feld geleert

- Die Karte "E-Rechnung" knüpft den Übergang nach § 27 Abs. 38 UStG an die Übermittlung
  der Rechnung, wie das Gesetz, und nicht an ihre Ausstellung. Bei Kleinbetrag und
  Kleinunternehmer sagt sie, dass ein PDF die Zustimmung des Kunden braucht; vorher hieß
  es, eine solche Rechnung dürfe immer als PDF gehen, und das stimmt nur für Papier

- Die PDF-Vorlage nimmt dieselben Zeichen heraus wie die E-Rechnung: Steuerzeichen außer
  Tabulator und Zeilenumbruch und was XML 1.0 sonst nicht tragen kann. Chromium zeichnete
  ein solches Zeichen als sichtbares Kästchen, das PDF und die E-Rechnung derselben
  Rechnung wichen darum um ein Zeichen voneinander ab. Beide lesen die Zeichenklasse
  jetzt an einer Stelle; ein schon gespeichertes PDF bleibt, wie es gedruckt wurde

- Ein Beleg aus dem Postausgang bekommt denselben Vorschlag zum Steuerfall wie einer
  über die Route. Bis dahin kam er mit der Vorgabe an, und ein Kleinunternehmer hätte
  später eine Rechnung mit Umsatzsteuer daraus gemacht
- Ein auf dem Gerät angelegter Beleg lehnte seine eigene erste Position als
  festgeschrieben ab, weil ihm der Status fehlte, den nur der Server setzt. Die
  Abgleichrichtlinie nennt jetzt unter `createdAs` den Startzustand solcher Felder, und
  ein Test verlangt ihn für jede Regel auf einem reservierten Feld
- Eine Fassung, die eine Entität nicht kannte, schob den Abgleich-Cursor über deren
  Zeilen hinweg, und unterschriebene Berichte blieben danach dauerhaft ohne Unterschrift.
  Das Gerät merkt sich jetzt die Entitäten neben dem Cursor und fängt von vorn an, sobald
  die laufende Fassung eine mehr kennt

- Der Abgleich-Client lehnte jede neue Position auf dem Gerät ab, weil er ihren Beleg nur
  am gespeicherten Datensatz suchte; eine neue Position gibt es aber nur in der
  Operation, die sie anlegt. Das lag seit der ersten Oberfläche im Code und fiel erst mit
  dem ersten Bildschirm auf, der Positionen anlegt
- Die Fundstelle des Kostenanschlags in der Feature-Gliederung ist § 649 BGB und nicht
  § 650, korrigiert in v2.6. Seit der Reform des Bauvertragsrechts zum 01.01.2018 regelt
  § 650 den Werklieferungsvertrag

- `add-staff` legt Konto und Zugehörigkeit wirklich in einer Transaktion an. Sein
  Kommentar behauptete "alle drei oder keines", umgesetzt waren es drei Commits mit zwei
  Lücken

- Umgeschriebene Umlaute in den Kommentaren von `pnpm-workspace.yaml` und
  `.prettierignore`, teils neben richtig gesetzten im selben Absatz, und ein deutscher
  Bezeichner in einem Test, der nach der Sprachregel englisch gehört. Die neue Prüfung
  fand drei Stellen mehr als der Blick von Hand

- Die Feature-Gliederung nannte in Abschnitt 1.1 den Wechselrichter als Anlage und
  widersprach damit ihrem eigenen Abschnitt 3.2, nach dem sich der Code richtet

- Der Basiszinssatz für das erste Halbjahr 2023 war falsch. Das Paket führte den Satz
  von minus 0,88 Prozent bis zum 30.06.2023, tatsächlich endete er am 31.12.2022; ab
  dem 01.01.2023 sind es 1,62 Prozent. Auf eine Forderung von 10.000 Euro, 90 Tage
  überfällig, gegenüber einem Unternehmen ergab das 203,00 Euro Verzugszins statt
  265,50 Euro. Gefunden beim Eintragen der neuen Werte, indem die vorhandenen gegen
  dieselbe Tabelle gehalten wurden

- Die Anwendungsrolle darf `tenants` nur noch lesen. Migration 0001 vergab pauschal auf
  alle damals vorhandenen Tabellen, jede spätere Tabelle bekam einen zugeschnittenen
  Grant, `tenants` behielt den weiten. Gelesen wurde nie etwas Fremdes, dafür sorgt die
  Policy, aber ein Mandant konnte sich umbenennen und seine eigene Zeile löschen, und
  die Fremdschlüssel wären mitgegangen

- Zwei Kommentare behaupteten weiterhin, die Nummernvergabe sei nicht durchgesetzt.
  Durchgesetzt ist sie seit dem Zähler unter Zeilensperre, dem Trigger und dem
  partiellen Unique-Index. Die Schema-Datei widersprach sich vierzig Zeilen tiefer sogar
  selbst
- Umschriebene Umlaute an vier Stellen: in den Kommentaren der Rücknahme zu `0000`, im
  Testpasswort und in einem Kundennamen im Test. Der CI-Job prüft nur UTF-8, BOM und
  Zeilenenden, ASCII-Umschreibungen sieht er nicht
- `resetSchema()` setzt das Passwort der Eigentümerrolle auch dann, wenn die Rolle schon
  da ist. Vorher wurde es nur beim Anlegen gesetzt: eine Änderung daran ging in der CI
  durch, weil dort jede Datenbank frisch ist, und riss lokal die gesamte Testsuite an
  der Anmeldung. Aufgefallen beim Umlaut im Testpasswort
- Der Delta-Pull überspringt keine Änderungen mehr. Die Obergrenze je Abruf wirkt je
  Entität, der Cursor war aber das Höchste, was im ganzen Abruf vorkam. Hatte eine
  Entität mehr ausstehende Änderungen als hineinpassen und eine andere eine einzige mit
  einer höheren Nummer, fiel alles dazwischen für immer aus dem Fenster, ohne Fehler und
  ohne Hinweis. Der Cursor bleibt jetzt bei der niedrigsten ausgeschöpften Entität
  stehen, und die Antwort trägt ein `hasMore`
- Ein Beleg, der gelöscht wurde, lässt sich nicht mehr festschreiben. Das Löschen setzt
  nur `deletedAt` und lässt den Status auf `draft`, es griff also weder die
  Statusprüfung noch der Trigger. Was herauskam, war eine verbrauchte Nummer, ein
  Eintrag in der Hashkette und ein unveränderlicher Beleg, den `GET /documents` nie
  wieder zeigt. Die Bedingung steht jetzt auch am Update, sonst bliebe der Wettlauf
  zwischen Löschen und Festschreiben bestehen
- Eine Änderung an einem gelöschten Datensatz wird im Abgleich zum Konflikt und nicht
  mehr angewendet. Weil nichts wirklich entfernt wird, findet der Abgleich die Zeile
  weiterhin, quittierte die Änderung mit "angewendet" und schrieb sie auf einen
  Datensatz, den keine Liste mehr zeigt. Ein wiederholtes Löschen zählt dabei als
  übersprungen: eine doppelt gesendete Warteschlange ist keine Meinungsverschiedenheit
- Ein Löschen über den Abgleich kollidiert mit einer Änderung, die inzwischen jemand
  anders gemacht hat. Es trägt keine Feld-Patches, der Feldvergleich lief also ins Leere
  und jedes Löschen ging durch. Maßgeblich ist jetzt die Basisversion
- `deletedAt` steht in der Liste der Spalten, die nur der Server schreibt. Als
  gewöhnliches Feld gesetzt wäre es ein Löschen an der Löschregel vorbei, auf null
  zurückgesetzt eine Wiederherstellung, die niemand veranlasst hat
- Belege können über den Abgleich nicht mehr festgeschrieben werden. `status`, `number`
  und `issuedAt` sind dem Server vorbehalten, die Prüfung sitzt in der
  Merge-Entscheidung und ein zweites Mal vor dem Schreiben. Über `POST /sync` genügte
  `document.write`, und der Trigger hält nur `UPDATE` und `DELETE` auf, beim Anlegen ist
  er nicht beteiligt
- Gedankenstriche in der Feature-Gliederung und in den ADRs durch Doppelpunkt,
  Komma, Semikolon oder Punkt ersetzt, Zahlenbereiche durch einfache Bindestriche
- Übrig gebliebene Kopie der alten Roadmap-Tabelle aus der Feature-Gliederung
  entfernt, sie stand ohne Überschrift und mit unvollständiger Kopfzeile unter
  der neuen Tabelle
