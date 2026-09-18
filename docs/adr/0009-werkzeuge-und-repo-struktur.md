---
status: angenommen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: ADR 0002 bis 0008, Konzept "Feature-Gliederung Handwerkersoftware" v2.5, Abschnitte 4.8 und 10
informed: Mitwirkende der Organisation opengewerk
---

# Werkzeuge und Repo-Struktur

## Kontext und Problemstellung

ADR 0002 hat Sprache und Framework entschieden, aber drei Enden offen gelassen, die am ersten Tag von Phase 0 anfallen:

- **"Monorepo (pnpm Workspaces oder Turborepo)"**: ein Oder in einem angenommenen ADR. Die Antwort bestimmt, wie die erste `package.json` aussieht.
- **"Laufzeit: Node.js LTS (aktuell 22)"**: seit dem 18.09.2026 gilt projektweit, die neuestmögliche Version zu nehmen. Die CI von `opengewerk-api-spec` läuft bereits auf 24.
- Die Paketliste nennt `web` **und** `mobile-pwa` mit dem Zusatz "oder ein `web` mit zwei Einstiegen". ADR 0004 hat diese Frage inzwischen entschieden: eine Codebasis mit den Einstiegen `/` und `/m`. Wer nur 0002 liest, legt ein Paket an, das es nicht geben soll.

Dazu kommen zwei Festlegungen, die in keinem ADR stehen und trotzdem vor der ersten Datei fällig sind: **womit getestet wird** und **womit geprüft und formatiert wird**. Beides lässt sich nachträglich nur mit einem Durchlauf über den gesamten Bestand ändern.

Drei Anforderungen aus den bestehenden Beschlüssen geben den Ausschlag:

1. Das Paket `domain` rechnet im Browser und auf dem Server identisch (ADR 0002). Die Werkzeuge dürfen zwischen beiden Seiten keinen Unterschied machen.
2. Abschnitt 4.8 verlangt **Property-based Tests** für die Buchungslogik. Das Testwerkzeug muss das tragen, nicht nur Beispieltests.
3. Die Baustellen-Oberfläche ist eine offline-first PWA (ADR 0004). Fehler in React-Effekten sind dort teurer als anderswo, weil sie sich als verlorene Erfassung zeigen und nicht als Absturz.

## Betrachtete Optionen

### Paketmanager und Monorepo-Werkzeug

**A: pnpm Workspaces allein.** Schnell, spart über harte Links Plattenplatz, und vor allem strikt: ein Paket sieht nur, was es selbst deklariert hat. Genau die Disziplin, die ein I/O-freies `domain` braucht. Nachteil: kein Aufgabengraph, jeder Befehl läuft über alle Pakete.

**B: pnpm Workspaces plus Turborepo.** Zusätzlich ein Aufgabengraph mit Cache: geändert wurde `domain`, also laufen `server` und `web` neu, alles andere kommt aus dem Cache. Nachteil: eine Abhängigkeit und eine Konfigurationsdatei mehr, deren Nutzen erst mit der Zahl der Pakete wächst.

**C: npm Workspaces.** Node bringt sie mit, kein zusätzliches Werkzeug. Nachteil: langsamer, und die flache Auflösung lässt ein Paket versehentlich Abhängigkeiten eines anderen benutzen. Das weicht genau die Trennung auf, die `domain` tragen soll.

### Testwerkzeug

**A: Vitest überall, dazu fast-check.** Ein Runner für `domain`, `server` und `web`, dieselbe Konfiguration, dieselben Testhelfer. Passt zum Vite-Frontend aus ADR 0004, läuft unter NestJS. fast-check liefert die Property-based Tests aus 4.8. Nachteil: für NestJS ist Jest der eingelaufene Weg, also etwas weniger fertige Beispiele.

**B: Jest für `server`, Vitest für `web`.** Beide im jeweiligen Heimatgebiet. Nachteil: zwei Runner, zwei Konfigurationen, zwei Mocking-Systeme, und die geteilten Testhelfer in `domain` müssen zu beiden passen. Der Preis fällt bei jedem geteilten Test an, nicht einmalig.

**C: `node:test` überall.** Keine Testabhängigkeit, so wie in `opengewerk-api-spec`. Nachteil: schwach bei Komponententests im Browser und beim Mocking, was spätestens mit der PWA zu einem zweiten Werkzeug führt.

### Linter und Formatter

**A: ESLint mit Flat Config plus Prettier.** Der eingelaufene Weg, und der einzige mit vollständigen `react-hooks`-Regeln. Nachteil: zwei Werkzeuge, langsamer als die Alternative.

**B: Biome.** Linting und Formatierung in einem, deutlich schneller, eine Konfiguration. Nachteil: die `react-hooks`-Regeln sind nicht vollständig abgedeckt.

**C: Biome formatiert, ESLint prüft React.** Schnell und vollständig. Nachteil: zwei Werkzeuge mit überlappendem Zuständigkeitsbereich, die man auseinanderhalten muss, damit sie sich nicht gegenseitig umformatieren.

## Entscheidung

Gewählt wurden **B (pnpm plus Turborepo)**, **A (Vitest plus fast-check)** und **A (ESLint plus Prettier)**.

| Zweck | Werkzeug | Reihe |
| --- | --- | --- |
| Laufzeit | Node.js | 24 (aktuelle LTS-Reihe) |
| Paketmanager | pnpm, über `packageManager` im Wurzelpaket festgenagelt | 12 |
| Aufgaben und Cache | Turborepo | 2 |
| Sprache | TypeScript | 7 |
| Tests | Vitest, dazu fast-check für Property-based Tests | 5 bzw. 4 |
| Prüfen | ESLint mit Flat Config, typescript-eslint, eslint-plugin-react-hooks | 10 bzw. 8 |
| Formatieren | Prettier, mit eslint-config-prettier gegen Regelkonflikte | 3 |
| Datenbank | PostgreSQL | 18 |
| Migrationen | drizzle-kit, SQL-Dateien im Repo (ADR 0003) | 0.31 |

Genaue Versionen stehen in `package.json` und im Lockfile, nicht hier. Diese Tabelle nennt die Reihe, damit ein Sprung über eine Hauptversion eine bewusste Änderung bleibt und nicht nebenbei passiert.

**Turborepo läuft ohne Remote Cache.** Der lokale Cache reicht für ein Ein-Personen-Projekt, und ein fremder Dienst, der Build-Artefakte zu sehen bekommt, passt nicht zu einer Software, deren Kern die Datenhoheit des Betriebs ist. Wenn die CI-Zeit später drückt, ist ein selbst gehosteter Cache der nächste Schritt, nicht der Dienst des Herstellers.

### Die Paketliste, abschließend

Damit ist die Klammer aus ADR 0002 aufgelöst:

```
opengewerk/
  packages/
    domain/          # Schemas, Berechnungen, Regeln, Fristen. Kein I/O, keine Frameworks
    server/          # NestJS, Drizzle, Auth, Sync-Endpunkte
    web/             # React + Vite, eine Codebasis, Einstiege / (Büro) und /m (Baustelle)
    gewerke/<name>/  # Datenpakete plus optionale Compile-Time-Module (ADR 0008)
  docker/            # Compose, Chromium-Renderer als eigener Dienst (ADR 0007)
  docs/
```

Ein `mobile-pwa`-Paket gibt es nicht. Der Konsument des Kanzlei-Vertrags kommt erst mit Phase 3 und heißt dann `kanzlei-client`, nicht `api-spec`, damit er nicht mit dem Repository `opengewerk-api-spec` verwechselt wird.

## Konsequenzen

- **Die CI des Repositories bekommt mit dem ersten Code vier Schritte**: Abhängigkeiten installieren, Typprüfung, Lint, Test. Heute laufen dort nur Kodierung und Schreibweise. Der Build kommt dazu, sobald es etwas zu bauen gibt. Die CodeQL-Sprachliste muss niemand nachziehen, sie ermittelt sich seit dem 18.09.2026 selbst aus dem Dateibestand.
- **Corepack aktiviert pnpm**, die Version steht im Feld `packageManager`. Damit benutzt jeder Beitragende dieselbe, ohne sie zu installieren.
- **Ein `tsconfig.base.json` in der Wurzel**, die Pakete erben davon. `domain` wird zusätzlich so konfiguriert, dass Node- und DOM-Typen dort nicht verfügbar sind. Das ist die technische Absicherung von "ohne I/O": Wer dort `fs` importiert, bekommt einen Typfehler und keine Codereview-Diskussion.
- **Vor dem ersten Commit gegenprüfen**, dass NestJS unter TypeScript 7 mit `emitDecoratorMetadata` baut. TypeScript 7 ist die native Neuimplementierung des Compilers, und NestJS hängt an der Metadatenausgabe der Dekoratoren. Falls es klemmt: `server` bleibt auf der 6er-Reihe, der Rest geht auf 7, und diese Ausnahme wird hier nachgetragen.
- **PostgreSQL 19 erscheint voraussichtlich im Herbst 2026.** Der Umstieg erfolgt nach dessen erstem Minor-Release, nicht am Erscheinungstag, und ist eine Änderung an dieser Tabelle plus dem Compose-Datei-Tag.
- **Property-based Tests sind kein Nice-to-have.** Für die Buchungslogik gehören Summenprobe, Soll gleich Haben und Steuerverprobung als Eigenschaften formuliert, nicht als Beispiele. Das ist die Absicherung aus 4.8 und der Grund, warum fast-check hier steht und nicht später beiläufig dazukommt.
- **ADR 0002 bleibt inhaltlich unverändert** und trägt im Frontmatter `amended-by: 0009`. Die drei offenen Stellen dort sind damit beantwortet, ohne die Historie umzuschreiben.
