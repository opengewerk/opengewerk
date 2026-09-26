![OpenGewerk](https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo@2x.png)

**Self-hosted CRM und ERP für Handwerksbetriebe**, mit Elektro und Photovoltaik als erstem Gewerk. Büro und Baustelle arbeiten in einer Anwendung, die Baustelle auch ohne Netz, und die Daten bleiben beim Betrieb. Open Source unter AGPL-3.0, durchgehend auf Deutsch.

## Was drin ist

- Kunden, Objekte, Anlagen und Aufträge, im Büro und auf der Baustelle
- Angebot, Auftragsbestätigung und Regiebericht mit Unterschrift des Kunden auf dem Gerät
- Rechnungen mit Abschlägen und Storno, als PDF und als E-Rechnung (XRechnung, ZUGFeRD)
- Zeiterfassung, Fotos und Dateien, Aufgaben und Versand per E-Mail
- Elektro: die Struktur einer Anlage bis zum Stromkreis, das Stromkreisverzeichnis und das Prüfprotokoll nach DIN VDE 0100-600
- Festschreibung nach GoBD, ein Audit-Log mit Hashkette und eine Sicherung jede Nacht

## Installieren

Dieses Abbild allein ist noch keine Installation. Dazu gehören PostgreSQL, der Lauf der Migrationen, die nächtliche Sicherung und ein Renderer für die PDFs, und all das bringt das Paket von der [Release-Seite](https://github.com/opengewerk/opengewerk/releases) mit:

```bash
tar --no-same-owner -xzf opengewerk-<fassung>.tar.gz
cd opengewerk && sh docker/start.sh
```

Danach wird OpenGewerk im Browser eingerichtet. Schritt für Schritt steht das unter [opengewerk.de/self-hosting](https://opengewerk.de/self-hosting/).

## Fassungen

Jede Fassung steht unter ihrer Nummer, etwa `opengewerk/opengewerk:0.3.0`, für x86_64 und ARM64, und `latest` zeigt auf die neueste. Die Abbilder hier sind ein Spiegel von `ghcr.io/opengewerk/opengewerk`, mit denselben Digests und denselben Signaturen. Das Paket holt sie aus ghcr.io.

## Signatur prüfen

Jedes Abbild ist ohne Schlüssel über Sigstore signiert, vom Release-Workflow des Repositorys:

```bash
cosign verify opengewerk/opengewerk:<fassung> \
  --certificate-identity https://github.com/opengewerk/opengewerk/.github/workflows/release.yml@refs/tags/v<fassung> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Mehr

- Quelltext, Releases und Konzept: [github.com/opengewerk/opengewerk](https://github.com/opengewerk/opengewerk)
- Website: [opengewerk.de](https://opengewerk.de/)
- Fragen und Rückmeldungen: [Discussions](https://github.com/opengewerk/opengewerk/discussions)
- Lizenz: AGPL-3.0
