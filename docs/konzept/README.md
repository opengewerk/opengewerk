# Konzept

Hier liegen die Planungsdokumente von OpenGewerk. Sie sind die verbindliche Quelle für den Funktionsumfang: was gebaut wird, steht zuerst hier. Was davon schon gebaut ist, sagt die [README](../../README.md) im Wurzelverzeichnis.

| Datei | Inhalt |
| --- | --- |
| [`Feature-Gliederung.md`](Feature-Gliederung.md) | Vollständige Feature-Gliederung der Handwerkersoftware: Leitentscheidungen, Architektur-Bausteine, CRM, ERP, Gewerke-Module, Schnittstellen, rechtliche Anforderungen, Roadmap |

Das Konzept des Kanzlei-Hubs liegt im Repository [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei) unter `docs/konzept/`.

## Wie diese Dokumente geändert werden

Änderungen laufen wie Codeänderungen über einen Pull Request, nicht über direkte Pushes auf `main`. Damit bleibt nachvollziehbar, wann eine Entscheidung gefallen ist und warum.

Für einen Pull Request an diesen Dokumenten gilt:

- Die Versionsnummer in der Kopfzeile des Dokuments anheben und das Änderungsprotokoll am Dateiende ergänzen.
- Widersprüche zu anderen Abschnitten mit auflösen, statt eine Korrektur an einer zweiten Stelle danebenzuschreiben.
- Betrifft die Änderung auch den Kanzlei-Hub oder den API-Vertrag, im Pull Request darauf hinweisen, damit die anderen Repositories nachziehen können.
- Eine Änderung, die eine Architekturentscheidung umstößt, gehört zusätzlich als Architecture Decision Record nach [`../adr/`](../adr/).

Wer erst einmal nur eine Frage oder eine Idee hat, ist in den [Discussions](https://github.com/opengewerk/opengewerk/discussions) besser aufgehoben als in einem Pull Request.
