<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo-dark.svg">
    <img alt="OpenGewerk" src="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo.svg" width="420">
  </picture>
</p>

<p align="center"><strong>Open-Source-Handwerkersoftware: self-hosted CRM &amp; ERP für Handwerksbetriebe</strong></p>

<p align="center">
  <a href="https://github.com/opengewerk/opengewerk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/opengewerk/opengewerk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/opengewerk/opengewerk/releases"><img alt="Neueste Fassung" src="https://img.shields.io/github/v/release/opengewerk/opengewerk"></a>
  <a href="LICENSE"><img alt="Lizenz AGPL-3.0" src="https://img.shields.io/github/license/opengewerk/opengewerk"></a>
</p>

## Was ist OpenGewerk?

OpenGewerk ist eine Open-Source-Handwerkersoftware, die CRM und ERP in einem einzigen Datenmodell zusammenführt: Kunde, Objekt, Anlage, Auftrag, Beleg, Buchung. Sie ist self-hosted, läuft also auf dem eigenen Server des Betriebs, und die Daten bleiben dort. Lizenzkosten und Tarifstufen gibt es nicht. Weil es keine getrennten Module gibt, braucht es auch keine Schnittstellen zwischen ihnen. Kernmodul ist Elektro und PV; weitere Gewerke entstehen auf derselben Formular- und Fristen-Engine. Die Baustellen-App arbeitet ohne Netz, denn im Keller und am Zählerschrank gibt es oft keins. Belege werden nach GoBD festgeschrieben und nie gelöscht, ein Fehler wird storniert.

Wie es sich von anderer Handwerkersoftware unterscheidet und was es einmal können soll, steht in [Funktionsumfang und Stand](docs/funktionsumfang.md). Bilder der Oberfläche zeigt [opengewerk.de](https://opengewerk.de/funktionen/), den Vergleich mit openHandwerk, plancraft, HERO, Odoo, Dolibarr und ERPNext die Seite [Vergleich](https://opengewerk.de/alternativen/).

## Stand

Das Fundament (Phase 0) und das MVP für den Pilotbetrieb (Phase 1) sind gebaut, die neueste Fassung steht unter [Releases](https://github.com/opengewerk/opengewerk/releases). Ein Betrieb schreibt damit Angebote, Auftragsbestätigungen und Rechnungen, an Unternehmen auch als E-Rechnung im Format XRechnung oder ZUGFeRD. Auf der Baustelle entstehen Regiebericht und Zeiterfassung, der Kunde unterschreibt auf dem Gerät; für Elektro gibt es das Stromkreisverzeichnis und das Prüfprotokoll der Erstprüfung nach DIN VDE 0100-600. An Phase 2, dem Kern für Elektro und PV, wird gearbeitet, im [Meilenstein Phase 2](https://github.com/opengewerk/opengewerk/milestone/3). Die Buchhaltung kommt mit Phase 3.

> **Noch nicht für den produktiven Einsatz.** Vorher stehen die fachliche Abnahme der Regelpakete und Grenzwerte ([#31](https://github.com/opengewerk/opengewerk/issues/31)) und ein Praxistest der E-Rechnung bei einem echten Empfänger ([#133](https://github.com/opengewerk/opengewerk/issues/133)) aus.

## Schnellstart

Gebraucht werden Docker und Docker Compose ab 2.22. Aus dem entpackten Paket einer [Fassung](https://github.com/opengewerk/opengewerk/releases) oder aus einem Checkout des Repositorys, unter Windows in Git Bash:

```bash
sh docker/start.sh
```

Beim ersten Start legt das Skript `docker/.env` an, erzeugt jedes Passwort und jeden Schlüssel selbst und fragt nur nach der Adresse, unter der OpenGewerk im Browser erreichbar sein soll. Danach läuft die Instanz auf `127.0.0.1:23700`:

- Im Browser richtet man sie mit dem Einrichtungscode aus `docker/.env` ein, danach ist `/` das Büro und `/m` die Baustelle.
- Davor gehört ein Reverse Proxy mit TLS; Vorlagen für Apache und nginx liegen unter [`docker/proxy/`](docker/proxy/).
- Jede Nacht sichert sich die Instanz selbst. Ein Update ist derselbe Befehl im Ordner der neuen Fassung.

Alles Weitere, vom ersten Zugang über E-Mail, Sicherung und Rückspielen bis zum Aktualisieren, steht in der Anleitung zum [Betrieb](docs/betrieb.md).

## Dokumentation

| Was | Wo |
| --- | --- |
| Funktionsumfang, Vergleich, Stand und Fahrplan | [`docs/funktionsumfang.md`](docs/funktionsumfang.md) |
| Betrieb: Installation, Zugänge, E-Mail, Sicherung, Aktualisieren, Reverse Proxy | [`docs/betrieb.md`](docs/betrieb.md) |
| Entwicklung: Werkzeuge, Pakete, Vorschau und wie jeder Baustein gebaut ist | [`docs/entwicklung.md`](docs/entwicklung.md) |
| Konzept, die verbindliche Quelle für den Funktionsumfang | [`docs/konzept/`](docs/konzept/) |
| Architekturentscheidungen | [`docs/adr/`](docs/adr/) |
| Änderungen je Fassung | [`CHANGELOG.md`](CHANGELOG.md) |

## Projektfamilie

- [`opengewerk`](https://github.com/opengewerk/opengewerk): diese Handwerkersoftware, dazu das Fundament, auf dem jede Anwendung der Familie steht.
- [`opengewerk-haustechnik`](https://github.com/opengewerk/opengewerk-haustechnik): Open-Source-CAFM für Betreiber von Gebäuden und ihre Haustechnik, auf demselben Fundament.
- [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei): der Kanzlei-Hub, mit dem ein Steuerberater seine Mandanten bearbeitet, ohne dass die Daten den Betrieb verlassen.
- [`opengewerk-api-spec`](https://github.com/opengewerk/opengewerk-api-spec): der API-Vertrag zwischen Handwerkersoftware und Kanzlei-Hub.
- [opengewerk.de](https://opengewerk.de): die Website des Projekts.

## Hilfe und Mitmachen

Gerade jetzt zählt jede fachliche Rückmeldung aus dem Betriebsalltag mehr als Code.

- Fragen und Ideen gehören in die [Discussions](https://github.com/opengewerk/opengewerk/discussions), kurze Fragen auch auf den [Discord-Server](https://discord.gg/NRrEvbQdxz). Zum Austausch unter Betrieben gibt es [r/OpenGewerk](https://www.reddit.com/r/OpenGewerk/).
- Fehler und Wünsche laufen über die [Issue-Vorlagen](https://github.com/opengewerk/opengewerk/issues/new/choose).
- Eine Sicherheitslücke bitte nicht öffentlich melden, sondern wie in der [SECURITY.md](https://github.com/opengewerk/.github/blob/main/SECURITY.md) beschrieben.
- Wer Code beitragen will, liest die [CONTRIBUTING.md](https://github.com/opengewerk/.github/blob/main/CONTRIBUTING.md) und die [Entwicklung](docs/entwicklung.md); es gilt der [Verhaltenskodex](https://github.com/opengewerk/.github/blob/main/CODE_OF_CONDUCT.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer OpenGewerk als Dienst für andere betreibt, gibt seine Änderungen zurück.
