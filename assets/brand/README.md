# Laufzeit-Assets der Anwendung

Laufzeit-Assets der Anwendung (PWA-Manifest, Favicon). Quelle und alle weiteren Varianten: `opengewerk/.github` → `brand/`. Änderungen zuerst dort, dann hierher kopieren.

Diese Kopie ist Absicht und kein Versehen: die Anwendung läuft self-hosted und darf ihre Icons nicht zur Laufzeit von GitHub nachladen. Alle anderen Repositories binden das Branding dagegen per Raw-URL ein, damit es nur eine Quelle gibt.

| Datei | Verwendung |
| --- | --- |
| `opengewerk-app-icon.svg` | App-Icon als Vektor |
| `opengewerk-app-icon-192.png`, `opengewerk-app-icon-512.png` | Icons für das PWA-Manifest |
| `opengewerk-icon.svg`, `opengewerk-icon-dark.svg`, `opengewerk-icon-mono.svg` | Bildmarke transparent, hell, dunkel, einfarbig |
| `opengewerk-icon-16.png`, `opengewerk-icon-32.png` | Kleine Rasterversionen |
| `favicon.ico` | Favicon mit 16, 32 und 48 px |

Die Dateien werden unverändert übernommen. Wer hier etwas zuschneidet, skaliert oder umfärbt, erzeugt eine zweite Wahrheit.
