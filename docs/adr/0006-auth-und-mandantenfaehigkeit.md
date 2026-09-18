---
status: angenommen
date: 2026-09-18
decision-makers: Projektleitung OpenGewerk
consulted: Konzept "Feature-Gliederung Handwerkersoftware" v2.3, Abschnitt 2, 3.6 (Kundenportal), 4.13 (Kanzlei-Connector)
informed: Mitwirkende der Organisation opengewerk
---

# Authentifizierung, Autorisierung und Mandantenfähigkeit

## Kontext und Problemstellung

Drei Nutzergruppen mit unterschiedlichen Anforderungen: Mitarbeiter (Rollen, 2FA, lange Sitzungen auf der Baustelle), Kunden im Portal (schwellenarm, oft nur Magic-Link), Kanzlei-Hub (Maschine-zu-Maschine mit Scopes, widerrufbar). Dazu Mandantenfähigkeit auf einer Instanz und optional Anbindung an einen bestehenden Identitätsanbieter.

## Betrachtete Optionen

### A: Externer Identity-Provider (Keycloak, Authentik)

- Vorteile: OIDC, 2FA, Passkeys, SSO fertig; Audit; Standard.
- Nachteile: Zweiter schwergewichtiger Dienst (Keycloak: Java, viel RAM) für jeden Handwerksbetrieb, widerspricht „läuft auf einem kleinen Server“; Kundenportal und Kanzlei-Tokens passen nur mit Verbiegung hinein.

### B: Eingebaute Auth mit Bibliothek (better-auth, Lucia-Muster)

- Vorteile: Ein Prozess; Sitzungen, Passkeys/WebAuthn, TOTP, Magic-Link, OIDC-Client für optionales SSO; volle Kontrolle über Mandanten- und Rollenmodell.
- Nachteile: Sicherheitsverantwortung liegt im Projekt; Bibliotheksreife muss bewertet werden.

### C: Komplett eigene Implementierung

- Vorteile: Keine Abhängigkeit.
- Nachteile: Das Rad neu erfinden bei sicherheitskritischem Code, nicht vertretbar.

## Entscheidung

Gewählt wurde **Option B, eingebaute Auth** mit einer gepflegten Bibliothek, plus **OIDC-Client optional** für Betriebe mit vorhandenem IdP (Microsoft Entra, Keycloak). Kein Zwang zu einem externen IdP.

Als Bibliothek wird **better-auth** eingesetzt (Prüfung am 18.09.2026: MIT-Lizenz, aktiver Stand, letzte Veröffentlichung wenige Tage alt, großer Beitragendenkreis, offener Umgang mit Sicherheitsmeldungen). Genutzt wird ausschließlich der Kern mit Sitzungen, Passkeys, TOTP und Magic-Link. Die Zusatzpakete für SSO, SCIM und Abrechnung bleiben außen vor, dort lagen 2026 die meisten und die schwersten Sicherheitsmeldungen. Fällt die Bibliothek aus der Pflege, ist die eigene Umsetzung nach dem Lucia-Leitfaden der Rückfallweg.

- **Mitarbeiter:** E-Mail + Passwort mit Passkey-Option; 2FA (TOTP oder Passkey) für Admin- und Finance-Rollen Pflicht, für Techniker empfohlen; Sitzungen als HttpOnly-Cookies mit langer Laufzeit auf registrierten Geräten (Baustelle), kurzer Laufzeit im Büro; Geräteliste mit Widerruf.
- **Kunden (Portal):** Magic-Link per E-Mail als Standard, optionales Passwort; getrennter Auth-Bereich, keine Vermischung mit Mitarbeiterkonten.
- **Kanzlei-Hub:** OAuth-2.0-artige Client-Credentials mit Scopes aus `opengewerk-api-spec`, Rotation, Ablauf bei Inaktivität, Sofort-Widerruf durch den Mandanten. Die erste Fassung in Phase 3 arbeitet mit rotierenden Bearer-Token; die kryptografische Bindung an den Hub (DPoP oder mTLS) kommt danach und ist ausdrücklich keine Zusage für Phase 3. Ein Token ohne Bindung ist bei erzwungenem HTTPS, kurzer Laufzeit und sofortigem Widerruf vertretbar, ein halb gebautes DPoP wäre es nicht.
- **Autorisierung:** Rollen (Admin, Büro, Buchhaltung, Bauleiter, Techniker, Steuerberater read-only, Subunternehmer, Kunde) plus feingranulare Berechtigungen (`beleg.festschreiben`, `finance.buchen`, `auftrag.eigene.lesen`). Prüfung zentral in Guards; Datensichtbarkeit zusätzlich über RLS (ADR 0003).
- **Mandanten:** Ein Benutzer kann mehreren Mandanten angehören (z. B. Inhaber mit zwei Firmen); Mandant wird pro Sitzung gewählt und in jeder Anfrage geprüft; Nummernkreise, Kontenrahmen, Branding je Mandant.

## Konsequenzen

- Sicherheitsbaseline: Argon2id für Passwörter, Rate-Limits, CSRF-Schutz, Content-Security-Policy, Audit-Log für Login/Logout/Rechteänderung/Token-Erzeugung.
- Externe Sicherheitsprüfung (mindestens ein Community-Review, idealerweise ein bezahltes Audit) vor dem ersten Release, das Kundenportal oder Kanzlei-Connector enthält. Der Magic-Link-Weg gehört ausdrücklich dazu: Für genau dieses Verfahren hat better-auth im Juni 2026 eine Meldung zu Kontoübernahme durch vorbereitete Konten veröffentlicht und behoben.
- Sicherheitsmeldungen der eingesetzten Bibliothek werden abonniert (GitHub Security Advisories), die Version wird nicht über Monate eingefroren. Eine Auth-Bibliothek ist die eine Abhängigkeit, bei der ein verpasstes Update direkt Konten betrifft.
- Das Rollenmodell wird als Daten (Tabelle) gepflegt, damit Gewerke-Plugins eigene Berechtigungen registrieren können.
