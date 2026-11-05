# Technische und organisatorische Maßnahmen{{for}}

- **Erzeugt:** {{made}}

---

## Was dieses Dokument ist

Die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO, als Anlage 1 zum Vertrag zur Auftragsverarbeitung. Teil A sagt, was die Anwendung mitbringt, und ist auf jeder Instanz derselben Fassung gleich; die Vorlage des Vertrags auf opengewerk.de zeigt denselben Teil A. Teil B und Anlage 2 trägt ein, wer die Instanz betreibt, im Bereich der Instanz unter „Maßnahmen“; {{part-b-changed}}.

## Teil A: Was die Anwendung mitbringt

### A.1 Anmeldung

- Ein Konto entsteht nur bei der Ersteinrichtung, über eine Einladung des Betriebs oder über die Kommandozeile des Servers; eine offene Registrierung gibt es nicht.
- Angemeldet wird mit Passwort oder Passkey. Das Passwort steht nur als Hash in der Datenbank (Argon2id).
- Der zweite Faktor, ein Code aus einer App, ist Pflicht für den Inhaber eines Betriebs und für den Betreiber der Instanz und für alle anderen empfohlen. Er steht verschlüsselt in der Datenbank.
- Versuche der Anmeldung werden je Netzadresse und Weg für kurze Zeit gezählt und begrenzt.
- Eine Sitzung endet nach zwölf Stunden, ein Gerät für die Arbeit ohne Netz bleibt dreißig Tage angemeldet. Wird ein Zugang gesperrt oder ist sein letzter Tag vorbei, endet, was die Person im Betrieb offen hat.
- Das Cookie der Sitzung geht nur über eine verschlüsselte Verbindung, und Anfragen, die von einer fremden Seite kommen, nimmt der Server nicht an.

### A.2 Rechte und Trennung

- Jede Rolle hat feste Rechte, die mitgelieferten Inhaber, Büro und Monteur wie die eigenen eines Betriebs. Der Server prüft das Recht an jeder Adresse, die er beantwortet.
- Die Datenbank trennt die Betriebe einer Instanz Zeile für Zeile, auch gegenüber dem Eigentümer der Tabellen. Zwei Betriebe auf derselben Instanz sehen nichts voneinander.
- Das Änderungsprotokoll, die Zugänge und die Auskünfte über Personen sieht nur der Inhaber. Eine Krankheit sieht in ihrer Art nur, wer Abwesenheiten pflegt.
- Wer die Instanz verwaltet, sieht je Betrieb den Namen und wer ihn führt, und nichts von dem, was in ihm steht.

### A.3 Übertragung

- Die Anwendung verlangt eine verschlüsselte Verbindung: das Cookie der Sitzung ist darauf beschränkt, und der Server setzt Strict-Transport-Security. Die Verschlüsselung selbst stellt der vorgeschaltete Webserver her (B.4).
- Eine Content-Security-Policy erlaubt dem Browser nur Verbindungen zur eigenen Instanz. Inhalte von fremden Servern, Telemetrie und einen Lizenzserver gibt es nicht.
- Die E-Mails eines Betriebs gehen über dessen eigenen Mailserver. Das Passwort eines Mailservers steht versiegelt in der Datenbank und wird nie wieder angezeigt.
- Eine Push-Nachricht ist auf dem Weg über den Push-Dienst des Browsers verschlüsselt.

### A.4 Integrität und Eingabekontrolle

- Jede Änderung steht im Änderungsprotokoll mit Feld, Wert davor und danach, wer, wann und von welchem Gerät. Die Einträge sind zu einer Kette verbunden, die sich prüfen lässt; ein Wert eines gelöschten Datensatzes wird geschwärzt, ohne die Kette zu brechen.
- Ein festgeschriebener Beleg und ein unterschriebenes Protokoll lassen sich nicht mehr ändern, das sichert die Datenbank selbst.
- Die Werte eines Zugangs zum Objekt, etwa der Code eines Schlüsseltresors, stehen versiegelt in der Datenbank, und jedes Anzeigen steht im Änderungsprotokoll.
- Eine Datei liegt unter dem Fingerabdruck ihres Inhalts; eine beschädigte Datei erkennt die Anwendung und gibt sie nicht heraus.

### A.5 Verfügbarkeit und Wiederherstellung

- Die Sicherung der Datenbank und der Dateien läuft jede Nacht ohne Zutun und ist verschlüsselt, bevor sie den Server verlässt.
- Beim Rückspielen prüft die Anwendung jede Datei gegen ihren Fingerabdruck.

### A.6 Geräte der Nutzer

- Ein Gerät hält nur, was die Person für ihre Arbeit braucht, und arbeitet damit auch ohne Netz.
- Beim Abmelden löscht die Anwendung, was auf dem Gerät liegt.

### A.7 Datenschutz durch Technikgestaltung

- Das Löschkonzept schlägt fällige Datensätze nach seinen Fristen vor und löscht sie wirklich; was auf Geräten liegt, wird dort geleert.
- Den Standort beim Beginn und Ende einer Arbeitszeit hält die Anwendung nur mit Einwilligung der Person fest.
- Eine Auskunft nach Art. 15 und 20 DSGVO entsteht aus den Daten selbst, mit allem, was die Anwendung zu einer Person hält.

## Teil B: Was der Auftragsverarbeiter beim Betrieb sicherstellt

{{part-b}}

## Anlage 2: Unterauftragsverarbeiter

{{subprocessors}}
