Die Sicherung zu [OpenGewerk](https://hub.docker.com/r/opengewerk/opengewerk), der self-hosted Handwerkersoftware für Elektro und PV. Sie sichert jede Nacht Datenbank und Dateispeicher einer Installation in ein Archiv, auf Wunsch mit [age](https://age-encryption.org/) verschlüsselt, prüft ein Archiv und spielt es zurück.

Einzeln ist dieses Abbild nicht gedacht: das Paket von der [Release-Seite](https://github.com/opengewerk/opengewerk/releases) startet es mit, und wie man damit sichert und zurückspielt, steht in der [README](https://github.com/opengewerk/opengewerk#betrieb).

Fassungen und Signaturen wie bei `opengewerk/opengewerk`: jede Fassung unter ihrer Nummer, für x86_64 und ARM64, `latest` für die neueste, ein Spiegel von `ghcr.io/opengewerk/backup` mit denselben Digests und denselben Signaturen. Lizenz: AGPL-3.0.
