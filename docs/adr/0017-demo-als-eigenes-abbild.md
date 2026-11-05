---
status: angenommen
date: 2026-11-05
decision-makers: Projektleitung OpenGewerk
consulted: Feature-Gliederung v2.77 (9), Planungskonzept der Haustechnik v0.96 (10), ADR 0006, ADR 0010, die Vorschau unter `packages/server/src/preview/`
informed: Mitwirkende der Organisation opengewerk
---

# Die Demo als eigenes Abbild im selben Repository

## Kontext und Problemstellung

Die Handwerkersoftware und OpenGewerk Haustechnik bekommen je eine öffentliche Demo zum Ausprobieren (Feature-Gliederung, Abschnitt 9; Meilenstein „Demo“, #857, #858, #859). Wer sie ansieht, meldet sich mit „Demo“ und dem Passwort „Demo“ an, wer etwas ausprobieren will, mit „admin“ und „admin“.

Das widerspricht drei Regeln, die jede Instanz hält: Angemeldet wird mit einer E-Mail-Adresse, ein Passwort hat mindestens 12 Zeichen, und wer einen Betrieb führt, hat einen zweiten Faktor (ADR 0006). Dazu kommen Sperren, die es in keiner Instanz gibt: ein Zugang, der nichts ändert, auch dort nicht, wo sonst kein Recht gefragt ist, und ein Zugang, der sein eigenes Konto nicht ändern darf.

Diese Ausnahmen dürfen nie in eine Instanz mit echten Daten geraten, auch nicht durch eine vergessene Einstellung. Zugleich müssen die Sperren mit der Anwendung mitwachsen: Eine neue Route, die etwas ändert oder nach außen geht, darf in der Demo nicht offen stehen, nur weil beim Bau niemand an die Demo gedacht hat.

Daraus folgt die Frage: Wo liegt der Code der Demo, und wie entsteht ihr Abbild?

## Entscheidungstreiber

- Kein Weg, auf dem eine Ausnahme der Demo eine Instanz erreicht: nicht über eine Einstellung, nicht über die `.env`, nicht über ein Abbild.
- Eine neue Route fällt in dem Pull Request auf, der sie bringt, nicht erst beim nächsten Release.
- Ein Release kostet für die Demo keine eigenen Pull Requests.
- Das Fundament kennt keine Anwendung (ADR 0010); was beide Demos gleich brauchen, steht einmal da.
- Die Beispieldaten gibt es schon, in der Vorschau beider Anwendungen; sie werden nicht ein zweites Mal geschrieben.

## Betrachtete Optionen

1. Je ein eigenes Repository für die Demo, mit der Anwendung als Git-Submodul
2. Ein Schalter in der Konfiguration der Instanz, der die Demo einschaltet
3. Ein eigenes Abbild aus demselben Repository: ein Paket der Demo im Fundament, eines je Anwendung, und das Abbild einer Instanz ohne beide

## Entscheidung

Gewählt: **Option 3**, besprochen mit Moritz am 05.11.2026.

- **Im Fundament** ein Paket der Demo unter `packages/platform/`: die Sperre für den Zugang, der nur liest, die Sperrliste für den, der schreibt, die Anmeldung mit Namen und die Ausnahmen für die beiden Zugänge, die leere Liste der anderen Sitzungen, die Grenzen für das Hochladen und das Zurücksetzen. Es kennt keine Anwendung; welche Routen gesperrt sind, welche Rollen die Zugänge haben und welche Daten gepflanzt werden, sagt die Anwendung.
- **Je Anwendung** ein Paket `packages/demo` mit ihren Rollen, ihrer Sperrliste und ihrem Einstieg, dazu ein eigenes Abbild der Demo. Die Beispieldaten kommen aus der Vorschau; wo sie dafür an eine andere Stelle ziehen, bleiben sie für Vorschau und Demo dieselben.
- **Das Abbild einer Instanz enthält keines dieser Pakete.** Wie bei der Vorschau (`.dockerignore`, `tsconfig.build.json`) halten Bau und Abbild sie heraus, und ein Test der CI wird rot, sobald etwas daraus im Abbild einer Instanz landet. Einen Schalter, der eine Instanz zur Demo macht, gibt es nicht.
- **Ein Release baut beide Abbilder aus demselben Tag.** Die Haustechnik bekommt den Teil des Fundaments mit dem nächsten Anheben des Submoduls (opengewerk-haustechnik#599).

### Konsequenzen

- Gut: Die Prüfung, dass jede ändernde Route den lesenden Zugang abweist, läuft in jedem Pull Request mit; eine neue Route fällt dort auf.
- Gut: keine weiteren Repositories, keine weiteren Submodule und kein eigener Takt für Releases der Demo.
- Gut: Der Quelltext der Demo ist öffentlich, im Repository der Anwendung, wie die AGPL es für einen Dienst im Netz verlangt.
- Schlecht: Das Repository trägt Code, den keine Instanz ausführt, und die CI baut ein Abbild mehr.
- Schlecht: Der Zaun um die Demo hängt an Bau und Test; wer den Bau ändert, muss ihn mitdenken.

## Bestätigung

Mit dem Bau kommen zwei Tests, die diese Entscheidung halten: einer durchsucht das Abbild einer Instanz nach dem Teil der Demo, der andere ruft alle Routen mit dem lesenden Zugang auf und erwartet für jede ändernde eine Ablehnung, dazu die Sperrliste für den schreibenden. Beide bekommen eine Gegenprobe.

## Vor- und Nachteile der Optionen

### Option 1: eigene Repositories mit der Anwendung als Submodul

- Gut: Der Code der Demo steht nicht im Repository der Anwendung.
- Schlecht: Eine neue Route fällt erst beim Anheben des Submoduls auf, womöglich nachdem die Demo die neue Fassung schon ausliefert.
- Schlecht: Jedes Release kostet je Demo einen Pull Request mit CI-Lauf; bei der Haustechnik läge ein Submodul im Submodul.
- Schlecht: Anmeldeseite, Hinweis und die leere Liste der Sitzungen brauchen ohnehin Ansatzpunkte in der Anwendung; das eigene Repository hielte nur, was sie verbindet.

### Option 2: ein Schalter in der Konfiguration

- Gut: am wenigsten zu bauen, ein Abbild für alles.
- Schlecht: Die Ausnahmen stehen in jeder Instanz bereit; eine falsche Zeile in der `.env` macht aus einer Instanz mit echten Daten eine Demo mit bekanntem Passwort.

### Option 3: eigenes Abbild aus demselben Repository

- Gut: siehe Konsequenzen.
- Schlecht: ein Abbild mehr in CI und Release.

## Weitere Informationen

- Feature-Gliederung v2.77, Abschnitt 9; Planungskonzept der Haustechnik v0.96, Abschnitt 10.
- #857 (Abbild, Beispieldaten, Zurücksetzen), #858 (Zugänge und Sperren), #859 (Server der Demos), opengewerk-haustechnik#599 (Demo der Haustechnik), opengewerk-website#49 (Seite und Nutzungsbedingungen).
