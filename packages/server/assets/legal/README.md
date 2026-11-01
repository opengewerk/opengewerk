# Amtliche Grafiken zu Rechtstexten

Dateien, die das Recht in einer festen Gestaltung vorschreibt und die OpenGewerk deshalb unverändert
mitliefert, statt sie nachzubauen. Jede liegt hier so, wie sie von der Quelle kam, Byte für Byte;
der Server prüft beim Lesen ihre Prüfsumme (`documents/legal-graphics.ts`) und druckt nichts, was
davon abweicht.

## Harmonisierte Mitteilung zur gesetzlichen Gewährleistung

Seit dem 27.09.2026 gehört sie zu jedem Angebot an einen Verbraucher, das eine Lieferung von Waren
betrifft (Art. 246 Abs. 1 Nr. 5 und Art. 246a § 1 Abs. 1 Satz 1 Nr. 11 EGBGB in der Fassung von
Art. 3 des Gesetzes vom 03.02.2026, BGBl. 2026 I Nr. 28, in Kraft nach dessen Art. 10 Abs. 3).
Gestaltung und Inhalt legt Anhang I der Durchführungsverordnung (EU) 2025/1960 in der Fassung vom
25.09.2025 fest; keines ihrer Elemente darf verändert oder ergänzt werden (Anhang I, Erläuterung 1),
und sie ist mindestens A4 groß (Erläuterung 4). Deshalb steht sie im PDF eines Angebots als eigene
Seite, und zwar diese Datei und keine Nachbildung.

| Datei                                | Inhalt                                                                             | SHA-256                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `guarantee-notice-de-2025-09-25.pdf` | deutsche Fassung, Seite 1 in Farbe, Seite 2 schwarzweiß, je A4 hoch                | `1aa13d2557aff2d107fce73c3c0f5ba6ebeb0cbc86e4fe2f7311a6a1d3be1182` |
| `guarantee-notice-de-2025-09-25.png` | deutsche Fassung in Farbe, 1654 × 2339 Pixel, für die Ansicht in den Einstellungen | `1a9a521cca675709ddf0ec341d9d3d40b18dfb47756754b29cbfe38a5d6027b8` |

Gedruckt wird Seite 1 des PDF, die farbige: die Kommission bevorzugt Farbe und bezeichnet die
schwarzweiße Fassung als die für das Ladengeschäft.

**Quelle:** Europäische Kommission, GD Justiz und Verbraucher, "Practical guidelines and high
resolution vector files: EU notice and label on product guarantees",
https://commission.europa.eu/publications/practical-guidelines-and-high-resolution-vector-files-eu-notice-and-label-product-guarantees_en,
aus den Archiven "Harmonised notice in 24 languages colour and black and white" (das PDF, Eintrag
"Legal guarantee_notice DEN.pdf") und "PNG and JPG" (das PNG, Eintrag
"PNG/Legal guarantee_notice_DE.png"), abgerufen am 26.09.2026.

**Nutzung:** © Europäische Union. Die Kommission erlaubt die Weiterverwendung ihrer Dokumente,
auch gewerblich und ohne Gebühr (Beschluss 2011/833/EU; Inhalte ihrer Website unter CC BY 4.0),
mit Angabe der Quelle und ohne den Sinn zu verändern. Ausgenommen davon sind Logos; die Mitteilung
trägt ein Schild mit den Sternen der EU. Es wird hier nur als Teil der Mitteilung verwendet, für
den Zweck, für den die Verordnung sie vorschreibt, und ohne eine Verbindung zur EU oder eine
Billigung durch sie zu behaupten. Diese Dateien stehen nicht unter der AGPL-3.0 des übrigen
Repositorys.

## Harmonisierte Kennzeichnung einer Haltbarkeitsgarantie

Gewährt der Hersteller eine Haltbarkeitsgarantie für die ganze Ware, ohne zusätzliche Kosten und länger als
zwei Jahre, und teilt er sie dem Betrieb mit, trägt ein Angebot an einen Verbraucher dazu die Kennzeichnung
nach Anhang II der Durchführungsverordnung (EU) 2025/1960 (Art. 246 Abs. 1 Nr. 5a und Art. 246a § 1 Abs. 1
Satz 1 Nr. 11a EGBGB in derselben Fassung wie oben). Anders als die Mitteilung hat sie drei Felder, die der
Unternehmer füllt: „XX“ mit der Dauer in Jahren, „Brand/Trademark“ mit dem Hersteller und „Model identifier“
mit dem Modell. Alles andere darf nicht verändert werden, und die Schrift ist Inter (Leitlinien der
Kommission, Abschnitt 3.1). Der Server füllt deshalb genau diese drei `text`-Elemente der Datei und lässt den
Rest stehen, wie er kam; gedruckt wird sie in ihrer Mindestgröße von 95 × 100 mm, für die die Leitlinien
die Schriftgrößen angeben (Abschnitt 3.2).

| Datei                             | Inhalt                                                   | SHA-256                                                            |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `durability-label-2026-03-19.svg` | Kennzeichnung in Farbe, 269,29 × 283,46 pt (95 × 100 mm) | `3414c8366823db39702d2557e614f882b530487ce589e903afdc98b7225e1ab1` |

Die farbige Fassung, weil die Kommission sie bevorzugt und die schwarzweiße nur im Ladengeschäft zulässt.

Gedruckt wird die Kennzeichnung nicht aus dieser Datei. Sie geht im Text der Seite an den Renderer und steht
deshalb Byte für Byte als Text in `src/documents/durability-label.ts`; ein Test hält diesen Text gegen die
Datei und die Datei gegen ihre Prüfsumme. Eine neue Fassung der Kommission ersetzt Datei, Prüfsumme und
Text in einer Änderung.

**Quelle:** dieselbe Seite der Kommission wie oben, Archiv "EU GARAN product label in colour (for physical
shops and e-commerce), in black and white (only for physical shops) and in nested display (only for
e-commerce)" (Datei "GARAN label for website.zip", Eintrag "GARAN Label_colour.svg"), veröffentlicht am
19.03.2026, abgerufen am 01.11.2026. Dazu die Leitlinien "Practical guidelines for sellers and producers on
the EU harmonised notice on the legal guarantee of conformity and on the EU harmonised label for the
commercial guarantee of durability" vom 01.04.2026.

**Nutzung:** wie bei der Mitteilung. Die Kennzeichnung trägt dasselbe Schild mit den Sternen der EU, und es
wird hier ebenso nur als Teil der Kennzeichnung verwendet, für den Zweck, für den die Verordnung sie
vorschreibt.

Eine Genehmigung für das Schild ist nicht eingeholt worden, mit Absicht (entschieden am
27.09.2026). Nach der Verwaltungsvereinbarung zwischen der Europäischen Union und dem Europarat
über die Verwendung des Emblems durch Dritte (ABl. C 271 vom 08.09.2012, S. 5) braucht es keine
schriftliche Erlaubnis, solange die Verwendung keine Verbindung zu einem Organ der EU und keine
Unterstützung oder Billigung durch sie vortäuscht und keinem Zweck dient, der ihren Zielen
widerspricht. Hier erscheint das Schild nur in der Seite, die die Verordnung vorschreibt, in der
Datei, die die Kommission dafür bereitstellt.
