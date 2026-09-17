# Architecture Decision Records

Ein Architecture Decision Record, kurz ADR, hält eine einzelne Architekturentscheidung fest: welches Problem zur Debatte stand, welche Möglichkeiten es gab, wofür man sich entschieden hat und was daraus folgt. Der Zweck ist nicht die Entscheidung selbst, die steht im Code. Der Zweck ist die Begründung, damit in zwei Jahren niemand eine Regel umstößt, ohne den Grund zu kennen, oder sie aus Unsicherheit stehen lässt, obwohl der Grund längst weggefallen ist.

Die Dokumente folgen dem [MADR-Format](https://adr.github.io/madr/), auf Deutsch.

## Bestehende Entscheidungen

| Nummer | Titel | Status |
| --- | --- | --- |
| [0001](0001-drei-repositories.md) | Drei Repositories statt eines Monorepos | angenommen |

## Wann ein ADR sinnvoll ist

Immer dann, wenn eine Entscheidung schwer umkehrbar ist oder mehrere Module betrifft: Wahl der Datenbank, Aufbau des Datenmodell-Kerns, Offline-Sync-Strategie, Authentifizierung, Schnitt zwischen Kern und Plugin-Gewerken, Ablage der Belege. Eine Bibliothek auszutauschen ist dagegen meist kein ADR wert.

## Ein neues ADR anlegen

1. Die nächste freie vierstellige Nummer nehmen, die Nummern werden nie neu vergeben.
2. Datei nach dem Muster `NNNN-kurzer-titel.md` benennen, kleingeschrieben, Wörter mit Bindestrich getrennt.
3. Das Dokument im MADR-Format schreiben: Kontext und Problemstellung, Entscheidungstreiber, betrachtete Optionen, Entscheidung mit Konsequenzen, Vor- und Nachteile der Optionen.
4. Den Status im Frontmatter setzen: `vorgeschlagen`, `angenommen`, `abgelehnt`, `überholt durch NNNN`.
5. Die Tabelle in dieser Datei ergänzen.
6. Als Pull Request einreichen. Die Diskussion findet im Pull Request statt, nicht im Dokument.

Ein angenommenes ADR wird nicht mehr inhaltlich umgeschrieben. Ändert sich die Entscheidung, entsteht ein neues ADR, und das alte bekommt den Status `überholt durch` mit Verweis auf das neue. So bleibt die Historie lesbar.
