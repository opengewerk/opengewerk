---
status: angenommen
date: 2026-10-19
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.77 (Abschnitte 3 und 9), Entscheidung vom 19.10.2026 an opengewerk-haustechnik#355, ADR 0010
informed: Mitwirkende der Organisation opengewerk
---

# Schwärzen im Änderungsprotokoll

## Kontext und Problemstellung

Das Änderungsprotokoll hält jede Änderung Feld für Feld mit dem Wert davor und danach, im Klartext, und jeder Eintrag verweist über einen Fingerabdruck auf seinen Vorgänger (`sql/audit.sql`). Der Fingerabdruck rechnet über den ganzen Eintrag, die Werte eingeschlossen, und die Spalten von `audit_entries` sind eingefroren, weil eine weitere Spalte die Textform jedes Eintrags ändern würde.

Das Planungskonzept der Haustechnik sagt: „Im Änderungsprotokoll wird ein personenbezogener Wert geschwärzt, die Hashkette bleibt ganz“ (Abschnitt 9). Mit der Kette von heute geht das nicht: wer einen Wert entfernt, bricht den Fingerabdruck dieses Eintrags, und die Prüfung meldet eine Manipulation. Das Ende eines Zugangs entfernt seit opengewerk-haustechnik#356 Adresse und Passkeys eines Kontos, aber was das Protokoll davon hält, etwa eine berichtigte E-Mail-Adresse, blieb.

## Entscheidungstreiber

- Die Kette bleibt ganz: nach dem Schwärzen prüft sie weiter durch, und eine Änderung an der Anwendung vorbei findet sie weiterhin.
- Ein Eintrag, den es schon gibt, wird nicht umgeschrieben. Die Kette einer Instanz ist ihr Beweis; eine Migration, die alle Fingerabdrücke neu rechnet, würde einen Bruch, den es vorher gab, unsichtbar machen.
- Das Schwärzen ist selbst eine Änderung und steht im Protokoll, mit wer, wann und warum, ohne den geschwärzten Wert.
- Schwärzen darf nur die Leitung, mit einem Grund (Moritz, 19.10.2026). Die Datenbank prüft das selbst, wie beim Löschen eines Nachweises (opengewerk-haustechnik#340).

## Betrachtete Optionen

1. Alle Einträge einmal neu ketten, künftig über Fingerabdrücke der Werte.
2. Fingerabdrücke der Werte nur für neue Einträge; ein alter Eintrag bekommt beim Schwärzen einen Zeugen.
3. Nicht schwärzen, nur den Zugriff auf das Protokoll weiter einschränken.

## Entscheidung

Gewählt: **Option 2**. Entschieden hat Moritz am 19.10.2026, dass die Kette über einen Fingerabdruck jedes Werts rechnet und die Leitung schwärzt; dass bestehende Einträge dabei nicht neu gerechnet werden, folgt aus dem zweiten Treiber.

- **Neue Spalten an `audit_entries`:** `fingerprint_version` (1 für jeden Eintrag, den es schon gibt, 2 für jeden neuen), `old_value_digest` und `new_value_digest` (SHA-256 des Werts in Hex, leer zu einem leeren Wert).
- **Der Fingerabdruck kennt zwei Fassungen.** Fassung 1 rechnet wie bisher über den Eintrag ohne `hash` und ohne die drei neuen Spalten; die Textform eines alten Eintrags ist damit Zeichen für Zeichen die von vorher, und jede bestehende Kette prüft weiter durch. Fassung 2 rechnet über den Eintrag ohne `hash`, `old_value` und `new_value`; die Werte gehen über ihre Fingerabdrücke ein. Der Schreiber `record_change` schreibt nur noch Fassung 2.
- **Schwärzen** (`redact_audit_value(entry, side, reason)`, `SECURITY DEFINER`): Die Person führt den Mandanten des Eintrags, der Grund ist 1 bis 500 Zeichen lang, die Seite (Wert davor oder danach) ist nicht schon geschwärzt. Die Funktion prüft den Eintrag, bevor sie etwas tut, nach seiner Fassung; ist er nicht mehr, wie er geschrieben wurde, lehnt sie ab. Dann schreibt sie eine Zeile in `audit_redactions` (Eintrag, Seite, Grund, wer, wann) und leert den Wert. Der Fingerabdruck des Werts bleibt.
- **Der Zeuge eines alten Eintrags.** Ein Eintrag der Fassung 1 lässt sich nach dem Schwärzen nicht mehr nachrechnen, weil sein Fingerabdruck den Klartext enthält. Beim ersten Schwärzen bekommt er deshalb die Fingerabdrücke seiner beiden Werte, gerechnet aus dem eben geprüften Eintrag, und die Zeile in `audit_redactions` hält seinen Fingerabdruck nach Fassung 2 als Zeugen; der bindet jedes Feld des Eintrags, auch den Wert, der nicht geschwärzt wurde. Die Prüfung vergleicht einen geschwärzten alten Eintrag mit diesem Zeugen, und der Zeuge selbst steht mit dem Eintrag, den das Schwärzen ins Protokoll schreibt, in der Kette.
- **Die Prüfung der Kette** (`verify_audit_chain`) prüft zusätzlich: der Fingerabdruck eines vorhandenen Werts passt zum Wert, und ein leerer Wert, zu dem es einen Fingerabdruck gibt, ist ein geschwärzter mit einer Zeile in `audit_redactions`; sonst meldet sie den Eintrag.
- **Der Riegel** `audit_entry_stays` lässt genau eine Änderung zu: einen Wert leeren und, bei einem Eintrag der Fassung 1, die Fingerabdrücke seiner Werte setzen, während `redact_audit_value` es im selben Zug tut und die Zeile dazu schon steht. Jede andere Änderung und jedes Löschen lehnt er weiter ab.
- **Die Anwendungsrolle** darf `audit_redactions` lesen und sonst nichts; geschrieben wird nur über die Funktion.
- **Was das Fundament mitbringt:** die Spalten und die Tabelle im Schema, die Bausteine in `sql/audit.sql`, die Route `POST audit/entries/:id/redactions` (Recht zum Einsehen des Protokolls; ob die Person führt, prüft die Datenbank. Ein eigenes Recht gibt es bewusst nicht: schwärzen darf, wer führt, und Führen ist eine Eigenschaft der Rolle, kein Recht, das eine eigene Rolle eines Mandanten bekommen könnte. Das Protokoll ist kein Nachweis; Datensatz und Nachweise bleiben, wie sie sind), die Angabe am Eintrag, ob, wann, von wem und warum ein Wert geschwärzt wurde, in der Liste wie in der Tabelle („geschwärzt“, nicht „leer“), und im Protokoll des Büros „Schwärzen“ mit einer Rückfrage nach Wert und Grund, angeboten nur, wenn die Seite sagt, dass die lesende Person führt (`redacts`). Die Schwärzung selbst steht im Protokoll mit einem eigenen Weg (`audit.redact`, „Wert im Änderungsprotokoll geschwärzt“), mit Grund und ohne den Wert. Jede Anwendung bringt die Änderung als eigene Migration (README unter `sql/`).
- **Nachtrag vom 29.10.2026, Fassung 3: der Fingerabdruck verrät den Wert nicht mehr.** Der Fingerabdruck eines Werts war SHA-256 seines Texts, ohne Salz und ohne Schlüssel, und er bleibt beim Schwärzen stehen. Für einen Wert, den man raten kann, einen Namen, ein Datum, einen Betrag, gab er den Wert jedem zurück, der die Datenbank oder eine Sicherung liest; die Konsequenz unten, der geschwärzte Wert verschwinde aus der Datenbank, stimmte so nicht (Befund B13 des Security-Audits vom 29.10.2026). Seit Migration 0092 schreibt der Trigger jeden Eintrag in Fassung 3: jeder Wert bekommt 32 zufällige Bytes in `audit_value_nonces`, sein Fingerabdruck geht über diese und den Wert (`audit_value_commitment`), und das Schwärzen löscht sie mit dem Wert. Was stehen bleibt, sagt über den Wert nichts mehr. Die Tabelle schreibt nur der Trigger; die Anwendung liest sie, weil die Prüfung der Kette als Anwendung läuft, und zwar nur im eigenen Mandanten. Im Protokoll steht sie nicht, sonst stünde der Schlüssel zu jedem Fingerabdruck in Einträgen, die kein Schwärzen erreicht. Ein vorhandener Wert der Fassung 3 passt nur mit seinen Zufallsbytes; fehlen sie, meldet die Prüfung den Eintrag als verändert. **Was bleibt, wie es war:** Einträge der Fassung 2, die schon geschrieben sind, behalten den einfachen Fingerabdruck, weil er in der Kette steht und kein Eintrag neu geschrieben wird; ein geschwärzter Wert eines solchen Eintrags bleibt so leicht zu raten wie vorher. Ein Eintrag der Fassung 1 ist über seinen Klartext gehasht, und der nächste Eintrag verweist auf diesen Hash; auch er bleibt ratbar. Ältere Sicherungen halten Werte und Zufallsbytes, bis sie verfallen.

### Konsequenzen

- Gut, weil die Kette jeder Instanz bleibt, wie sie war: keine Zeile wird neu gerechnet, und ein Bruch von vorher bleibt sichtbar.
- Gut, weil der geschwärzte Wert aus der Datenbank verschwindet, aus jeder künftigen Sicherung auch; nur ältere Sicherungen halten ihn, bis sie verfallen.
- Gut, weil das Schwärzen selbst im Protokoll steht und von niemandem außer der Leitung kommt.
- Schlecht, weil die Prüfung zwei Fassungen kennt, solange es Einträge der Fassung 1 gibt, also immer.
- Schlecht, weil ein geschwärzter Eintrag der Fassung 1 nur noch so gut ist wie sein Zeuge: wer die Rechte eines Superusers hat, kann Eintrag und Zeugen zusammen fälschen. Das kann er heute schon mit jedem Eintrag ab dem geänderten; die Kette hält, was sie vorher hielt.
- Die Rücknahme entfernt Spalten und Tabelle. Einträge der Fassung 2 prüfen danach nicht mehr durch; ihre Kosten nennt die Rücknahme.

### Bestätigung

Tests im Fundament: ein geschwärzter Wert ist fort, die Kette prüft durch, für Einträge beider Fassungen; ein Eintrag, der nach dem Schwärzen verändert wird, und ein Wert, der ohne Schwärzen fehlt, brechen die Prüfung; nur wer führt, schwärzt, mit Grund, und jeden Wert nur einmal; der Riegel lässt keine andere Änderung zu; ein Eintrag aus der Fassung vor dieser prüft weiter durch. Dazu der Vergleich der Bausteine mit den Migrationen (`foundation.test.ts`).

## Vor- und Nachteile der Optionen

### Option 1: alle Einträge neu ketten

- Gut, weil danach eine Fassung reicht.
- Schlecht, weil die Migration jeden Fingerabdruck jeder Instanz neu schreibt; ein Bruch von vorher verschwindet, wenn die Migration ihn nicht gesondert festhält, und die Rücknahme müsste die alten Fingerabdrücke aufheben.

### Option 2: zwei Fassungen, Zeuge beim Schwärzen

Siehe oben.

### Option 3: nicht schwärzen

- Gut, weil nichts zu bauen ist.
- Schlecht, weil das Konzept es zusagt und eine Person, deren Zugang geendet hat, sonst ihre Adresse für immer im Protokoll hätte.

## Weitere Informationen

- Planungskonzept der Haustechnik, Abschnitt 9; Issue opengewerk-haustechnik#355 mit der Entscheidung vom 19.10.2026.
- ADR 0010: Fundament als Pakete; der Baustein `sql/audit.sql` und seine Pflege.
